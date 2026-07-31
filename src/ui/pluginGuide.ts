import type { AppContext } from "@/app/context";
import { PLUGIN_API_VERSION } from "@/plugins/api";

/**
 * The plugin guide, inside the application.
 *
 * Anyone writing an extension needs three things: a template to copy, the list
 * of what the API offers, and a way to install what they wrote. They are here,
 * next to the plugin panel, because hunting for them in a separate text file is
 * the first reason a plugin never gets written.
 *
 * The prose lives in i18n; what is here is the structure and the code snippets,
 * which are not translated.
 */

const TEMPLATE = `export default {
  id: "mio-plugin",
  name: "Il mio plugin",
  version: "1.0.0",
  author: "Nome Cognome",
  description: "Che cosa fa, in una riga.",

  activate(api) {
    api.commands.register({
      id: "mio-plugin.saluta",
      titleKey: "plugin.mio-plugin.saluta",
      run: () => api.ui.toast("Ciao dal plugin!"),
    });

    api.i18n.add("it", { "plugin.mio-plugin.saluta": "Saluta" });
    api.i18n.add("en", { "plugin.mio-plugin.saluta": "Say hello" });
  },
};`;

const EXAMPLE_RULE = `// una regola che finisce nel rapporto di Verifica
api.validation.addRule({
  id: "mio-plugin.lunghezze",
  run: ({ doc, t }) =>
    doc.segments
      .filter((s) => !s.len.trim())
      .map((s) => ({
        rule: "mio-plugin.lunghezze",
        severity: "warning",
        message: t("plugin.mio-plugin.senzaLunghezza"),
        target: { type: "segment", id: s.id },
      })),
});`;

const EXAMPLE_EDIT = `// ogni modifica al documento passa da api.edit:
// this is a single undo step
api.edit((doc) => {
  for (const table of doc.tables) {
    if (table.kind === "table") table.rows.push(["", "", ""]);
  }
}, "mio-plugin.aggiungiRighe");`;

const EXAMPLE_SYMBOL = `// un simbolo di connettore: il filo entra da destra,
// the drawing extends towards negative x
api.symbols.registerConnector({
  id: "tondo",
  labelKey: "plugin.mio-plugin.tondo",
  tip: 30,
  draw: (g) => {
    const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    c.setAttribute("cx", "-16");
    c.setAttribute("r", "11");
    c.setAttribute("fill", "#c9d2dc");
    c.setAttribute("stroke", "#5b6773");
    g.appendChild(c);
  },
});`;

interface Section {
  titleKey: string;
  bodyKeys: string[];
  code?: string;
  list?: string[];
}

const SECTIONS: Section[] = [
  { titleKey: "guide.plugins.what.title", bodyKeys: ["guide.plugins.what.body"], code: TEMPLATE },
  {
    titleKey: "guide.plugins.install.title",
    bodyKeys: ["guide.plugins.install.body"],
    list: ["guide.plugins.install.url", "guide.plugins.install.file", "guide.plugins.install.bundled"],
  },
  {
    titleKey: "guide.plugins.api.title",
    bodyKeys: ["guide.plugins.api.body"],
    list: [
      "guide.plugins.api.commands",
      "guide.plugins.api.menu",
      "guide.plugins.api.validation",
      "guide.plugins.api.exporters",
      "guide.plugins.api.symbols",
      "guide.plugins.api.colors",
      "guide.plugins.api.i18n",
      "guide.plugins.api.ui",
      "guide.plugins.api.events",
      "guide.plugins.api.storage",
    ],
  },
  { titleKey: "guide.plugins.edit.title", bodyKeys: ["guide.plugins.edit.body"], code: EXAMPLE_EDIT },
  { titleKey: "guide.plugins.rule.title", bodyKeys: ["guide.plugins.rule.body"], code: EXAMPLE_RULE },
  { titleKey: "guide.plugins.symbol.title", bodyKeys: ["guide.plugins.symbol.body"], code: EXAMPLE_SYMBOL },
  {
    titleKey: "guide.plugins.rules.title",
    bodyKeys: ["guide.plugins.rules.body"],
    list: ["guide.plugins.rules.revocable", "guide.plugins.rules.errors", "guide.plugins.rules.trust"],
  },
];

export function renderPluginGuide(app: AppContext, host: HTMLElement): void {
  const { t } = app;
  const doc = document.createElement("div");
  doc.className = "doc";

  const version = document.createElement("p");
  version.className = "muted";
  version.textContent = t("guide.plugins.version", { api: PLUGIN_API_VERSION, app: app.version });
  doc.appendChild(version);

  for (const section of SECTIONS) {
    const title = document.createElement("h3");
    title.textContent = t(section.titleKey);
    doc.appendChild(title);

    for (const key of section.bodyKeys) {
      const p = document.createElement("p");
      p.textContent = t(key);
      doc.appendChild(p);
    }

    if (section.list) {
      const ul = document.createElement("ul");
      for (const key of section.list) {
        const li = document.createElement("li");
        // the entries carry the API name in <code>: this is translation text
        li.innerHTML = t(key);
        ul.appendChild(li);
      }
      doc.appendChild(ul);
    }

    if (section.code) doc.appendChild(codeBlock(app, section.code));
  }

  host.appendChild(doc);
}

/** Code box with the button that copies it to the clipboard. */
function codeBlock(app: AppContext, code: string): HTMLElement {
  const box = document.createElement("div");
  box.className = "doc__code";

  const pre = document.createElement("pre");
  pre.textContent = code;

  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "btn btn--outline btn--small doc__copy";
  copy.textContent = app.t("guide.plugins.copy");
  copy.addEventListener("click", () => {
    navigator.clipboard
      ?.writeText(code)
      .then(() => app.toast.show(app.t("guide.plugins.copied")))
      .catch(() => {
        // without clipboard permission, selecting by hand still works
        const range = document.createRange();
        range.selectNodeContents(pre);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      });
  });

  box.append(pre, copy);
  return box;
}
