/**
 * The plugin panel: the installed list with status and contributions, enable,
 * disable and remove, plus installing from a URL or from
 * file locale.
 *
 * The trust warning is the first thing shown: a plugin runs with the same
 * permissions as the page, so the decision to install one should be informed.
 */
import type { AppContext, PluginRecord } from "@/app/context";

/** Documentation for plugin authors, shipped with the project. */

export function renderPluginsPanel(app: AppContext, host: HTMLElement): void {
  const { t } = app;
  /** Turns true after a change: only then is the reload hint worth showing. */
  let changed = false;

  const make = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className?: string,
    text?: string,
  ): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const fileInput = make("input");
  fileInput.type = "file";
  fileInput.accept = ".js,.mjs,text/javascript";
  fileInput.hidden = true;
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (file) void installFromFile(file);
  });

  async function installFromUrl(): Promise<void> {
    const url = await app.dialogs.prompt({
      title: t("plugins.url.title"),
      label: t("plugins.url.label"),
      placeholder: t("plugins.url.placeholder"),
    });
    const value = url?.trim();
    if (!value) return;
    await install({ kind: "url", value });
  }

  async function installFromFile(file: File): Promise<void> {
    let code: string;
    try {
      code = await file.text();
    } catch {
      app.toast.error(t("plugins.error.fileRead"));
      return;
    }
    await install({ kind: "inline", value: code });
  }

  async function install(source: { kind: "url" | "inline"; value: string }): Promise<void> {
    try {
      await app.plugins.install(source);
    } catch (err) {
      app.toast.error(err instanceof Error ? err.message : String(err));
    }
    changed = true;
    render();
  }

  async function toggle(record: PluginRecord): Promise<void> {
    await app.plugins.setEnabled(record.id, record.status === "disabled");
    changed = true;
    render();
  }

  async function remove(record: PluginRecord): Promise<void> {
    const ok = await app.dialogs.confirm({
      title: t("plugins.remove"),
      body: t("plugins.remove.body", { name: record.name }),
      confirmLabel: t("plugins.remove"),
      danger: true,
    });
    if (!ok) return;
    app.plugins.remove(record.id);
    changed = true;
    render();
  }

  /** The "v1.2 · by Someone · built-in" line, with only the parts actually known. */
  function metaLine(record: PluginRecord): string {
    const parts: string[] = [];
    if (record.version) parts.push(`v${record.version}`);
    if (record.author) parts.push(t("plugins.author", { author: record.author }));
    if (record.source.kind === "builtin") parts.push(t("plugins.builtin"));
    else if (record.source.kind === "url") parts.push(t("plugins.source.url", { url: record.source.value }));
    else parts.push(t("plugins.source.file"));
    return parts.join(" · ");
  }

  function statusChip(record: PluginRecord): HTMLElement {
    const map = {
      enabled: { cls: "chip chip--ok", key: "plugins.enabled" },
      disabled: { cls: "chip chip--off", key: "plugins.disabled" },
      failed: { cls: "chip chip--error", key: "plugins.failed" },
    } as const;
    const style = map[record.status];
    return make("span", style.cls, t(style.key));
  }

  function card(record: PluginRecord): HTMLElement {
    const box = make("div", "plugin");

    const head = make("div", "plugin__head");
    head.append(make("span", "plugin__name", record.name), statusChip(record));
    box.append(head, make("div", "plugin__meta", metaLine(record)));

    if (record.description) box.append(make("div", "plugin__meta", record.description));
    if (record.contributions.length > 0) {
      const list = record.contributions.map((key) => t(key)).join(", ");
      box.append(make("div", "plugin__meta", t("plugins.contributes", { list })));
    }
    if (record.error) box.append(make("div", "plugin__error", record.error));

    const actions = make("div", "plugin__actions");
    const enabled = record.status !== "disabled";
    const toggleBtn = make("button", "btn btn--small", t(enabled ? "plugins.disable" : "plugins.enable"));
    toggleBtn.type = "button";
    toggleBtn.setAttribute("aria-label", `${toggleBtn.textContent} · ${record.name}`);
    toggleBtn.addEventListener("click", () => void toggle(record));
    actions.append(toggleBtn);

    // a built-in plugin cannot be uninstalled: it would come back at next startup
    if (record.source.kind !== "builtin") {
      const removeBtn = make("button", "btn btn--small btn--danger", t("plugins.remove"));
      removeBtn.type = "button";
      removeBtn.setAttribute("aria-label", `${t("plugins.remove")} · ${record.name}`);
      removeBtn.addEventListener("click", () => void remove(record));
      actions.append(removeBtn);
    }

    box.append(actions);
    return box;
  }

  function render(): void {
    host.replaceChildren();

    host.append(make("p", "muted", t("plugins.trustWarning")));

    const tools = make("div", "stack");
    const urlBtn = make("button", "btn", t("plugins.addFromUrl"));
    urlBtn.type = "button";
    urlBtn.addEventListener("click", () => void installFromUrl());
    const fileBtn = make("button", "btn", t("plugins.addFromFile"));
    fileBtn.type = "button";
    fileBtn.addEventListener("click", () => fileInput.click());
    tools.append(urlBtn, fileBtn, fileInput);
    host.append(tools);

    const records = app.plugins.list();
    const section = make("div", "field");
    section.append(make("div", "field__label", t("plugins.installed")));
    if (records.length === 0) {
      section.append(make("p", "muted", t("plugins.none")));
    } else {
      for (const record of records) section.append(card(record));
    }
    host.append(section);

    if (changed) host.append(make("p", "muted", t("plugins.reloadHint")));

    // the guide lives inside the program: no link to chase, and it works in
    // the single-file copy too, where `docs/` does not exist
    const docs = document.createElement("button");
    docs.type = "button";
    docs.className = "btn btn--outline btn--small";
    docs.textContent = t("plugins.docsLink");
    docs.addEventListener("click", () => app.showPluginGuide());
    host.append(docs);
  }

  render();
}
