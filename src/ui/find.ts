/**
 * Find and replace, in a floating panel.
 *
 * It stays open while work goes on, so a replace can be followed by a look at
 * what it did. The query, the options and the position are kept here and not in
 * the panel: the panel is rebuilt by a change of language or a second Ctrl+F,
 * and the search must survive that.
 */
import type { AppContext } from "@/app/context";
import { DEFAULT_FIND_OPTIONS, cellKey, findAll, replaceAll, replaceAt, tableOfTarget } from "@/core/find";
import type { FindTarget, ReplaceResult } from "@/core/find";
import type { Selection } from "@/core/types";
import type { FoundMarks } from "@/render/tables";
import { icon } from "./icons";
import { closePanel, isPanelOpen, openPanel } from "./panel";
import { setViewMode, showsBoard } from "./viewmode";

const PANEL_ID = "find";

export type FindMode = "find" | "replace";

const state = {
  mode: "find" as FindMode,
  query: "",
  replacement: "",
  options: { ...DEFAULT_FIND_OPTIONS },
  index: 0,
  hits: [] as FindTarget[],
};

let watching = false;

/** What picking this match means to the rest of the application. */
function selectionFor(app: AppContext, hit: FindTarget): Selection | null {
  switch (hit.kind) {
    case "title":
    case "head":
    case "cell":
      return { type: "table", id: hit.table };
    case "connector":
      return { type: "node", id: hit.node };
    case "length":
      return { type: "segment", id: hit.segment };
    case "label":
      return { type: "inline", id: hit.inline };
    case "meta": {
      const block = app.doc.tables.find((tb) => tb.kind === "title");
      return block ? { type: "table", id: block.id } : null;
    }
  }
}

function marksFor(hits: readonly FindTarget[], current: FindTarget | undefined): FoundMarks {
  const tables = new Map<string, Set<string>>();
  for (const hit of hits) {
    const table = tableOfTarget(hit);
    const key = cellKey(hit);
    if (!table || !key) continue;
    const keys = tables.get(table) ?? new Set<string>();
    keys.add(key);
    tables.set(table, keys);
  }
  const table = current ? tableOfTarget(current) : null;
  const key = current ? cellKey(current) : null;
  return { tables, current: table && key ? `${table}|${key}` : null };
}

/** Looks again at the drawing and marks what matches. Does not move the view. */
function search(app: AppContext): void {
  state.hits = findAll(app.doc, state.query, state.options);
  if (state.index >= state.hits.length) state.index = 0;
  const marks = state.query ? marksFor(state.hits, state.hits[state.index]) : null;
  app.renderer.found = marks;
  app.renderer.requestRedraw();
}

/** Brings the current match into view and selects what it belongs to. */
function reveal(app: AppContext): void {
  const hit = state.hits[state.index];
  if (!hit) return;
  const selection = selectionFor(app, hit);
  if (!selection) return;
  app.store.select(selection);
  // the sheet may not even be on screen: it is brought out first, then centred
  if (!showsBoard()) setViewMode("split");
  requestAnimationFrame(() => {
    const box = app.renderer.entityBBox(selection);
    if (box) app.renderer.centerOn(box);
  });
}

function step(app: AppContext, by: 1 | -1): void {
  if (!state.hits.length) return;
  state.index = (state.index + by + state.hits.length) % state.hits.length;
  search(app);
  reveal(app);
}

function statusText(app: AppContext): string {
  const { t } = app;
  if (!state.query) return t("find.idle");
  if (!state.hits.length) return t("find.none");
  return t("find.status", { n: state.index + 1, total: state.hits.length });
}

function replaceCurrent(app: AppContext): void {
  const hit = state.hits[state.index];
  if (!hit) return;
  const was = JSON.stringify(hit);
  const changed = app.store.edit((doc) => {
    replaceAt(doc, hit, state.query, state.replacement, state.options);
  }, "replace");
  if (!changed) {
    app.toast.error(app.t("find.refused"));
    return;
  }
  // The edit has already searched again. If the match is still there — the
  // replacement contains the query — the next one is the one after it, or
  // pressing Replace would never leave this spot.
  if (state.hits[state.index] && JSON.stringify(state.hits[state.index]) === was) state.index++;
  if (state.index >= state.hits.length) state.index = 0;
  search(app);
  reveal(app);
}

function replaceEverywhere(app: AppContext): void {
  if (!state.hits.length) return;
  let result: ReplaceResult = { changed: 0, held: 0 };
  app.store.edit((doc) => {
    result = replaceAll(doc, state.query, state.replacement, state.options);
  }, "replace-all");
  const { changed: n, held } = result;
  if (!n) {
    app.toast.error(app.t("find.refused"));
    return;
  }
  if (held) {
    app.toast.show(app.t("find.replacedHeld", { n, held }));
    return;
  }
  app.toast.show(n === 1 ? app.t("find.replacedOne") : app.t("find.replaced", { n }));
}

/* ---------------- panel ---------------- */

function field(label: string, input: HTMLInputElement): HTMLElement {
  const wrap = document.createElement("label");
  wrap.className = "field";
  const text = document.createElement("span");
  text.className = "field__label";
  text.textContent = label;
  wrap.append(text, input);
  return wrap;
}

function textInput(value: string): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "text";
  input.value = value;
  input.autocomplete = "off";
  input.spellcheck = false;
  return input;
}

function checkbox(label: string, checked: boolean, onChange: (value: boolean) => void): HTMLElement {
  const wrap = document.createElement("label");
  wrap.className = "find__option";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = checked;
  box.addEventListener("change", () => onChange(box.checked));
  const text = document.createElement("span");
  text.textContent = label;
  wrap.append(box, text);
  return wrap;
}

function action(label: string, onClick: () => void, primary = false): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "btn btn--small" + (primary ? " btn--primary" : " btn--outline");
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

/** A small button with an icon for a face; the words are in the tooltip and for a screen reader. */
function arrow(name: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "btn btn--outline btn--icon btn--small";
  b.setAttribute("aria-label", label);
  b.dataset["tip"] = label;
  b.appendChild(icon(name, 12));
  b.addEventListener("click", onClick);
  return b;
}

function renderFind(app: AppContext, body: HTMLElement): void {
  const { t } = app;
  body.replaceChildren();
  body.classList.add("find");

  const status = document.createElement("div");
  status.className = "small find__status";
  status.setAttribute("aria-live", "polite");
  const refreshStatus = (): void => {
    status.textContent = statusText(app);
  };

  const query = textInput(state.query);
  query.setAttribute("aria-label", t("find.find"));
  query.addEventListener("input", () => {
    state.query = query.value;
    state.index = 0;
    search(app);
    refreshStatus();
    reveal(app);
  });

  const replacement = textInput(state.replacement);
  replacement.setAttribute("aria-label", t("find.replace"));
  replacement.addEventListener("input", () => {
    state.replacement = replacement.value;
  });

  // The keyboard belongs to a field while it has focus, so the shortcuts that
  // open this panel are handled here too, or Ctrl+H would hand the browser its
  // history instead of showing the replace field.
  const onKeys = (ev: KeyboardEvent): void => {
    const mod = ev.ctrlKey || ev.metaKey;
    const key = ev.key.toLowerCase();
    if (mod && (key === "f" || key === "h")) {
      ev.preventDefault();
      openFind(app, key === "h" ? "replace" : "find");
    }
  };

  query.addEventListener("keydown", (ev) => {
    onKeys(ev);
    if (ev.key === "Enter") {
      ev.preventDefault();
      step(app, ev.shiftKey ? -1 : 1);
      refreshStatus();
    }
  });
  replacement.addEventListener("keydown", (ev) => {
    onKeys(ev);
    if (ev.key === "Enter") {
      ev.preventDefault();
      replaceCurrent(app);
      refreshStatus();
    }
  });

  // previous above next, to the right of the field they act on
  const arrows = document.createElement("div");
  arrows.className = "find__arrows";
  arrows.append(
    arrow("chevronUp", t("find.prev"), () => {
      step(app, -1);
      refreshStatus();
    }),
    arrow("chevron", t("find.next"), () => {
      step(app, 1);
      refreshStatus();
    }),
  );
  const findRow = document.createElement("div");
  findRow.className = "find__row";
  findRow.append(field(t("find.find"), query), arrows);
  body.appendChild(findRow);
  if (state.mode === "replace") body.appendChild(field(t("find.replace"), replacement));

  const options = document.createElement("div");
  options.className = "find__options";
  options.append(
    checkbox(t("find.matchCase"), state.options.matchCase, (value) => {
      state.options = { ...state.options, matchCase: value };
      state.index = 0;
      search(app);
      refreshStatus();
    }),
    checkbox(t("find.whole"), state.options.whole, (value) => {
      state.options = { ...state.options, whole: value };
      state.index = 0;
      search(app);
      refreshStatus();
    }),
  );
  body.appendChild(options);

  const buttons = document.createElement("div");
  buttons.className = "stack";
  if (state.mode === "replace") {
    buttons.append(
      action(
        t("find.replaceOne"),
        () => {
          replaceCurrent(app);
          refreshStatus();
        },
        true,
      ),
      action(t("find.replaceAll"), () => {
        replaceEverywhere(app);
        refreshStatus();
      }),
    );
    body.appendChild(buttons);
  }

  refreshStatus();
  body.appendChild(status);

  // the status line is kept honest while the drawing changes under the panel
  if (!watching) {
    watching = true;
    app.store.on("doc", ({ reason }) => {
      if (!isPanelOpen(PANEL_ID)) return;
      if (reason === "view" || reason === "selection" || reason === "tool") return;
      search(app);
      const line = document.querySelector<HTMLElement>(".find__status");
      if (line) line.textContent = statusText(app);
    });
  }

  requestAnimationFrame(() => {
    query.focus();
    query.select();
  });
}

/** Opens the panel in the given mode, with the search as it was left. */
export function openFind(app: AppContext, mode: FindMode): void {
  state.mode = mode;
  openPanel({
    id: PANEL_ID,
    title: app.t(mode === "replace" ? "find.title" : "find.titleFind"),
    width: 330,
    dock: "top-right",
    render: (body) => renderFind(app, body),
    onClose: () => {
      app.renderer.found = null;
      app.renderer.requestRedraw();
    },
  });
  search(app);
}

export function closeFind(): void {
  closePanel(PANEL_ID);
}
