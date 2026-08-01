/**
 * Command registry: the list of what the application knows how to do.
 *
 * The top bar, the right-click menu, the shortcuts and the palette all invoke
 * the same command by id, so a feature added here shows up everywhere without
 * being wired in three separate places. Shortcuts are declarative ("Ctrl+S",
 * "Delete", "B") and matched against the event in a single
 * posto: `matchShortcut`.
 */
import type { AppContext, Command, CommandRegistry } from "@/app/context";
import { deleteEntity, emptyDoc, findTable } from "@/core/doc";
import { autoLinkAll } from "@/core/autolink";
import { copySelection, countOf, isEmptyClipping } from "@/core/clipboard";
import { heldClipping, hold, pasteHeldAt } from "@/ui/clipboard";
import { pointerAt } from "@/ui/pointer";
import { snapTo } from "@/core/geometry";
import { uid } from "@/core/ids";
import { cavityTable, notesTable, revisionsTable, titleBlock, wireListHeadings } from "@/core/factories";
import { sampleDoc } from "@/core/sample";
import type { Point, Table } from "@/core/types";
import { validateDoc } from "@/core/validate";
import { wireRowsWithLength } from "@/core/routing";
import { wireListRows } from "@/core/wirelist";
import { getLocale, locales, setLocale } from "@/i18n";
import { exportPngFile, exportSvgFile, exportWireCsv, printDrawing } from "@/io/exporters";
import { saveDocToFile } from "@/io/file";
import { tableSize } from "@/render/tables";
import { openCommandPalette } from "@/ui/palette";
import { cycleViewMode, setViewMode, showsBoard, showsSchematic } from "@/ui/viewmode";

/* ============================ shortcuts ============================ */

interface Combo {
  /** Ctrl on Windows and Linux, Cmd on macOS: one declaration covers both. */
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  /** tasto normalizzato in minuscolo, es. "s", "delete", "+" */
  key: string;
}

/** Alternative names accepted in declarations and produced by keyboards. */
const KEY_ALIASES: Record<string, string> = {
  esc: "escape",
  del: "delete",
  canc: "delete",
  ins: "insert",
  return: "enter",
  spacebar: "space",
  plus: "+",
  add: "+",
  "=": "+",
  minus: "-",
  subtract: "-",
  up: "arrowup",
  down: "arrowdown",
  left: "arrowleft",
  right: "arrowright",
};

function normalizeKey(raw: string): string {
  if (raw === " ") return "space";
  const key = raw.trim().toLowerCase();
  return KEY_ALIASES[key] ?? key;
}

/** Splits "Ctrl+Shift+Z" and copes with the edge case "Ctrl++", the plus key. */
function splitShortcut(shortcut: string): string[] {
  const parts: string[] = [];
  let buffer = "";
  for (const ch of shortcut) {
    if (ch === "+" && buffer !== "") {
      parts.push(buffer);
      buffer = "";
    } else buffer += ch;
  }
  parts.push(buffer);
  return parts.filter((p) => p.trim() !== "");
}

function parseShortcut(shortcut: string): Combo | null {
  const combo: Combo = { ctrl: false, shift: false, alt: false, key: "" };
  for (const part of splitShortcut(shortcut)) {
    const token = normalizeKey(part);
    if (token === "ctrl" || token === "control" || token === "cmd" || token === "meta" || token === "mod") {
      combo.ctrl = true;
    } else if (token === "shift") combo.shift = true;
    else if (token === "alt" || token === "option") combo.alt = true;
    else combo.key = token;
  }
  return combo.key ? combo : null;
}

/**
 * A command fires only with exactly the modifiers it declared, which is the
 * guard that stops Ctrl+F from triggering the "F" shortcut.
 */
function comboMatches(combo: Combo, ev: KeyboardEvent): boolean {
  if (normalizeKey(ev.key) !== combo.key) return false;
  const ctrlOrMeta = ev.ctrlKey || ev.metaKey;
  if (ctrlOrMeta !== combo.ctrl) return false;
  if (ev.altKey !== combo.alt) return false;
  // Symbols move around from one keyboard layout to another, so for them the
  // state of Shift is unreliable and is not compared.
  const shiftMatters = combo.shift || combo.key.length > 1 || /[a-z0-9]/.test(combo.key);
  return !shiftMatters || ev.shiftKey === combo.shift;
}

/* ============================ registro ============================ */

/**
 * The registry is created before the application context that holds it, so the
 * context is attached as soon as it exists, by `registerBuiltinCommands`.
 */
export interface AppBindableRegistry extends CommandRegistry {
  bindApp(app: AppContext): void;
}

class Registry implements AppBindableRegistry {
  private commands = new Map<string, Command>();
  private combos = new Map<string, Combo | null>();
  private app: AppContext | null = null;

  bindApp(app: AppContext): void {
    this.app = app;
  }

  register(command: Command): () => void {
    this.commands.set(command.id, command);
    return () => {
      // only if nobody replaced the command under the same id in the meantime
      if (this.commands.get(command.id) === command) this.commands.delete(command.id);
    };
  }

  get(id: string): Command | undefined {
    return this.commands.get(id);
  }

  all(): Command[] {
    return [...this.commands.values()];
  }

  run(id: string): void {
    const command = this.commands.get(id);
    const app = this.app;
    if (!command || !app) {
      console.warn(`[harness] command not runnable: ${id}`);
      return;
    }
    if (command.enabled && !command.enabled(app)) return;
    try {
      const result: unknown = command.run(app);
      if (result instanceof Promise) {
        result.catch((err: unknown) => console.error(`[harness] command "${id}" failed`, err));
      }
    } catch (err) {
      console.error(`[harness] command "${id}" failed`, err);
    }
  }

  matchShortcut(event: KeyboardEvent): Command | undefined {
    for (const command of this.commands.values()) {
      if (!command.shortcut) continue;
      const combo = this.comboOf(command.shortcut);
      if (combo && comboMatches(combo, event)) return command;
    }
    return undefined;
  }

  private comboOf(shortcut: string): Combo | null {
    const cached = this.combos.get(shortcut);
    if (cached !== undefined) return cached;
    const parsed = parseShortcut(shortcut);
    this.combos.set(shortcut, parsed);
    return parsed;
  }
}

export function createCommandRegistry(): AppBindableRegistry {
  return new Registry();
}

/* ============================ aiuti condivisi ============================ */

/**
 * True while text is selected somewhere on the page.
 *
 * Ctrl+C then belongs to the browser: somebody who has just swept over a line
 * of a check report, or a cell of a table, is copying that text and not the
 * element behind it. Saying the command is unavailable is enough — the keyboard
 * only takes a combination away from the browser for a command it can run.
 */
function copyingText(): boolean {
  const selection = typeof window === "undefined" ? null : window.getSelection();
  return !!selection && !selection.isCollapsed && selection.toString().trim() !== "";
}

/** Centre of the drawing area in document coordinates: new items are born there. */
function viewCenter(app: AppContext): Point {
  const canvas = document.querySelector(".canvas");
  const box = canvas?.getBoundingClientRect();
  const cx = box && box.width > 0 ? box.left + box.width / 2 : window.innerWidth / 2;
  const cy = box && box.height > 0 ? box.top + box.height / 2 : window.innerHeight / 2;
  return app.renderer.screenToWorld({ clientX: cx, clientY: cy });
}

/** Inserts a table centred on the view and selects it. */
function insertTable(app: AppContext, table: Table): void {
  const center = viewCenter(app);
  const size = tableSize(table, app.doc.meta, app.t);
  table.x = snapTo(center.x - size.w / 2, app.store.snapEnabled);
  table.y = snapTo(center.y - size.h / 2, app.store.snapEnabled);
  app.store.edit((doc) => {
    doc.tables.push(table);
  }, "insert");
  app.store.select({ type: "table", id: table.id });
}

/**
 * Rebuilds the wire list from the cavity tables: it refreshes the existing
 * table if there is one, otherwise it creates a new one centred on the view.
 */
function refreshWireList(app: AppContext): void {
  const t = app.t;
  const wires = wireRowsWithLength(app.doc);
  if (wires.length === 0) {
    app.toast.show(t("wirelist.empty"));
    return;
  }
  const head = wireListHeadings(t);
  const rows = wireListRows(wires);
  const title = t("table.title.wirelist");
  const existing = app.doc.tables.find((tb) => tb.kind === "table" && tb.title === title);

  if (existing) {
    const id = existing.id;
    app.store.edit((doc) => {
      const target = findTable(doc, id);
      if (!target) return;
      target.head = head;
      target.rows = rows;
    }, "wirelist");
    app.store.select({ type: "table", id });
  } else {
    insertTable(app, { id: uid("t"), x: 0, y: 0, kind: "table", title, head, rows });
  }
  app.toast.show(t("toast.wirelistUpdated", { n: wires.length }));
}

async function replaceDocument(
  app: AppContext,
  titleKey: string,
  bodyKey: string,
  next: () => void,
): Promise<void> {
  const ok = await app.dialogs.confirm({
    title: app.t(titleKey),
    body: app.t(bodyKey),
    confirmLabel: app.t("dialog.confirm"),
    cancelLabel: app.t("dialog.cancel"),
    danger: true,
  });
  if (ok) next();
}

/* ============================ built-in commands ============================ */

/**
 * The ids are stable: they are what the top bar, the right-click menu and
 * plugins use to invoke a command.
 */
export function registerBuiltinCommands(app: AppContext): void {
  const registry = app.commands as Partial<AppBindableRegistry>;
  if (typeof registry.bindApp === "function") registry.bindApp(app);

  const commands: Command[] = [
    /* ---- document ---- */
    {
      id: "doc.new",
      titleKey: "cmd.new",
      run: (a) => replaceDocument(a, "dialog.new.title", "dialog.new.body", () => a.store.load(emptyDoc())),
    },
    {
      id: "doc.sample",
      titleKey: "cmd.sample",
      run: (a) =>
        replaceDocument(a, "dialog.sample.title", "dialog.sample.body", () => a.store.load(sampleDoc(a.t))),
    },
    {
      id: "doc.open",
      titleKey: "cmd.open",
      shortcut: "Ctrl+O",
      run: (a) => a.openFilePicker(),
    },
    {
      id: "doc.save",
      titleKey: "cmd.save",
      shortcut: "Ctrl+S",
      run: (a) => {
        saveDocToFile(a.doc);
        a.toast.show(a.t("toast.saved"));
      },
    },
    {
      id: "doc.check",
      titleKey: "cmd.check",
      run: (a) => a.showReport(validateDoc(a.doc, a.t)),
    },

    /* ---- editing ---- */
    {
      id: "edit.undo",
      titleKey: "cmd.undo",
      shortcut: "Ctrl+Z",
      enabled: (a) => a.store.canUndo,
      run: (a) => {
        a.store.undo();
      },
    },
    {
      id: "edit.redo",
      titleKey: "cmd.redo",
      shortcut: "Ctrl+Y",
      enabled: (a) => a.store.canRedo,
      run: (a) => {
        a.store.redo();
      },
    },
    {
      // the other widespread redo shortcut, kept out of the palette
      id: "edit.redo.alt",
      titleKey: "cmd.redo",
      shortcut: "Ctrl+Shift+Z",
      palette: false,
      enabled: (a) => a.store.canRedo,
      run: (a) => a.commands.run("edit.redo"),
    },
    {
      id: "edit.copy",
      titleKey: "cmd.copy",
      shortcut: "Ctrl+C",
      enabled: (a) => a.store.selection !== null && !copyingText(),
      run: (a) => {
        const clip = copySelection(a.doc, a.store.selected());
        if (isEmptyClipping(clip)) {
          // the only thing that refuses to be copied is the title block
          a.toast.error(a.t("toast.copyRefused"));
          return;
        }
        hold(clip);
        const n = countOf(clip);
        a.toast.show(n === 1 ? a.t("toast.copiedOne") : a.t("toast.copied", { n }));
      },
    },
    {
      id: "edit.paste",
      titleKey: "cmd.paste",
      shortcut: "Ctrl+V",
      enabled: () => heldClipping() !== null,
      // where the pointer is, which is what "here" means; the middle of the view
      // when it is not on the sheet at all
      run: (a) => pasteHeldAt(a, pointerAt() ?? viewCenter(a)),
    },
    {
      id: "edit.delete",
      titleKey: "cmd.delete",
      shortcut: "Delete",
      enabled: (a) => a.store.selection !== null,
      run: (a) => {
        const sel = a.store.selection;
        if (!sel) return;
        a.store.edit((doc) => deleteEntity(doc, sel.type, sel.id), "delete");
        a.store.select(null);
      },
    },
    {
      id: "edit.delete.alt",
      titleKey: "cmd.delete",
      shortcut: "Backspace",
      palette: false,
      enabled: (a) => a.store.selection !== null,
      run: (a) => a.commands.run("edit.delete"),
    },

    /* ---- tools and view ---- */
    {
      id: "tool.branch",
      titleKey: "cmd.branch",
      shortcut: "B",
      run: (a) => a.store.setTool("branch"),
    },
    // The view commands act on what is on screen. Side by side they act on
    // both: pressing "fit" with two views open and having one of them ignore it
    // would look like a bug in whichever half stayed where it was.
    {
      id: "view.fit",
      titleKey: "cmd.fit",
      shortcut: "F",
      run: (a) => {
        if (showsBoard()) a.renderer.fitView();
        if (showsSchematic()) a.schematic.fitView();
      },
    },
    {
      id: "view.zoomIn",
      titleKey: "cmd.zoomIn",
      shortcut: "+",
      run: (a) => {
        if (showsBoard()) a.renderer.zoomBy(1.2);
        if (showsSchematic()) a.schematic.zoomBy(1.2);
      },
    },
    {
      id: "view.zoomOut",
      titleKey: "cmd.zoomOut",
      shortcut: "-",
      run: (a) => {
        if (showsBoard()) a.renderer.zoomBy(1 / 1.2);
        if (showsSchematic()) a.schematic.zoomBy(1 / 1.2);
      },
    },
    {
      id: "view.board",
      titleKey: "cmd.viewBoard",
      run: () => setViewMode("board"),
    },
    {
      id: "view.schematic",
      titleKey: "cmd.viewSchematic",
      run: () => setViewMode("schematic"),
    },
    {
      id: "view.split",
      titleKey: "cmd.viewSplit",
      run: () => setViewMode("split"),
    },
    {
      id: "view.cycle",
      titleKey: "cmd.viewCycle",
      shortcut: "V",
      run: () => cycleViewMode(),
    },
    {
      id: "schematic.reset",
      titleKey: "cmd.schematicReset",
      // the automatic arrangement is always there underneath: this only drops
      // the positions somebody set by hand, and it is one undo step like any
      // other edit to the drawing
      run: (a) => {
        const moved = a.store.edit((doc) => {
          delete doc.schematic;
        }, "schematic-reset");
        a.toast.show(a.t(moved ? "toast.schematicReset" : "toast.schematicPlaced"));
      },
    },
    {
      id: "app.guide",
      titleKey: "cmd.guide",
      shortcut: "F1",
      run: (a) => a.showGuide(),
    },
    {
      id: "doc.autolink",
      titleKey: "cmd.autoLinkAll",
      run: (a) => {
        let linked = 0;
        let conflicts = 0;
        a.store.edit((doc) => {
          for (const result of autoLinkAll(doc)) {
            if (result.status === "linked") linked++;
            else if (result.status === "conflict") conflicts++;
          }
        }, "autolink");
        a.refreshProps();
        if (conflicts) a.toast.error(a.t("toast.autoLinkConflicts", { n: conflicts }));
        else a.toast.show(a.t("toast.autoLinkAll", { n: linked }));
      },
    },
    {
      id: "view.snap",
      titleKey: "cmd.snap",
      // the bar subscribes to the "settings" event and updates the pill itself;
      // rebuilding it here would steal focus from the button just pressed
      run: (a) => a.store.setSnap(!a.store.snapEnabled),
    },
    {
      id: "doc.square",
      titleKey: "cmd.square",
      // an edit to the drawing and not a setting of the program: it changes the
      // shape of what is on the sheet, so it is saved with it and undoable
      run: (a) => {
        a.store.edit((doc) => {
          doc.square = !doc.square;
        }, "square");
        a.store.emit("settings", {});
      },
    },

    /* ---- inserting ---- */
    {
      id: "insert.cavity",
      titleKey: "cmd.insertCavity",
      run: (a) => insertTable(a, cavityTable(a.t, 0, 0)),
    },
    {
      id: "insert.notes",
      titleKey: "cmd.insertNotes",
      run: (a) => insertTable(a, notesTable(a.t, 0, 0)),
    },
    {
      id: "insert.revisions",
      titleKey: "cmd.insertRevisions",
      run: (a) => insertTable(a, revisionsTable(a.t, 0, 0)),
    },
    {
      id: "insert.wirelist",
      titleKey: "cmd.insertWirelist",
      run: (a) => refreshWireList(a),
    },
    {
      id: "insert.titleblock",
      titleKey: "cmd.insertTitleBlock",
      run: async (a) => {
        // there is one title block per sheet
        if (a.doc.tables.some((tb) => tb.kind === "title")) {
          await a.dialogs.alert({
            title: a.t("props.titleblock.title"),
            body: a.t("dialog.titleBlockExists"),
          });
          return;
        }
        insertTable(a, titleBlock(0, 0));
      },
    },

    /* ---- exporting ---- */
    { id: "export.svg", titleKey: "cmd.exportSvg", run: (a) => exportSvgFile(a) },
    { id: "export.png", titleKey: "cmd.exportPng", run: (a) => exportPngFile(a) },
    { id: "export.csv", titleKey: "cmd.exportCsv", run: (a) => exportWireCsv(a) },
    { id: "export.print", titleKey: "cmd.print", shortcut: "Ctrl+P", run: (a) => printDrawing(a) },

    /* ---- applicazione ---- */
    {
      id: "app.plugins",
      titleKey: "cmd.plugins",
      run: (a) => a.showPlugins(),
    },
    {
      id: "app.language",
      titleKey: "cmd.language",
      // changing the locale rebuilds the interface through onLocaleChange
      run: () => {
        const all = locales();
        const index = all.indexOf(getLocale());
        const next = all[(index + 1) % all.length];
        if (next) setLocale(next);
      },
    },
    {
      id: "app.palette",
      titleKey: "cmd.palette",
      shortcut: "Ctrl+K",
      palette: false,
      run: (a) => openCommandPalette(a),
    },
  ];

  for (const command of commands) app.commands.register(command);
}
