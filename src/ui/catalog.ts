/**
 * Picking from the housing and termination tables, adding to them, and asking
 * before something that is in use is deleted.
 *
 * A cavity table points at one housing, and each of its rows at one
 * termination. Neither is typed: it is picked from the catalogue, and when the
 * one needed is not there yet "+ New" adds it on the spot and picks it, so the
 * person never has to leave what they were doing to go and fill in a table.
 */
import type { AppContext } from "@/app/context";
import {
  addEntry,
  catalogFields,
  catalogOf,
  fieldColumn,
  fitCavityRows,
  housingCavities,
  isCatalog,
  nameIsFree,
  removeEntry,
  totalUsage,
  unassignEntry,
  usageOf,
} from "@/core/catalog";
import type { CatalogField, CatalogKind, EntryValues, Fitted } from "@/core/catalog";
import { cell, deleteEntity, findTable, ownerName, tableColumns } from "@/core/doc";
import { catalogTable } from "@/core/factories";
import { snapTo } from "@/core/geometry";
import type { Table } from "@/core/types";
import { symbolsWithRole } from "@/render/connectors";
import { tableSize } from "@/render/tables";
import { openDialog } from "./dialogs";
import { insertTable, viewCenter } from "./insert";

/* ============================ the tables themselves ============================ */

/** The entries a new catalogue starts with: every symbol the program has for it. */
function seedsFor(app: AppContext, kind: CatalogKind) {
  const role = kind === "housings" ? "housing" : "termination";
  return symbolsWithRole(role).map((symbol) => ({ name: app.t(symbol.labelKey), symbol: symbol.id }));
}

/** Puts the housing or termination table on the sheet, or shows the one that is already there. */
export function insertCatalog(app: AppContext, kind: CatalogKind): void {
  const existing = catalogOf(app.doc, kind);
  if (existing) {
    app.store.select({ type: "table", id: existing.id });
    app.toast.show(app.t(kind === "housings" ? "toast.housingsExist" : "toast.terminationsExist"));
    return;
  }
  insertTable(app, catalogTable(app.t, kind, 0, 0, seedsFor(app, kind)));
}

/** Each of the two for a new drawing, one under the other. */
export function startingCatalogs(app: AppContext): Table[] {
  const housings = catalogTable(app.t, "housings", 0, 0, seedsFor(app, "housings"));
  const gap = 40;
  const below = tableSize(housings, app.doc.meta, app.t).h + gap;
  return [housings, catalogTable(app.t, "terminations", 0, below, seedsFor(app, "terminations"))];
}

/* ============================ choosing ============================ */

export type Choice = { type: "pick"; key: string } | { type: "new" } | { type: "none" };

interface Pickable {
  key: string;
  name: string;
  detail: string;
}

interface PickOptions {
  title: string;
  items: readonly Pickable[];
  /** the one it is now, which starts highlighted */
  current?: string;
  /** offers "None", for taking the choice back */
  clearable: boolean;
  newLabel: string;
}

/** A list to filter and pick from, with "+ New" beside it. */
function pickFrom(app: AppContext, options: PickOptions): Promise<Choice | null> {
  const t = app.t;
  let chosen: Choice | null = null;
  let shown = [...options.items];
  let active = Math.max(
    0,
    shown.findIndex((item) => item.key === options.current),
  );

  return openDialog<Choice | null>({
    title: options.title,
    confirmLabel: t("catalog.choose"),
    cancelLabel: t("dialog.cancel"),
    fillBody: (body, submit) => {
      const field = document.createElement("div");
      field.className = "field";
      const search = document.createElement("input");
      search.type = "search";
      search.autocomplete = "off";
      search.placeholder = t("catalog.search");
      search.setAttribute("aria-label", t("catalog.search"));
      field.append(search);

      const list = document.createElement("div");
      list.className = "picker__list";
      list.setAttribute("role", "listbox");

      const draw = (): void => {
        list.replaceChildren();
        if (!shown.length) {
          const empty = document.createElement("div");
          empty.className = "picker__empty";
          empty.textContent = t(options.items.length ? "catalog.noMatch" : "catalog.empty");
          list.append(empty);
          return;
        }
        shown.forEach((item, i) => {
          const row = document.createElement("button");
          row.type = "button";
          row.tabIndex = -1;
          row.className = "picker__item" + (i === active ? " is-active" : "");
          row.setAttribute("role", "option");
          row.setAttribute("aria-selected", String(i === active));
          const name = document.createElement("span");
          name.textContent = item.name;
          const detail = document.createElement("small");
          detail.textContent = item.detail;
          row.append(name, detail);
          row.addEventListener("click", () => {
            chosen = { type: "pick", key: item.key };
            submit();
          });
          list.append(row);
        });
        list.querySelector(".is-active")?.scrollIntoView({ block: "nearest" });
      };

      search.addEventListener("input", () => {
        const q = search.value.trim().toLowerCase();
        shown = options.items.filter((item) => `${item.name} ${item.detail}`.toLowerCase().includes(q));
        active = 0;
        draw();
      });
      search.addEventListener("keydown", (ev) => {
        if (ev.key !== "ArrowDown" && ev.key !== "ArrowUp") return;
        ev.preventDefault();
        if (!shown.length) return;
        active = (active + (ev.key === "ArrowDown" ? 1 : -1) + shown.length) % shown.length;
        draw();
      });

      const more = document.createElement("div");
      more.className = "picker__more";
      const add = (label: string, choice: Choice, primary = false): void => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = primary ? "btn btn--primary" : "btn";
        button.textContent = label;
        button.addEventListener("click", () => {
          chosen = choice;
          submit();
        });
        more.append(button);
      };
      add(options.newLabel, { type: "new" });
      if (options.clearable) add(t("catalog.none"), { type: "none" });

      draw();
      body.append(field, list, more);
      return search;
    },
    // Enter takes the highlighted entry, as a click on it would
    confirmValue: () => {
      const item = shown[active];
      return chosen ?? (item ? { type: "pick", key: item.key } : null);
    },
    cancelValue: () => null,
  });
}

const detailOf = (kind: CatalogKind, row: readonly string[]): string => {
  const at = (field: CatalogField): string => (row[fieldColumn(kind, field)] ?? "").trim();
  return [at("partNumber"), at("series"), at("manufacturer")].filter(Boolean).join(" · ");
};

function pickEntry(
  app: AppContext,
  kind: CatalogKind,
  title: string,
  current: string,
): Promise<Choice | null> {
  const table = catalogOf(app.doc, kind);
  const items: Pickable[] = (table?.rows ?? [])
    .map((row) => ({ key: (row[0] ?? "").trim(), name: (row[0] ?? "").trim(), detail: detailOf(kind, row) }))
    .filter((item) => item.name);
  return pickFrom(app, {
    title,
    items,
    current,
    clearable: current.trim() !== "",
    newLabel: app.t("catalog.new"),
  });
}

/* ============================ adding ============================ */

interface FormResult {
  values: EntryValues;
  symbol: string;
}

/** The fields of a new entry. Quantity and where-used are worked out, so they are not asked for. */
function entryForm(
  app: AppContext,
  kind: CatalogKind,
  initial: Record<string, string>,
): Promise<FormResult | null> {
  const t = app.t;
  const fields = catalogFields(kind).filter((f) => f !== "quantity" && f !== "whereUsed");
  const symbols = symbolsWithRole(kind === "housings" ? "housing" : "termination");
  const controls = new Map<string, HTMLInputElement | HTMLSelectElement>();

  const labelOf: Record<string, string> = {
    name: kind === "housings" ? "catalog.head.name" : "catalog.head.termination",
    cavities: "catalog.head.cavities",
    partNumber: "meta.partNumber",
    manufacturer: "catalog.head.manufacturer",
    series: "catalog.head.series",
    form: "catalog.head.form",
    description: "table.head.description",
  };

  const wrap = (id: string, label: string, control: HTMLElement): HTMLElement => {
    const field = document.createElement("div");
    field.className = "field";
    const caption = document.createElement("label");
    caption.className = "field__label";
    caption.htmlFor = id;
    caption.textContent = label;
    field.append(caption, control);
    return field;
  };

  return openDialog<FormResult | null>({
    title: t(kind === "housings" ? "catalog.new.housing" : "catalog.new.termination"),
    confirmLabel: t("dialog.ok"),
    cancelLabel: t("dialog.cancel"),
    fillBody: (body) => {
      const made = new Map<string, HTMLElement>();
      for (const name of fields) {
        const id = `catalog-${name}`;
        let control: HTMLInputElement | HTMLSelectElement;
        if (name === "form") {
          const select = document.createElement("select");
          for (const [value, key] of [
            ["", "catalog.form.none"],
            [t("catalog.form.plug"), "catalog.form.plug"],
            [t("catalog.form.receptacle"), "catalog.form.receptacle"],
          ] as const) {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = t(key);
            select.append(option);
          }
          select.value = initial[name] ?? "";
          control = select;
        } else {
          const input = document.createElement("input");
          input.type = name === "cavities" ? "number" : "text";
          if (name === "cavities") input.min = "1";
          input.autocomplete = "off";
          input.value = initial[name] ?? "";
          control = input;
        }
        control.id = id;
        controls.set(name, control);
        made.set(name, wrap(id, t(labelOf[name] ?? name), control));
      }

      const pair = (a: string, b: string): void => {
        const first = made.get(a);
        const second = made.get(b);
        if (!first || !second) return;
        const row = document.createElement("div");
        row.className = "row2";
        row.append(first, second);
        body.append(row);
        made.delete(a);
        made.delete(b);
      };
      body.append(made.get("name") ?? "");
      made.delete("name");
      pair("cavities", "form");
      pair("partNumber", "manufacturer");
      for (const field of made.values()) body.append(field);

      if (symbols.length > 1) {
        const select = document.createElement("select");
        select.id = "catalog-symbol";
        for (const symbol of symbols) {
          const option = document.createElement("option");
          option.value = symbol.id;
          option.textContent = t(symbol.labelKey);
          select.append(option);
        }
        select.value = initial["symbol"] ?? symbols[0]?.id ?? "";
        controls.set("symbol", select);
        body.append(wrap("catalog-symbol", t("catalog.symbol"), select));
      }
      return controls.get("name") ?? null;
    },
    confirmValue: () => {
      const values: Record<string, string> = {};
      for (const name of fields) values[name] = controls.get(name)?.value ?? "";
      return { values, symbol: controls.get("symbol")?.value ?? symbols[0]?.id ?? "" };
    },
    cancelValue: () => null,
  });
}

/**
 * Asks for a new entry and adds it, creating the catalogue first if the drawing
 * has none. Asks again, with what was typed still in it, until the name is one
 * the table can take. Returns the name, or null if it was given up.
 */
export async function createEntry(app: AppContext, kind: CatalogKind): Promise<string | null> {
  let initial: Record<string, string> = {};
  for (;;) {
    const result = await entryForm(app, kind, initial);
    if (!result) return null;
    const name = (result.values.name ?? "").trim();
    const existing = catalogOf(app.doc, kind);
    if (!name) {
      app.toast.error(app.t("catalog.nameRequired"));
    } else if (existing && !nameIsFree(existing, name)) {
      app.toast.error(app.t("catalog.nameTaken", { name }));
    } else {
      app.store.edit((doc) => {
        let table = catalogOf(doc, kind);
        if (!table) {
          table = catalogTable(app.t, kind, 0, 0);
          const centre = viewCenter(app);
          table.x = snapTo(centre.x, app.store.snapEnabled);
          table.y = snapTo(centre.y, app.store.snapEnabled);
          doc.tables.push(table);
        }
        addEntry(table, result.values, result.symbol);
      }, "catalog-add");
      return name;
    }
    initial = { ...result.values, symbol: result.symbol };
  }
}

/* ============================ assigning ============================ */

/** The name a cavity table goes by in a question: its connector's. */
const nameOf = (app: AppContext, table: Table): string =>
  ownerName(app.doc, table) || (table.title ?? "").trim() || app.t("props.linkedNode.unnamed");

/** Picks the housing of a cavity table, or takes it away. */
export async function assignHousing(app: AppContext, tableId: string): Promise<void> {
  const table = findTable(app.doc, tableId);
  if (!table || table.kind !== "table") return;
  const choice = await pickEntry(
    app,
    "housings",
    app.t("catalog.pick.housing", { name: nameOf(app, table) }),
    table.housing ?? "",
  );
  if (!choice) return;
  let name: string | null = null;
  if (choice.type === "pick") name = choice.key;
  if (choice.type === "new") {
    name = await createEntry(app, "housings");
    if (name === null) return;
  }
  // The table is made as long as the housing has cavities: longer, it grows;
  // shorter, it loses only the empty rows at its end.
  let fitted: Fitted = { added: 0, removed: 0, over: 0 };
  let cavities = 0;
  app.store.edit((doc) => {
    const target = findTable(doc, tableId);
    if (!target) return;
    if (name === null) {
      delete target.housing;
      return;
    }
    target.housing = name;
    cavities = housingCavities(doc, name) ?? 0;
    if (cavities) fitted = fitCavityRows(target, cavities);
  }, "housing");
  const who = nameOf(app, table);
  if (fitted.added) app.toast.show(app.t("toast.cavitiesAdded", { n: fitted.added }));
  else if (fitted.removed) app.toast.show(app.t("toast.cavitiesRemoved", { n: fitted.removed }));
  if (fitted.over) {
    app.toast.error(app.t("toast.cavitiesOver", { name: who, rows: cavities + fitted.over, n: cavities }));
  }
  app.refreshProps();
}

/** Picks the termination of one cavity, or takes it away. */
export async function assignTermination(app: AppContext, tableId: string, row: number): Promise<void> {
  const table = findTable(app.doc, tableId);
  const col = table ? tableColumns(table).termination : undefined;
  if (!table || table.kind !== "table" || col === undefined || row < 0 || row >= table.rows.length) return;

  const cavity = cell(table.rows[row], tableColumns(table).cavity) || String(row + 1);
  const choice = await pickEntry(
    app,
    "terminations",
    app.t("catalog.pick.termination", { name: nameOf(app, table), cavity }),
    cell(table.rows[row], col),
  );
  if (!choice) return;
  let name = "";
  if (choice.type === "pick") name = choice.key;
  if (choice.type === "new") {
    const made = await createEntry(app, "terminations");
    if (made === null) return;
    name = made;
  }
  app.store.edit((doc) => {
    const target = findTable(doc, tableId);
    const cells = target?.rows[row];
    if (!cells) return;
    while (cells.length <= col) cells.push("");
    cells[col] = name;
  }, "termination");
}

/** Gives a cavity table the column its terminations are picked in, after the wire's colour and size. */
export function addTerminationColumn(app: AppContext, tableId: string): void {
  app.store.edit((doc) => {
    const table = findTable(doc, tableId);
    if (!table || table.kind !== "table" || tableColumns(table).termination !== undefined) return;
    const cols = tableColumns(table);
    const after = cols.section ?? cols.color ?? cols.cavity;
    const at = after === undefined ? (table.head?.length ?? 0) : after + 1;
    const head = table.head ?? (table.head = []);
    const width = Math.max(head.length, ...table.rows.map((r) => r.length), 1);
    while (head.length < width) head.push("");
    head.splice(at, 0, app.t("table.head.termination"));
    for (const row of table.rows) {
      while (row.length < width) row.push("");
      row.splice(at, 0, "");
    }
  }, "termination-column");
}

/* ============================ deleting ============================ */

/**
 * Deleting an entry lets go of everything that used it, so when anything does
 * the person is told how much, and which connectors, before it happens.
 */
export async function deleteEntryFlow(app: AppContext, tableId: string, row: number): Promise<void> {
  const table = findTable(app.doc, tableId);
  if (!table || !isCatalog(table)) return;
  const name = (table.rows[row]?.[0] ?? "").trim();
  const usage = name ? usageOf(app.doc, table.kind, name) : { count: 0, owners: [] };
  if (usage.count > 0) {
    const ok = await app.dialogs.confirm({
      title: app.t("dialog.deleteEntry.title", { name }),
      body: app.t(
        `dialog.deleteEntry.${table.kind === "housings" ? "housing" : "termination"}.${usage.count === 1 ? "one" : "other"}`,
        { name, n: usage.count, owners: usage.owners.join(", ") },
      ),
      confirmLabel: app.t("props.delete"),
      danger: true,
    });
    if (!ok) return;
  }
  app.store.edit((doc) => {
    const target = findTable(doc, tableId);
    if (target) removeEntry(doc, target, row);
  }, "catalog-delete");
}

/** Deleting a whole catalogue lets go of every use at once, so it asks about all of them. */
export async function deleteCatalogFlow(app: AppContext, tableId: string): Promise<boolean> {
  const table = findTable(app.doc, tableId);
  if (!table || !isCatalog(table)) return false;
  const usage = totalUsage(app.doc, table.kind);
  if (usage.count > 0) {
    const ok = await app.dialogs.confirm({
      title: app.t("dialog.deleteCatalog.title", { title: table.title ?? "" }),
      body: app.t(
        `dialog.deleteCatalog.${table.kind === "housings" ? "housings" : "terminations"}.${usage.count === 1 ? "one" : "other"}`,
        { n: usage.count, owners: usage.owners.join(", ") },
      ),
      confirmLabel: app.t("props.delete"),
      danger: true,
    });
    if (!ok) return false;
  }
  app.store.edit((doc) => {
    const target = findTable(doc, tableId);
    if (!target || !isCatalog(target)) return;
    for (const row of target.rows) unassignEntry(doc, target.kind, row[0] ?? "");
    deleteEntity(doc, "table", tableId);
  }, "delete");
  const selection = app.store.selection;
  if (selection?.type === "table" && selection.id === tableId) app.store.select(null);
  return true;
}

/** Picks one of the cavity tables that belong to no connector, for a connector to take. */
export function pickFreeTable(app: AppContext, tables: readonly Table[]): Promise<Choice | null> {
  return pickFrom(app, {
    title: app.t("catalog.pick.table"),
    items: tables.map((table) => ({
      key: table.id,
      name: (table.title ?? "").trim() || app.t("props.linkedNode.unnamed"),
      detail: app.t("catalog.cavityCount", { n: table.rows.length }),
    })),
    clearable: false,
    newLabel: app.t("catalog.newTable"),
  });
}
