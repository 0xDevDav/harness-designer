/**
 * Plugin host: the installed list, loading, activation, and the trickiest part,
 * revoking contributions.
 *
 * Two principles drive the implementation:
 * 1. one plugin's error must never stop the others or the application: the
 *    import, reading `default`, `activate` and every call into a contribution
 *    are wrapped in try/catch;
 * 2. every registration produces a removal function that the host keeps, so
 *    disabling a plugin makes its contributions disappear without a page
 *    reload.
 *
 * Plugins run in the page's own context: the host isolates errors, not
 * permissions. That is a deliberate choice, stated to the user in the panel.
 */
import type { AppContext, Exporter, PluginHostApi, PluginRecord, PluginSource } from "@/app/context";
import { registerColorName } from "@/core/colors";
import { registerRule } from "@/core/validate";
import { addMessages } from "@/i18n";
import { safeGet, safeRemove, safeSet } from "@/io/storage";
import { registerConnectorSymbol } from "@/render/connectors";
import { BUNDLED_SOURCES } from "./bundled";
// the menu registry is single and lives in ui/menu; this module only registers
import { registerMenuContributor, type MenuItem } from "@/ui/menu";
import {
  CONTRIBUTION_KEYS,
  PLUGINS_KEY,
  PLUGIN_API_VERSION,
  type ContributionKind,
  type HarnessPlugin,
  type PluginAPI,
  type PluginCommand,
  type PluginModule,
} from "./api";

/* ---------------- stato memorizzato ---------------- */

interface StoredPlugin {
  id: string;
  name: string;
  version: string;
  author?: string;
  description?: string;
  source: PluginSource;
  /** the user's intent, independent of how the last load went */
  enabled: boolean;
  contributions: string[];
}

/** A live entry: the record shown in the panel plus the cleanups to run. */
interface Entry {
  record: PluginRecord;
  enabled: boolean;
  plugin: HarnessPlugin | null;
  disposers: Array<() => void>;
  kinds: Set<ContributionKind>;
}

const SOURCE_KINDS: ReadonlyArray<PluginSource["kind"]> = ["builtin", "url", "inline"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readSource(value: unknown): PluginSource | null {
  if (!isRecord(value)) return null;
  const kind = value["kind"];
  const val = value["value"];
  if (typeof kind !== "string" || typeof val !== "string") return null;
  if (!SOURCE_KINDS.includes(kind as PluginSource["kind"])) return null;
  return { kind: kind as PluginSource["kind"], value: val };
}

function readStoredEntry(value: unknown): StoredPlugin | null {
  if (!isRecord(value)) return null;
  const source = readSource(value["source"]);
  const id = value["id"];
  if (!source || typeof id !== "string" || !id) return null;
  const author = value["author"];
  const description = value["description"];
  const contributions = value["contributions"];
  return {
    id,
    name: typeof value["name"] === "string" ? value["name"] : id,
    version: typeof value["version"] === "string" ? value["version"] : "",
    ...(typeof author === "string" ? { author } : {}),
    ...(typeof description === "string" ? { description } : {}),
    source,
    enabled: value["enabled"] !== false,
    contributions: Array.isArray(contributions)
      ? contributions.filter((c): c is string => typeof c === "string")
      : [],
  };
}

function readStored(): StoredPlugin[] {
  const raw = safeGet(PLUGINS_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: StoredPlugin[] = [];
    for (const item of parsed) {
      const entry = readStoredEntry(item);
      if (entry) out.push(entry);
    }
    return out;
  } catch {
    return [];
  }
}

/** Short fingerprint of the code: gives file-installed plugins a stable key. */
function fingerprint(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/** Provisional key, used until the module declares its own id. */
function provisionalId(source: PluginSource): string {
  return source.kind === "inline" ? `inline:${fingerprint(source.value)}` : `${source.kind}:${source.value}`;
}

/** Outcome of checking a module address. */
export type ModuleUrlCheck =
  { ok: true; href: string } | { ok: false; reason: "malformed" | "insecure"; detail: string };

/**
 * Decides whether a plugin address may be imported.
 *
 * An imported plugin is code with full page privileges, and its address is
 * stored and re-run at every startup: an interceptable `http:` or a `data:` URL
 * pasted in passing would stay active forever. Only two things get through:
 * anything from the page's own origin (built-in plugins, the dev server, the
 * single-file build served from `file://`, where both origins read as `null`),
 * or HTTPS.
 *
 * Pure function, kept apart from `moduleUrl` so the tests can exercise it
 * without a DOM.
 */
export function checkModuleUrl(value: string, base: string): ModuleUrlCheck {
  let url: URL;
  let origin: string | null;
  try {
    url = new URL(value, base);
    origin = new URL(base).origin;
  } catch {
    return { ok: false, reason: "malformed", detail: value };
  }
  // `file://` reads as origin "null" on both sides, so comparing origins alone
  // would treat somebody else's file as same-origin; there the protocol is
  // compared instead.
  const sameOrigin =
    url.origin === "null" || origin === "null"
      ? url.protocol === new URL(base).protocol
      : url.origin === origin;
  if (!sameOrigin && url.protocol !== "https:") {
    return { ok: false, reason: "insecure", detail: url.protocol.replace(":", "") };
  }
  return { ok: true, href: url.href };
}

function isPlugin(value: unknown): value is HarnessPlugin {
  return (
    isRecord(value) &&
    typeof value["id"] === "string" &&
    value["id"] !== "" &&
    typeof value["name"] === "string" &&
    typeof value["activate"] === "function"
  );
}

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/* ---------------- host ---------------- */

export function createPluginHost(opts: {
  getApp: () => AppContext;
  builtins: PluginSource[];
}): PluginHostApi {
  const { getApp, builtins } = opts;
  /** Insertion order is the order shown in the panel. */
  const entries = new Map<string, Entry>();

  /* --- guarded access to the application: during startup it may not exist --- */

  function app(): AppContext | null {
    try {
      return getApp();
    } catch {
      return null;
    }
  }

  function translate(key: string, params?: Record<string, string | number>): string {
    return app()?.t(key, params) ?? key;
  }

  function refreshUi(): void {
    app()?.refreshUi();
  }

  /* --- persistenza --- */

  function persist(): void {
    const list: StoredPlugin[] = [];
    for (const entry of entries.values()) {
      const { record } = entry;
      list.push({
        id: record.id,
        name: record.name,
        version: record.version,
        ...(record.author ? { author: record.author } : {}),
        ...(record.description ? { description: record.description } : {}),
        source: record.source,
        enabled: entry.enabled,
        contributions: record.contributions,
      });
    }
    safeSet(PLUGINS_KEY, JSON.stringify(list));
  }

  /* --- building the entries --- */

  function makeEntry(source: PluginSource, stored: StoredPlugin | null): Entry {
    const id = stored?.id ?? provisionalId(source);
    const record: PluginRecord = {
      id,
      name: stored?.name ?? id,
      version: stored?.version ?? "",
      ...(stored?.author ? { author: stored.author } : {}),
      ...(stored?.description ? { description: stored.description } : {}),
      source,
      status: stored ? (stored.enabled ? "enabled" : "disabled") : "enabled",
      contributions: stored?.contributions ?? [],
    };
    return {
      record,
      enabled: stored?.enabled ?? true,
      plugin: null,
      disposers: [],
      kinds: new Set(),
    };
  }

  /** The final id is the one the module declares: the entry is rekeyed on first load. */
  function rekey(entry: Entry, declaredId: string): void {
    const oldId = entry.record.id;
    if (oldId === declaredId) return;
    const clash = entries.get(declaredId);
    if (clash && clash !== entry) {
      // same plugin reinstalled from another source: the new entry replaces the old
      deactivate(clash);
      entries.delete(declaredId);
    }
    entries.delete(oldId);
    entry.record.id = declaredId;
    entries.set(declaredId, entry);
  }

  function markContribution(entry: Entry, kind: ContributionKind): void {
    if (entry.kinds.has(kind)) return;
    entry.kinds.add(kind);
    entry.record.contributions = [...entry.kinds].map((k) => CONTRIBUTION_KEYS[k]);
  }

  /** Records a removal and hands the plugin an idempotent revoke. */
  function track(entry: Entry, kind: ContributionKind, off: () => void): () => void {
    markContribution(entry, kind);
    entry.disposers.push(off);
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const i = entry.disposers.indexOf(off);
      if (i >= 0) entry.disposers.splice(i, 1);
      try {
        off();
      } catch (err) {
        console.error(`[harness] could not remove a contribution of "${entry.record.id}"`, err);
      }
    };
  }

  /* --- API offerta al plugin --- */

  function makeApi(entry: Entry): PluginAPI {
    const id = entry.record.id;
    const prefix = `harness.plugin.${id}.`;
    const required = (): AppContext => getApp();

    /** A contribution that throws must not break the interface running it. */
    const guard = <A extends unknown[], R>(fn: (...args: A) => R, fallback: R): ((...args: A) => R) => {
      return (...args: A): R => {
        try {
          return fn(...args);
        } catch (err) {
          console.error(`[harness] plugin "${id}" threw`, err);
          return fallback;
        }
      };
    };

    return {
      id,
      appVersion: required().version,
      apiVersion: PLUGIN_API_VERSION,
      t: (key, params) => required().t(key, params),

      getDoc: () => required().store.doc,
      edit: (mutate, reason) => required().store.edit(mutate, reason ?? `plugin:${id}`),
      getSelection: () => required().store.selection,
      select: (selection) => required().store.select(selection),

      commands: {
        register: (command: PluginCommand) => {
          const safe: PluginCommand = {
            ...command,
            run: (ctx) => {
              try {
                return command.run(ctx);
              } catch (err) {
                console.error(`[harness] command "${command.id}" of plugin "${id}" failed`, err);
                return undefined;
              }
            },
          };
          const off = required().commands.register(safe);
          const remove = track(entry, "commands", off);
          refreshUi();
          return remove;
        },
      },

      menu: {
        contribute: (contributor) =>
          track(entry, "menu", registerMenuContributor(guard(contributor, [] as MenuItem[]))),
      },

      validation: {
        addRule: (rule) => track(entry, "rules", registerRule({ ...rule, run: guard(rule.run, []) })),
      },

      exporters: {
        register: (exporter: Exporter) => {
          const list = required().exporters;
          const safe: Exporter = {
            ...exporter,
            run: (ctx) => {
              try {
                return exporter.run(ctx);
              } catch (err) {
                console.error(`[harness] exporter "${exporter.id}" of plugin "${id}" failed`, err);
                return undefined;
              }
            },
          };
          list.push(safe);
          const remove = track(entry, "exporters", () => {
            const i = list.indexOf(safe);
            if (i >= 0) list.splice(i, 1);
            refreshUi();
          });
          refreshUi();
          return remove;
        },
      },

      symbols: {
        registerConnector: (symbol) =>
          track(
            entry,
            "symbols",
            registerConnectorSymbol({
              ...symbol,
              draw: guard<[SVGGElement], void>(symbol.draw.bind(symbol), undefined),
            }),
          ),
      },

      colors: {
        // colour names cannot be revoked: they lie inert until the next reload
        registerName: (name, hex) => {
          markContribution(entry, "colors");
          registerColorName(name, hex);
        },
      },

      i18n: {
        // same for messages: overwriting them has no side effects
        add: (locale, messages) => {
          markContribution(entry, "i18n");
          addMessages(locale, messages);
        },
      },

      ui: {
        toast: (message, options) => {
          const ctx = app();
          if (options) ctx?.toast.show(message, options);
          else ctx?.toast.show(message);
        },
        confirm: (options) => required().dialogs.confirm(options),
        prompt: (options) => required().dialogs.prompt(options),
        sidebarSection: (section) => {
          const list = required().sidebarSections;
          const safe = guard<Parameters<typeof section>, void>(section, undefined);
          list.push(safe);
          const remove = track(entry, "sidebar", () => {
            const i = list.indexOf(safe);
            if (i >= 0) list.splice(i, 1);
            app()?.refreshProps();
          });
          app()?.refreshProps();
          return remove;
        },
      },

      events: {
        on: (event, fn) => {
          // the events exposed to plugins are a subset of the store's, with the
          // same payload; the cast is there purely for the compiler
          const off = required().store.on(event, fn);
          entry.disposers.push(off);
          return () => {
            const i = entry.disposers.indexOf(off);
            if (i >= 0) entry.disposers.splice(i, 1);
            off();
          };
        },
      },

      storage: {
        get: <T>(key: string, fallback: T): T => {
          const raw = safeGet(prefix + key);
          if (raw === null) return fallback;
          try {
            return JSON.parse(raw) as T;
          } catch {
            return fallback;
          }
        },
        set: (key, value) => {
          safeSet(prefix + key, JSON.stringify(value));
        },
        remove: (key) => safeRemove(prefix + key),
      },

      onDispose: (fn) => {
        entry.disposers.push(fn);
      },
    };
  }

  /* --- attivazione e disattivazione --- */

  /**
   * Evaluates a source without going through a module, which is what the
   * single-file build needs: `import()` is forbidden under `file://`. It covers
   * self-contained plugins (one `export default`, no imports), and that is the
   * contract the built-in plugins follow.
   */
  function evaluateSource(code: string): unknown {
    const body = code.replace(/^\s*export\s+default\s+/m, "return ");
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const factory = new Function(`${body}`) as () => unknown;
    return { default: factory() };
  }

  /** Module address, refusing the origins that must not be imported. */
  function moduleUrl(source: PluginSource): string {
    const base = typeof document !== "undefined" ? document.baseURI : "/";
    const checked = checkModuleUrl(source.value, base);
    if (checked.ok) return checked.href;
    throw new Error(
      checked.reason === "malformed"
        ? translate("plugins.error.badUrl", { url: checked.detail })
        : translate("plugins.error.insecureUrl", { protocol: checked.detail }),
    );
  }

  async function importModule(source: PluginSource): Promise<unknown> {
    if (source.kind !== "inline") {
      // built-in plugins embedded for the single-file build: no network, no import
      const name = source.value.split("/").pop() ?? "";
      const bundled = BUNDLED_SOURCES[name];
      if (bundled) return evaluateSource(bundled);
      return import(/* @vite-ignore */ moduleUrl(source));
    }
    // Local code becomes a module through a temporary URL. Under `file://`
    // blob URLs cannot be imported, so it falls back to direct evaluation,
    // which covers self-contained plugins.
    const url = URL.createObjectURL(new Blob([source.value], { type: "text/javascript" }));
    try {
      return await import(/* @vite-ignore */ url);
    } catch (err) {
      if (location.protocol === "file:") return evaluateSource(source.value);
      throw err;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function fail(entry: Entry, message: string): void {
    entry.record.status = "failed";
    entry.record.error = message;
    app()?.toast.error(translate("toast.pluginFailed", { name: entry.record.name, error: message }));
  }

  async function activate(entry: Entry): Promise<void> {
    if (entry.plugin) return;
    delete entry.record.error;

    let module: unknown;
    try {
      module = await importModule(entry.record.source);
    } catch (err) {
      fail(entry, errorText(err));
      return;
    }

    const candidate = (module as PluginModule | undefined)?.default;
    if (!isPlugin(candidate)) {
      fail(entry, translate("plugins.error.noDefault"));
      return;
    }

    rekey(entry, candidate.id);
    entry.record.name = candidate.name || candidate.id;
    entry.record.version = candidate.version ?? "";
    if (candidate.author) entry.record.author = candidate.author;
    else delete entry.record.author;
    if (candidate.description) entry.record.description = candidate.description;
    else delete entry.record.description;
    entry.kinds.clear();
    entry.record.contributions = [];
    entry.plugin = candidate;

    try {
      await candidate.activate(makeApi(entry));
    } catch (err) {
      // half-finished activation: undo whatever was already registered
      dispose(entry);
      entry.plugin = null;
      fail(entry, errorText(err));
      return;
    }

    entry.record.status = "enabled";
  }

  function dispose(entry: Entry): void {
    // reverse order: the last contribution registered is the first to go
    for (const off of [...entry.disposers].reverse()) {
      try {
        off();
      } catch (err) {
        console.error(`[harness] cleanup of plugin "${entry.record.id}" failed`, err);
      }
    }
    entry.disposers = [];
    entry.kinds.clear();
  }

  function deactivate(entry: Entry): void {
    const plugin = entry.plugin;
    entry.plugin = null;
    if (plugin?.deactivate) {
      try {
        plugin.deactivate();
      } catch (err) {
        console.error(`[harness] deactivate() of plugin "${entry.record.id}" failed`, err);
      }
    }
    dispose(entry);
    entry.record.status = "disabled";
    delete entry.record.error;
  }

  /* --- API dell'host --- */

  async function loadAll(): Promise<void> {
    const stored = readStored();
    const byKey = new Map<string, StoredPlugin>();
    for (const s of stored) {
      byKey.set(s.id, s);
      byKey.set(provisionalId(s.source), s);
    }

    // built-in plugins first, then the ones the user installed
    for (const source of builtins) {
      const key = provisionalId(source);
      const known = byKey.get(key) ?? null;
      const entry = makeEntry(source, known);
      entries.set(entry.record.id, entry);
    }
    for (const s of stored) {
      if (s.source.kind === "builtin") continue; // già coperto dall'elenco di serie
      if (entries.has(s.id)) continue;
      entries.set(s.id, makeEntry(s.source, s));
    }

    // sequential: activation order stays predictable and messages stay readable
    for (const entry of [...entries.values()]) {
      if (entry.enabled) await activate(entry);
      else entry.record.status = "disabled";
    }

    persist();
    refreshUi();
  }

  async function install(source: PluginSource): Promise<PluginRecord> {
    // reinstalling the same source replaces the existing entry
    const previous = entries.get(provisionalId(source));
    if (previous) {
      deactivate(previous);
      entries.delete(previous.record.id);
    }
    const entry = makeEntry(source, null);
    entries.set(entry.record.id, entry);
    await activate(entry);
    if (entry.record.status === "enabled") {
      app()?.toast.show(translate("toast.pluginLoaded", { name: entry.record.name }));
    }
    persist();
    refreshUi();
    return entry.record;
  }

  async function setEnabled(id: string, enabled: boolean): Promise<void> {
    const entry = entries.get(id);
    if (!entry) return;
    entry.enabled = enabled;
    if (enabled) await activate(entry);
    else deactivate(entry);
    persist();
    refreshUi();
  }

  function remove(id: string): void {
    const entry = entries.get(id);
    if (!entry) return;
    deactivate(entry);
    if (entry.record.source.kind === "builtin") {
      // a built-in plugin comes back at startup anyway: it can only be disabled
      entry.enabled = false;
      entry.record.status = "disabled";
    } else {
      entries.delete(id);
    }
    persist();
    refreshUi();
  }

  return {
    list: () => [...entries.values()].map((e) => e.record),
    loadAll,
    install,
    setEnabled,
    remove,
  };
}
