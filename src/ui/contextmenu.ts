/**
 * Right-click menu entries, built for whatever was clicked.
 *
 * The menu is the editor's command centre: it gathers the actions that, in a
 * properties panel, would sit far from where the user is actually working.
 * Every action touching the document goes through `store.edit`, so it stays a
 * single undo step.
 */
import {
  addBend,
  addInline,
  createJunction,
  deleteEntity,
  findInline,
  findNode,
  findSegment,
  findTable,
  isTerminalNode,
  mateConnectors,
  mateOf,
  mergeNodes,
  nextName,
  tableColumns,
  removeBend,
  segmentPath,
  unmateConnector,
  nodeForTable,
  renameNode,
  segmentEnds,
  splitSegment,
  tableForNode,
  isAutoLinkEnabled,
  isCavityTable,
  spliceNode,
} from "@/core/doc";
import { catalogOf, isCatalog, isDerivedColumn, namesATermination } from "@/core/catalog";
import { cavityTable, cavityTableFor } from "@/core/factories";
import { projectT, snapTo } from "@/core/geometry";
import { visibleConnectorSymbols } from "@/render/connectors";
import { heldClipping, pasteHeldAt } from "./clipboard";
import {
  addTerminationColumn,
  assignHousing,
  assignTermination,
  createEntry,
  deleteCatalogFlow,
  deleteEntryFlow,
  pickFreeTable,
} from "./catalog";
import { pickFreeColor } from "./colorpicker";
import { menuContributors, openMenu } from "./menu";
import type { MenuItem } from "./menu";
import { parseCsv } from "@/core/wirelist";
import { TITLE_ROW } from "@/render/tables";
import { editOnSheet } from "./sheet-edit";
import type { AppContext } from "@/app/context";
import type { EntityType, HarnessDoc, Point, Selection } from "@/core/types";

/** The cell the right click landed on, when the target is a table. */
export interface MenuCell {
  row: number;
  col: number;
}

export function contextMenuItems(
  app: AppContext,
  target: Selection | null,
  world: Point,
  cell?: MenuCell,
): MenuItem[] {
  const items = target ? itemsForTarget(app, target, world, cell) : backgroundItems(app, world);
  // Copying and pasting are about the pointer, not about what was clicked, so
  // they belong to every menu and always at the end of it, in one place the eye
  // learns rather than in four different ones.
  const both = clipboardItems(app, target, world);
  if (both.length) items.push({ separator: true }, ...both);
  const contributed = contributedItems(app, target, world);
  if (contributed.length) items.push({ separator: true }, ...contributed);
  return items;
}

/** Copy what was clicked, and put down what is held, exactly where the click was. */
function clipboardItems(app: AppContext, target: Selection | null, world: Point): MenuItem[] {
  const t = app.t;
  const items: MenuItem[] = [];
  // the right click has already put what it hit into the selection, keeping any
  // group that was gathered around it, so the command copies exactly that
  const table = target?.type === "table" ? findTable(app.doc, target.id) : undefined;
  if (target && !(table && (table.kind === "title" || isCatalog(table)))) {
    const group = app.store.selected().length;
    items.push({
      label: group > 1 ? t("menu.copyMany", { n: group }) : t("menu.copy"),
      shortcut: "Ctrl+C",
      run: () => app.commands.run("edit.copy"),
    });
  }
  if (heldClipping()) {
    items.push({ label: t("menu.pasteHere"), shortcut: "Ctrl+V", run: () => pasteHeldAt(app, world) });
  }
  return items;
}

/** If the element is gone, the document having changed under the menu, fall back to the sheet. */
function itemsForTarget(app: AppContext, target: Selection, world: Point, cell?: MenuCell): MenuItem[] {
  switch (target.type) {
    case "node":
      return findNode(app.doc, target.id) ? nodeItems(app, target.id) : backgroundItems(app, world);
    case "segment":
      return findSegment(app.doc, target.id)
        ? segmentItems(app, target.id, world)
        : backgroundItems(app, world);
    case "inline":
      return findInline(app.doc, target.id) ? inlineItems(app, target.id) : backgroundItems(app, world);
    case "table":
      return findTable(app.doc, target.id)
        ? tableItems(app, target.id, cell?.row, cell?.col)
        : backgroundItems(app, world);
    default:
      return backgroundItems(app, world);
  }
}

/* ============================ node ============================ */

function nodeItems(app: AppContext, id: string): MenuItem[] {
  const t = app.t;
  const items: MenuItem[] = [];

  // The action the group was gathered for comes first, and only while there is
  // a group: an entry that is greyed out nine times out of ten teaches nothing
  // about how to reach the tenth.
  const group = selectedNodes(app, id);
  if (group.length > 1) {
    items.push({
      label: t("menu.mergeNodes", { n: group.length }),
      run: () => mergeSelectedNodes(app, group, id),
    });
  }
  if (group.length === 2) {
    const [a, b] = group as [string, string];
    items.push({ label: t("menu.mateConnectors"), run: () => mateFlow(app, a, b) });
  }
  const joined = mateOf(app.doc, id);
  if (joined) {
    items.push({
      label: t("menu.unmateConnector", { name: joined.name || t("validate.nodeUnnamed") }),
      run: () => editDoc(app, (doc) => void unmateConnector(doc, id), "unmate"),
    });
  }
  if (items.length) items.push({ separator: true });

  items.push({ label: t("menu.branchFrom"), shortcut: "B", run: () => startBranchFrom(app, id) });
  items.push({ separator: true });

  if (isTerminalNode(app.doc, id)) {
    const self = findNode(app.doc, id);
    const what = self?.kind !== "connector" ? "junction" : self.style === "splice" ? "splice" : "connector";
    // the one it is now says so, as the list of colours does
    const mark = (here: boolean): string => (here ? "● " : "○ ");

    items.push({ header: t("menu.terminalHeader") });
    items.push({
      label: mark(what === "junction") + t("menu.junction"),
      run: () => void makeJunction(app, id),
    });
    items.push({ label: mark(what === "splice") + t("menu.splice"), run: () => void makeSplice(app, id) });
    items.push({
      label: mark(what === "connector") + t("menu.connector"),
      run: () => void makeConnector(app, id),
    });
    items.push({ separator: true });

    // Where nothing says what the end is made of, how it is drawn is still a
    // choice to make: a drawing with no housing or termination table (every
    // file made before them) and a connector whose table names neither.
    const linkedTable = what === "connector" ? tableForNode(app.doc, id) : undefined;
    const named = !!linkedTable?.housing || (linkedTable ? namesATermination(linkedTable) : false);
    const catalogs = !!(catalogOf(app.doc, "housings") || catalogOf(app.doc, "terminations"));
    if (what !== "splice" && (!catalogs || (what === "connector" && !named))) {
      items.push({ header: t("menu.drawnAs") });
      for (const symbol of visibleConnectorSymbols()) {
        if (symbol.id === "splice") continue;
        const here = self?.kind === "connector" && self.style === symbol.id;
        items.push({
          label: mark(here) + t(symbol.labelKey),
          run: () => setConnectorStyle(app, id, symbol.id),
        });
      }
      items.push({ separator: true });
    }

    // a plain junction has no name; the others are known by theirs
    if (what !== "junction") items.push({ label: t("menu.rename"), run: () => void renameFlow(app, id) });
    items.push({
      label: t("menu.noteRefs"),
      run: () =>
        void textFlow(
          app,
          "dialog.refs",
          () => findNode(app.doc, id)?.refs ?? "",
          (doc, value) => {
            const node = findNode(doc, id);
            if (node) node.refs = value.trim();
          },
        ),
    });

    // only a connector has a cavity table; a splice and a junction take none
    if (what === "connector") {
      const linked = tableForNode(app.doc, id);
      if (linked) {
        items.push({ label: t("menu.housing"), run: () => void assignHousing(app, linked.id) });
        items.push({
          label: t("menu.selectLinkedTable"),
          run: () => app.store.select({ type: "table", id: linked.id }),
        });
      } else {
        items.push({ label: t("menu.createCavityTable"), run: () => createCavityTable(app, id) });
      }
    }
    items.push({ separator: true });
  }

  items.push({ label: t("menu.coordinates"), run: () => void coordinatesFlow(app, id) });
  items.push({ label: t("menu.deleteNode"), danger: true, run: () => removeEntity(app, "node", id) });
  return items;
}

/**
 * The nodes the menu should act on: those selected, provided the one clicked is
 * among them. Right-clicking outside the group has already replaced it, so this
 * only ever falls back when a menu outlives the selection it was built from.
 */
function selectedNodes(app: AppContext, id: string): string[] {
  const ids = app.store
    .selected()
    .filter((s) => s.type === "node" && findNode(app.doc, s.id))
    .map((s) => s.id);
  return ids.includes(id) ? ids : [id];
}

/**
 * Mates two connectors. It refuses on a node the bundle runs through, because a
 * joint is between two ends, and says so rather than doing nothing.
 */
function mateFlow(app: AppContext, a: string, b: string): void {
  if (!editDoc(app, (doc) => void mateConnectors(doc, a, b), "mate")) {
    app.toast.error(app.t("toast.mateRefused"));
    return;
  }
  const name = (id: string): string => findNode(app.doc, id)?.name || app.t("validate.nodeUnnamed");
  app.toast.show(app.t("toast.mated", { a: name(a), b: name(b) }));
}

function mergeSelectedNodes(app: AppContext, ids: readonly string[], intoId: string): void {
  let merged = 0;
  editDoc(app, (doc) => (merged = mergeNodes(doc, ids, intoId)), "merge-nodes");
  if (!merged) return;
  // the group is gone, and what is left is the one node it became
  app.store.select({ type: "node", id: intoId });
  app.toast.show(app.t("toast.nodesMerged", { n: merged + 1 }));
}

/** Exact coordinates: dragging is almost always enough, but not for dimensioning. */
async function coordinatesFlow(app: AppContext, id: string): Promise<void> {
  const node = findNode(app.doc, id);
  if (!node) return;
  const value = await app.dialogs.prompt({
    title: app.t("dialog.coordinates.title"),
    label: app.t("dialog.coordinates.label"),
    value: `${node.x}, ${node.y}`,
  });
  if (value === null) return;
  const parts = value
    .split(/[,;\s]+/)
    .filter(Boolean)
    .map(Number);
  const [x, y] = parts;
  if (parts.length < 2 || !Number.isFinite(x) || !Number.isFinite(y)) return;
  editDoc(app, (doc) => {
    const target = findNode(doc, id);
    if (target) {
      target.x = x as number;
      target.y = y as number;
    }
  });
}

/**
 * Draws an end as one of the symbols, for an end that no housing or termination
 * says anything about. It is auto-named only when it has no name yet: a
 * draughtsman who named the node must not see that name overwritten.
 */
function setConnectorStyle(app: AppContext, id: string, style: string): void {
  editDoc(
    app,
    (doc) => {
      const node = findNode(doc, id);
      if (!node) return;
      node.kind = "connector";
      node.style = style;
      if (!node.name && style !== "none") node.name = nextName(doc, "C");
    },
    "connector-style",
  );
}

/** A plain junction: a point the bundle ends at, with no name and no table. */
function makeJunction(app: AppContext, id: string): void {
  editDoc(
    app,
    (doc) => {
      const node = findNode(doc, id);
      if (node) node.kind = "junction";
    },
    "junction",
  );
}

/**
 * A splice has a name and joins the wires that reach it, and takes no cavity
 * table. A connector that had one stops owning it: the table stays on the
 * sheet, as a table of its own, and the splice is named afresh, because the old
 * name is what the table and the wires to it go by.
 */
async function makeSplice(app: AppContext, id: string): Promise<void> {
  const node = findNode(app.doc, id);
  if (!node) return;
  const table = node.kind === "connector" && node.style !== "splice" ? tableForNode(app.doc, id) : undefined;
  if (table) {
    const ok = await app.dialogs.confirm({
      title: app.t("dialog.makeSplice.title", { name: node.name }),
      body: app.t("dialog.makeSplice.body", { name: node.name }),
      confirmLabel: app.t("dialog.confirm"),
    });
    if (!ok) return;
  }
  editDoc(app, (doc) => void spliceNode(doc, id), "splice");
}

/**
 * A connector is what its cavity table says it is: the table gives it its name
 * and, through the housing and terminations it names, the way it is drawn. So
 * making one means picking the table it is to have, from those that belong to
 * nothing yet, or starting a new one. A new one asks for its housing straight
 * away, because that is the next thing it needs.
 */
async function makeConnector(app: AppContext, id: string): Promise<void> {
  const node = findNode(app.doc, id);
  if (!node) return;
  if (node.kind === "connector" && node.style !== "splice" && tableForNode(app.doc, id)) return;

  const free = app.doc.tables.filter((tb) => isCavityTable(tb) && !nodeForTable(app.doc, tb));
  const choice = free.length ? await pickFreeTable(app, free) : ({ type: "new" } as const);
  if (!choice) return;

  if (choice.type === "pick") {
    const taken = (name: string): boolean => app.doc.nodes.some((n) => n.id !== id && n.name === name);
    let refused = "";
    editDoc(
      app,
      (doc) => {
        const target = findNode(doc, id);
        const table = findTable(doc, choice.key);
        if (!target || !table) return;
        target.kind = "connector";
        if (target.style === "splice" || target.style === "none") target.style = "plug";
        table.node = target.id;
        const name = /^([A-Za-z0-9_+-]+)/.exec(table.title ?? "")?.[1] ?? "";
        if (name && name !== target.name) {
          if (taken(name)) refused = name;
          else renameNode(doc, target, name);
        }
      },
      "connector",
    );
    if (refused) app.toast.error(app.t("toast.connectorNameTaken", { name: refused }));
    return;
  }

  let created = "";
  const changed = editDoc(
    app,
    (doc) => {
      const target = findNode(doc, id);
      if (!target) return;
      target.kind = "connector";
      if (target.style === "splice" || target.style === "none") target.style = "plug";
      if (!target.name) target.name = nextName(doc, "C");
      const table = cavityTableFor(app.t, target);
      table.x = snapTo(table.x, app.store.snapEnabled);
      table.y = snapTo(table.y, app.store.snapEnabled);
      doc.tables.push(table);
      created = table.id;
    },
    "connector",
  );
  if (!changed || !created) return;
  app.store.select({ type: "table", id: created });
  await assignHousing(app, created);
}

async function renameFlow(app: AppContext, id: string): Promise<void> {
  const node = findNode(app.doc, id);
  if (!node) return;
  const value = await app.dialogs.prompt({
    title: app.t("dialog.rename.title"),
    label: app.t("dialog.rename.label"),
    value: node.name,
  });
  if (value === null) return;

  let updated = 0;
  const changed = editDoc(
    app,
    (doc) => {
      const target = findNode(doc, id);
      if (target) updated = renameNode(doc, target, value.trim());
    },
    "rename",
  );
  if (changed && updated > 0) app.toast.show(app.t("toast.renamedRefs", { n: updated }));
}

function createCavityTable(app: AppContext, id: string): void {
  let created = "";
  const changed = editDoc(
    app,
    (doc) => {
      const node = findNode(doc, id);
      if (!node) return;
      const table = cavityTableFor(app.t, node);
      table.x = snapTo(table.x, app.store.snapEnabled);
      table.y = snapTo(table.y, app.store.snapEnabled);
      doc.tables.push(table);
      created = table.id;
    },
    "add-table",
  );
  if (changed && created) app.store.select({ type: "table", id: created });
}

/* ============================ branch ============================ */

function segmentItems(app: AppContext, id: string, world: Point): MenuItem[] {
  const t = app.t;
  return [
    {
      label: t("menu.length"),
      run: () =>
        void textFlow(
          app,
          "dialog.length",
          () => findSegment(app.doc, id)?.len ?? "",
          (doc, value) => {
            const segment = findSegment(doc, id);
            if (segment) segment.len = value.trim();
          },
        ),
    },
    {
      label: t("menu.covering"),
      run: () =>
        void textFlow(
          app,
          "dialog.covering",
          () => findSegment(app.doc, id)?.refs ?? "",
          (doc, value) => {
            const segment = findSegment(doc, id);
            if (segment) segment.refs = value.trim();
          },
        ),
    },
    { separator: true },
    ...bendItems(app, id, world),
    { label: t("menu.addInline"), run: () => addInlineAt(app, id, world) },
    { label: t("menu.splitSegment"), run: () => splitAt(app, id, world) },
    { separator: true },
    { label: t("menu.deleteSegment"), danger: true, run: () => removeEntity(app, "segment", id) },
  ];
}

/** How near the click has to land on a bend to be about that bend. */
const BEND_REACH = 12;

/**
 * Adding or taking away a bend.
 *
 * Which of the two is offered depends on whether the click landed on a bend
 * that is already there, because both at once on the same branch would mean
 * reading two nearly identical lines to find the one wanted.
 */
function bendItems(app: AppContext, id: string, world: Point): MenuItem[] {
  const seg = findSegment(app.doc, id);
  if (!seg) return [];

  // a branch cornering by itself is offered the other corner rather than a bend
  // of its own: two ways to do the same thing, one of which then stops the
  // corner following the node about, is a trap and not a choice
  if (app.doc.square && !seg.points?.length) {
    const path = segmentPath(app.doc, seg);
    if (path && path.length > 2) {
      return [
        {
          label: app.t("menu.flipBend"),
          run: () =>
            editDoc(
              app,
              (doc) => {
                const target = findSegment(doc, id);
                if (!target) return;
                if (target.flip) delete target.flip;
                else target.flip = true;
              },
              "flip-bend",
            ),
        },
      ];
    }
  }

  const near = (seg.points ?? []).findIndex((p) => Math.hypot(p.x - world.x, p.y - world.y) <= BEND_REACH);
  if (near >= 0) {
    return [
      {
        label: app.t("menu.removeBend"),
        run: () =>
          editDoc(
            app,
            (doc) => {
              const target = findSegment(doc, id);
              if (target) removeBend(target, near);
            },
            "remove-bend",
          ),
      },
    ];
  }
  return [
    {
      label: app.t("menu.addBend"),
      run: () =>
        editDoc(
          app,
          (doc) => {
            const target = findSegment(doc, id);
            const snap = app.store.snapEnabled;
            if (target) addBend(doc, target, { x: snapTo(world.x, snap), y: snapTo(world.y, snap) });
          },
          "add-bend",
        ),
    },
  ];
}

/** Position along the branch of the clicked point; the middle if the branch is no longer valid. */
function positionOn(app: AppContext, segmentId: string, world: Point): number {
  const segment = findSegment(app.doc, segmentId);
  if (!segment) return 0.5;
  const ends = segmentEnds(app.doc, segment);
  return ends ? projectT(ends[0], ends[1], world) : 0.5;
}

function addInlineAt(app: AppContext, segmentId: string, world: Point): void {
  const pos = positionOn(app, segmentId, world);
  let created = "";
  const changed = editDoc(
    app,
    (doc) => {
      if (!findSegment(doc, segmentId)) return;
      created = addInline(doc, segmentId, pos, app.t("table.inline.default")).id;
    },
    "add-inline",
  );
  if (changed && created) app.store.select({ type: "inline", id: created });
}

function splitAt(app: AppContext, segmentId: string, world: Point): void {
  const pos = positionOn(app, segmentId, world);
  let created = "";
  const changed = editDoc(
    app,
    (doc) => {
      const segment = findSegment(doc, segmentId);
      if (!segment) return;
      created = splitSegment(doc, segment, pos)?.id ?? "";
    },
    "split",
  );
  if (changed && created) app.store.select({ type: "node", id: created });
}

/* ============================ inline label ============================ */

/** Ready-made colours: the same ones the labels of reference drawings use. */
const INLINE_COLORS: ReadonlyArray<{ key: string; hex: string }> = [
  { key: "color.orange", hex: "#e8942a" },
  { key: "color.green", hex: "#5aa060" },
  { key: "color.beige", hex: "#c9b273" },
  { key: "color.dark", hex: "#444444" },
  { key: "color.red", hex: "#c62828" },
  { key: "color.blue", hex: "#1d4fd7" },
];

function inlineItems(app: AppContext, id: string): MenuItem[] {
  const t = app.t;
  const items: MenuItem[] = [
    {
      label: t("menu.editText"),
      run: () =>
        void textFlow(
          app,
          "dialog.text",
          () => findInline(app.doc, id)?.text ?? "",
          (doc, value) => {
            const inline = findInline(doc, id);
            if (inline) inline.text = value;
          },
        ),
    },
    { separator: true },
    { header: t("menu.colorHeader") },
  ];

  const paint = (hex: string): void =>
    void editDoc(
      app,
      (doc) => {
        const inline = findInline(doc, id);
        if (inline) inline.color = hex;
      },
      "inline-color",
    );

  const now = (findInline(app.doc, id)?.color ?? "").toLowerCase();
  for (const color of INLINE_COLORS) {
    // the one it already is says so, because a list of colours with no mark on
    // it makes you change one to find out which you had
    const chosen = now === color.hex;
    items.push({ label: `${chosen ? "● " : "○ "}${t(color.key)}`, run: () => paint(color.hex) });
  }
  items.push({
    label: t("menu.freeColor"),
    run: () => pickFreeColor(now, paint),
  });

  items.push({ separator: true });
  items.push({ label: t("menu.deleteInline"), danger: true, run: () => removeEntity(app, "inline", id) });
  return items;
}

/* ============================ table ============================ */

/**
 * The housing and termination tables are lists of things, not grids: a row is
 * an entry, added through the form and deleted with a question when anything
 * uses it; there are no columns to add and no connector to tie them to.
 */
function catalogItems(app: AppContext, id: string, row?: number, col?: number): MenuItem[] {
  const t = app.t;
  const table = findTable(app.doc, id);
  if (!table || !isCatalog(table)) return [];
  const items: MenuItem[] = [];
  const kind = table.kind;

  if (row !== undefined && col !== undefined) {
    if (row < 0 || !isDerivedColumn(kind, col)) {
      items.push({
        label: t("menu.editCell"),
        run: () => editOnSheet(app, { selection: { type: "table", id }, row, col }),
      });
    }
    if (row >= 0) {
      items.push({ header: t("props.table.rowMenu", { n: row + 1 }) });
      items.push({
        label: t("props.table.moveUp"),
        disabled: row === 0,
        run: () => moveRow(app, id, row, -1),
      });
      items.push({
        label: t("props.table.moveDown"),
        disabled: row >= table.rows.length - 1,
        run: () => moveRow(app, id, row, 1),
      });
      items.push({
        label: t("props.table.deleteRow"),
        danger: true,
        run: () => void deleteEntryFlow(app, id, row),
      });
    }
    items.push({ separator: true });
  }
  items.push({
    label: t(kind === "housings" ? "catalog.new.housing" : "catalog.new.termination"),
    run: () => void createEntry(app, kind),
  });
  items.push({
    label: t("menu.renameTitle"),
    run: () => editOnSheet(app, { selection: { type: "table", id }, row: TITLE_ROW, col: 0 }),
  });
  items.push({ separator: true });
  items.push({ label: t("menu.deleteTable"), danger: true, run: () => void deleteCatalogFlow(app, id) });
  return items;
}

function tableItems(app: AppContext, id: string, row?: number, col?: number): MenuItem[] {
  const t = app.t;
  const table = findTable(app.doc, id);
  const items: MenuItem[] = [];
  if (table && isCatalog(table)) return catalogItems(app, id, row, col);

  if (table && table.kind !== "title") {
    // actions on the cell that was hit: these used to live in the side grid
    if (row !== undefined && col !== undefined) {
      items.push({
        label: t("menu.editCell"),
        run: () => editOnSheet(app, { selection: { type: "table", id }, row, col }),
      });
      if (row >= 0) {
        items.push({ header: t("props.table.rowMenu", { n: row + 1 }) });
        items.push({ label: t("props.table.insertAbove"), run: () => insertRow(app, id, row) });
        items.push({ label: t("props.table.insertBelow"), run: () => insertRow(app, id, row + 1) });
        items.push({
          label: t("props.table.moveUp"),
          disabled: row === 0,
          run: () => moveRow(app, id, row, -1),
        });
        items.push({
          label: t("props.table.moveDown"),
          disabled: row >= (table.rows.length ?? 1) - 1,
          run: () => moveRow(app, id, row, 1),
        });
        items.push({ label: t("props.table.deleteRow"), danger: true, run: () => deleteRow(app, id, row) });
      }
      items.push({ header: t("menu.columnHeader", { n: col + 1 }) });
      items.push({ label: t("menu.insertColumn"), run: () => insertColumn(app, id, col + 1) });
      items.push({
        label: t("props.table.deleteColumn", { n: col + 1 }),
        danger: true,
        run: () => deleteColumn(app, id, col),
      });
      items.push({ separator: true });
    }

    // what a connector is made of is picked from the catalogues, not typed
    if (isCavityTable(table)) {
      items.push({
        label: table.housing ? t("menu.housingIs", { name: table.housing }) : t("menu.housing"),
        run: () => void assignHousing(app, id),
      });
      const termination = tableColumns(table).termination;
      if (termination === undefined) {
        items.push({ label: t("menu.addTerminationColumn"), run: () => addTerminationColumn(app, id) });
      } else if (row !== undefined && row >= 0 && col === termination) {
        items.push({ label: t("menu.termination"), run: () => void assignTermination(app, id, row) });
      }
      items.push({ separator: true });
    }

    items.push({ label: t("menu.addRow"), run: () => addRow(app, id) });
    items.push({
      label: t("menu.renameTitle"),
      run: () => editOnSheet(app, { selection: { type: "table", id }, row: TITLE_ROW, col: 0 }),
    });
    items.push({ label: t("props.table.importCsv"), run: () => void importCsvFlow(app, id) });
    const linked = nodeForTable(app.doc, table);
    if (linked) {
      items.push({
        label: t("menu.selectLinkedNode"),
        run: () => app.store.select({ type: "node", id: linked.id }),
      });
    }
    items.push({ label: t("menu.linkToConnector"), run: () => linkTableMenu(app, id) });
    const tracking = isAutoLinkEnabled(table);
    items.push({
      label: t(tracking ? "menu.autoLinkOff" : "menu.autoLinkOn"),
      run: () => {
        app.store.edit((doc) => {
          const target = findTable(doc, id);
          if (!target) return;
          if (tracking) target.autoLink = false;
          else delete target.autoLink;
        }, "table.autolink");
      },
    });
    items.push({ separator: true });
  }

  items.push({ label: t("menu.deleteTable"), danger: true, run: () => void deleteTableFlow(app, id) });
  return items;
}

/* ---------------- row and column operations ---------------- */

function insertRow(app: AppContext, id: string, at: number): void {
  editDoc(app, (doc) => {
    const table = findTable(doc, id);
    if (!table) return;
    const width = Math.max(1, table.head?.length ?? table.rows[0]?.length ?? 1);
    table.rows.splice(Math.max(0, Math.min(at, table.rows.length)), 0, new Array<string>(width).fill(""));
  });
}

function moveRow(app: AppContext, id: string, from: number, delta: number): void {
  editDoc(app, (doc) => {
    const table = findTable(doc, id);
    const to = from + delta;
    if (!table || to < 0 || to >= table.rows.length) return;
    const [row] = table.rows.splice(from, 1);
    if (row) table.rows.splice(to, 0, row);
  });
}

function deleteRow(app: AppContext, id: string, at: number): void {
  editDoc(app, (doc) => {
    const table = findTable(doc, id);
    if (table && table.rows.length > 1) table.rows.splice(at, 1);
  });
}

function insertColumn(app: AppContext, id: string, at: number): void {
  editDoc(app, (doc) => {
    const table = findTable(doc, id);
    if (!table) return;
    const head = table.head ?? (table.head = []);
    const width = Math.max(head.length, ...table.rows.map((r) => r.length), 1);
    while (head.length < width) head.push("");
    head.splice(at, 0, app.t("table.head.column"));
    for (const row of table.rows) {
      while (row.length < width) row.push("");
      row.splice(at, 0, "");
    }
  });
}

function deleteColumn(app: AppContext, id: string, at: number): void {
  editDoc(app, (doc) => {
    const table = findTable(doc, id);
    if (!table) return;
    const width = Math.max(table.head?.length ?? 0, ...table.rows.map((r) => r.length), 1);
    if (width <= 1) return;
    table.head?.splice(at, 1);
    for (const row of table.rows) row.splice(at, 1);
  });
}

/** CSV import: replaces the table's headers and rows. */
async function importCsvFlow(app: AppContext, id: string): Promise<void> {
  const text = await app.pickCsv();
  if (text === null) return;
  const rows = parseCsv(text);
  if (!rows.length) {
    app.toast.error(app.t("toast.csvEmpty"));
    return;
  }
  const [head, ...body] = rows;
  app.store.edit((doc) => {
    const table = findTable(doc, id);
    if (!table || !head) return;
    table.head = head;
    table.rows = body.length ? body : [new Array<string>(head.length).fill("")];
    const width = head.length;
    for (const row of table.rows) while (row.length < width) row.push("");
  }, "table.csv");
  app.toast.show(app.t("toast.csvImported", { n: Math.max(0, rows.length - 1) }));
}

/** Choosing the connector to tie the cavity table to. */
function linkTableMenu(app: AppContext, id: string): void {
  const t = app.t;
  // a splice takes no cavity table
  const connectors = app.doc.nodes.filter((n) => n.kind === "connector" && n.style !== "splice");
  const items: MenuItem[] = [
    { header: t("props.field.linkedNode") },
    {
      label: t("props.linkedNode.none"),
      run: () =>
        editDoc(app, (doc) => {
          const table = findTable(doc, id);
          if (table) delete table.node;
        }),
    },
  ];
  for (const node of connectors) {
    items.push({
      label: node.name || t("props.linkedNode.unnamed"),
      run: () => {
        editDoc(app, (doc) => {
          const table = findTable(doc, id);
          if (table) table.node = node.id;
        });
        app.toast.show(t("toast.tableLinked", { name: node.name || t("props.linkedNode.unnamed") }));
      },
    });
  }
  const box = { x: window.innerWidth / 2 - 110, y: window.innerHeight / 3 };
  openMenu(box.x, box.y, items);
}

function addRow(app: AppContext, id: string): void {
  editDoc(
    app,
    (doc) => {
      const table = findTable(doc, id);
      if (!table) return;
      const width = Math.max(1, (table.head ?? table.rows[0] ?? [""]).length);
      table.rows.push(new Array<string>(width).fill(""));
    },
    "add-row",
  );
}

/** A table with data in it never disappears without an explicit confirmation. */
async function deleteTableFlow(app: AppContext, id: string): Promise<void> {
  const table = findTable(app.doc, id);
  if (!table) return;
  if (isCatalog(table)) {
    await deleteCatalogFlow(app, id);
    return;
  }
  const filled = table.rows.some((row) => row.some((c) => c.trim() !== ""));
  if (filled) {
    const ok = await app.dialogs.confirm({
      title: app.t("menu.deleteTable"),
      body: app.t("dialog.deleteTable.body", { title: table.title ?? app.t("props.table.title") }),
      confirmLabel: app.t("props.delete"),
      danger: true,
    });
    if (!ok) return;
  }
  removeEntity(app, "table", id);
}

/* ============================ sfondo ============================ */

function backgroundItems(app: AppContext, world: Point): MenuItem[] {
  const t = app.t;
  return [
    { label: t("menu.branchHere"), shortcut: "B", run: () => startBranchHere(app, world) },
    { separator: true },
    { label: t("menu.fitView"), shortcut: "F", run: () => app.renderer.fitView() },
    { label: t("cmd.guide"), shortcut: "F1", run: () => app.showGuide() },
    { label: t("menu.addCavityTable"), run: () => addCavityTableAt(app, world) },
  ];
}

/**
 * Branch drawing starts from the selected node: selection and tool are the only
 * channel into the interaction module, which exposes nothing else.
 */
function startBranchFrom(app: AppContext, nodeId: string): void {
  app.store.select({ type: "node", id: nodeId });
  app.store.setTool("branch");
}

function startBranchHere(app: AppContext, world: Point): void {
  const snap = app.store.snapEnabled;
  let created = "";
  const changed = editDoc(
    app,
    (doc) => {
      created = createJunction(doc, snapTo(world.x, snap), snapTo(world.y, snap)).id;
    },
    "add-node",
  );
  if (changed && created) startBranchFrom(app, created);
}

function addCavityTableAt(app: AppContext, world: Point): void {
  const snap = app.store.snapEnabled;
  let created = "";
  const changed = editDoc(
    app,
    (doc) => {
      const table = cavityTable(app.t, snapTo(world.x, snap), snapTo(world.y, snap));
      doc.tables.push(table);
      created = table.id;
    },
    "add-table",
  );
  if (changed && created) app.store.select({ type: "table", id: created });
}

/* ============================ utilità comuni ============================ */

/**
 * Edits the document and refreshes the panels: the redraw comes from the store,
 * the panel fields do not.
 */
function editDoc(app: AppContext, mutate: (doc: HarnessDoc) => void, reason = "menu"): boolean {
  const changed = app.store.edit(mutate, reason);
  // the open panels, check and plugins, may depend on the document
  if (changed) app.refreshProps();
  return changed;
}

/**
 * Text dialog on a property: `prefix` is the root of the i18n keys
 * (`<prefix>.title` e `<prefix>.label`).
 */
async function textFlow(
  app: AppContext,
  prefix: string,
  read: () => string,
  write: (doc: HarnessDoc, value: string) => void,
): Promise<void> {
  const value = await app.dialogs.prompt({
    title: app.t(`${prefix}.title`),
    label: app.t(`${prefix}.label`),
    value: read(),
  });
  if (value === null) return;
  editDoc(app, (doc) => write(doc, value), "edit-field");
}

function removeEntity(app: AppContext, type: EntityType, id: string): void {
  const changed = editDoc(app, (doc) => deleteEntity(doc, type, id), "delete");
  const selection = app.store.selection;
  if (changed && selection && selection.type === type && selection.id === id) app.store.select(null);
}

/**
 * Entries added from outside. Contributions come through the single registry in
 * `menu.ts`, which is also where plugins register by way of the host. A plugin
 * error must never stop the menu from opening.
 */
function contributedItems(app: AppContext, target: Selection | null, world: Point): MenuItem[] {
  const out: MenuItem[] = [];
  for (const contributor of menuContributors()) {
    try {
      const items = contributor({ target, world, app });
      if (Array.isArray(items)) out.push(...items);
    } catch (err) {
      console.error("[harness] a menu contribution failed", err);
    }
  }
  return out;
}
