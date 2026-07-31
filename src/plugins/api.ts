/**
 * Public plugin API of Harness Designer.
 *
 * This file holds types only: it is the reference document for anyone writing
 * an extension. A plugin is an ES module whose `default` export is a
 * {@link HarnessPlugin} object; the application imports it, from a URL or from
 * a local file, and calls `activate` with a {@link PluginAPI}.
 *
 * Smallest possible example:
 *
 * ```js
 * export default {
 *   id: "acme.example",
 *   name: "Example",
 *   version: "1.0.0",
 *   activate(api) {
 *     api.i18n.add("en", { "plugin.acme.example.hello": "Say hello" });
 *     api.commands.register({
 *       id: "acme.example.hello",
 *       titleKey: "plugin.acme.example.hello",
 *       run: () => api.ui.toast("Hello!"),
 *     });
 *   },
 * };
 * ```
 *
 * Rules that matter when writing a plugin:
 * - plugins run in the page's own context, with no sandbox: they are code the
 *   user has chosen to trust;
 * - every registration returns a removal function and the host collects them
 *   all, so on deactivation the contribution disappears without reloading the
 *   page. Keeping your own reference is not required, though it does let you
 *   remove a single contribution earlier;
 * - every text shown to the user goes through an i18n key registered with
 *   `api.i18n.add`; by convention a plugin's keys start with `plugin.<id>.`;
 * - changes to the document always go through `api.edit`, which keeps them
 *   undoable and saves them automatically.
 */
import type {
  AppContext,
  ConfirmOptions,
  Exporter,
  PromptOptions,
  SidebarSection,
  ToastOptions,
} from "@/app/context";
import type { HarnessDoc, Point, Selection } from "@/core/types";
import type { ValidationRule } from "@/core/validate";
import type { Locale, Messages, Translate } from "@/i18n";
import type { ConnectorSymbol } from "@/render/connectors";
import type { MenuItem } from "@/ui/menu";

/**
 * Version of the contract described here. It only goes up on a breaking
 * change, so a plugin can compare it and refuse to activate.
 */
export const PLUGIN_API_VERSION = 1;

/** localStorage key holding the list of installed plugins. */
export const PLUGINS_KEY = "harness.plugins.v1";

/* ---------------- the plugin ---------------- */

/**
 * The object a plugin module exports as `default`.
 * `id` has to stay stable across versions: it identifies the plugin in the
 * installed list and prefixes its storage keys.
 */
export interface HarnessPlugin {
  id: string;
  name: string;
  version?: string;
  author?: string;
  description?: string;
  /** Called on activation. May be async; the host awaits it. */
  activate(api: PluginAPI): void | Promise<void>;
  /**
   * Called on deactivation, before the host revokes the registrations. Only
   * needed for what the host cannot undo by itself: timers, DOM listeners you
   * added by hand, and the like.
   */
  deactivate?(): void;
}

/** Expected shape of the imported module. */
export interface PluginModule {
  default?: HarnessPlugin;
}

/* ---------------- individual contributions ---------------- */

/**
 * A command callable from the palette (Ctrl+K) and from a shortcut.
 * `titleKey` is an i18n key, not a piece of text.
 */
export interface PluginCommand {
  id: string;
  titleKey: string;
  /** declarative shortcut, e.g. "Ctrl+Shift+E", "F2" */
  shortcut?: string;
  /** grouping in the palette, an i18n key */
  groupKey?: string;
  /** false hides the command from the palette; it stays callable by id */
  palette?: boolean;
  enabled?(app: AppContext): boolean;
  run(app: AppContext): void | Promise<void>;
}

/** The context a right-click menu opens in. */
export interface MenuContext {
  /** element under the pointer, `null` on empty sheet */
  target: Selection | null;
  /** click position in document coordinates */
  world: Point;
  app: AppContext;
}

/**
 * Function that adds entries to the right-click menu. It is called every time
 * the menu opens and must return a list, possibly empty, with no side effects.
 */
export type MenuContributor = (ctx: MenuContext) => MenuItem[];

/** Events a plugin can observe, with their payloads. */
export interface PluginEvents {
  /** the document changed; `reason` says what caused it */
  doc: { reason: string };
  selection: { selection: Selection | null };
  /** the document was replaced: file opened, new, or sample */
  load: { doc: HarnessDoc };
}

export type PluginEvent = keyof PluginEvents;

/**
 * The plugin's persistent storage. Keys are prefixed with the plugin id
 * automatically, so two plugins can never tread on each other. Values go
 * through JSON, so they have to be serializable.
 */
export interface PluginStorage {
  get<T>(key: string, fallback: T): T;
  set(key: string, value: unknown): void;
  remove(key: string): void;
}

/* ---------------- the API handed to activate ---------------- */

export interface PluginAPI {
  /** plugin id, as declared in the module */
  readonly id: string;
  /** version of the host application */
  readonly appVersion: string;
  /** version of this contract */
  readonly apiVersion: number;
  /** translation: `t("key", { param })` */
  readonly t: Translate;

  /** The current document. Never mutate it directly: use `edit`. */
  getDoc(): HarnessDoc;
  /** Changes the document in one undoable step. `false` if nothing changed. */
  edit(mutate: (doc: HarnessDoc) => void, reason?: string): boolean;
  getSelection(): Selection | null;
  select(selection: Selection | null): void;

  commands: {
    register(command: PluginCommand): () => void;
  };
  menu: {
    contribute(contributor: MenuContributor): () => void;
  };
  validation: {
    addRule(rule: ValidationRule): () => void;
  };
  exporters: {
    register(exporter: Exporter): () => void;
  };
  symbols: {
    registerConnector(symbol: ConnectorSymbol): () => void;
  };
  colors: {
    /**
     * Adds a colour name recognized in the tables, for instance the DIN codes
     * "SW" and "RT". Names stay registered until the page is reloaded.
     */
    registerName(name: string, hex: string): void;
  };
  i18n: {
    /**
     * Adds messages to the given locale. They stay available until the page is
     * reloaded, even after deactivation: harmless, but a good reason to prefix
     * keys with the plugin id.
     */
    add(locale: Locale, messages: Messages): void;
  };
  ui: {
    toast(message: string, options?: ToastOptions): void;
    confirm(options: ConfirmOptions): Promise<boolean>;
    prompt(options: PromptOptions): Promise<string | null>;
    /** Adds a section at the bottom of the properties panel. */
    sidebarSection(section: SidebarSection): () => void;
  };
  events: {
    on<K extends PluginEvent>(event: K, fn: (payload: PluginEvents[K]) => void): () => void;
  };
  storage: PluginStorage;
  /** Registers a cleanup to run on deactivation. */
  onDispose(fn: () => void): void;
}

/* ---------------- contribution categories ---------------- */

/**
 * i18n keys used by the "Adds: …" list in the plugin panel. Keys rather than
 * text, because the list is persisted and has to follow the chosen language.
 */
export const CONTRIBUTION_KEYS = {
  commands: "plugins.contrib.commands",
  menu: "plugins.contrib.menu",
  rules: "plugins.contrib.rules",
  exporters: "plugins.contrib.exporters",
  symbols: "plugins.contrib.symbols",
  colors: "plugins.contrib.colors",
  sidebar: "plugins.contrib.sidebar",
  i18n: "plugins.contrib.i18n",
} as const;

export type ContributionKind = keyof typeof CONTRIBUTION_KEYS;

/* ---------------- convenience re-exports ---------------- */

/** Types a plugin author reaches for often, re-exported for a single import. */
export type {
  AppContext,
  ConfirmOptions,
  ConnectorSymbol,
  Exporter,
  Locale,
  Messages,
  MenuItem,
  PromptOptions,
  SidebarSection,
  ToastOptions,
  Translate,
  ValidationRule,
};
export type { HarnessDoc, HNode, Inline, Issue, Point, Rect, Segment, Selection, Table } from "@/core/types";
