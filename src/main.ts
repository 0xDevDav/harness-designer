import "./styles/app.css";

import { APP_VERSION } from "./app/version";
import type { AppContext, SidebarSection } from "./app/context";
import { Store } from "./core/store";
import { normalizeDoc } from "./core/doc";
import { sampleDoc } from "./core/sample";
import type { HarnessDoc, Issue, Point, Selection } from "./core/types";
import { detectLocale, getLocale, locales, onLocaleChange, setLocale, t } from "./i18n";
import { Renderer } from "./render/renderer";
import { SchematicRenderer } from "./render/schematic";
import { attachInteraction } from "./ui/interaction";
import { attachSchematicInteraction } from "./ui/schematic";
import { initViewMode, onViewModeChange, setViewMode, showsBoard, showsSchematic } from "./ui/viewmode";
import { closeMenu, openMenu } from "./ui/menu";
import { contextMenuItems } from "./ui/contextmenu";
import { createCommandRegistry, registerBuiltinCommands } from "./ui/commands";
import { attachKeyboard } from "./ui/keyboard";
import { renderTopbar } from "./ui/topbar";
import { createDialogs } from "./ui/dialogs";
import { createToasts } from "./ui/toast";
import { renderReport } from "./ui/report";
import { renderPluginsPanel } from "./ui/pluginsPanel";
import { createPluginHost } from "./plugins/host";
import { builtinExporters } from "./io/exporters";
import { DOC_KEY, adoptAutosaveFrom, safeGet, safeSet } from "./io/storage";
import { announceDocSaved, watchOtherTabs } from "./io/tabs";
import { readDocFile } from "./io/file";
import { closeAllPanels, initPanels, isPanelOpen, openPanel, refreshPanels } from "./ui/panel";
import { closeInlineEditor, initInlineEdit, isInlineEditing } from "./ui/inline-edit";
import { editOnSheet, editTargetFrom } from "./ui/sheet-edit";
import { renderGuide } from "./ui/guide";
import { renderPluginGuide } from "./ui/pluginGuide";
import { initTheme, onThemeChange, resolvedTheme } from "./ui/theme";
import { initTooltips } from "./ui/tooltip";
import { setDrawingTheme } from "./render/palette";

/* ---------------- document elements ---------------- */

const need = <T extends Element>(selector: string): T => {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`missing element in the document: ${selector}`);
  return node;
};

const svg = need<SVGSVGElement>("#svg");
const world = need<SVGGElement>("#world");
const views = need<HTMLElement>("#views");
const boardTag = need<HTMLElement>("#boardTag");
const schematicSvg = need<SVGSVGElement>("#schematicSvg");
const schematicWorld = need<SVGGElement>("#schematicWorld");
const schematicZoom = need<HTMLElement>("#schematicZoom");
const schematicTag = need<HTMLElement>("#schematicTag");
const topbarHost = need<HTMLElement>("#topbar");
const overlay = need<HTMLElement>("#overlay");
const panelHost = need<HTMLElement>("#panels");
const hint = need<HTMLElement>("#hint");
const zoomLabel = need<HTMLElement>("#zoomLabel");
const toastHost = need<HTMLElement>("#toasts");
const fileInput = need<HTMLInputElement>("#fileInput");
const csvInput = need<HTMLInputElement>("#csvInput");

/* ---------------- state and services ---------------- */

setLocale(detectLocale());
document.documentElement.lang = getLocale();
initTheme();
setDrawingTheme(resolvedTheme());
initTooltips();

const store = new Store();
const renderer = new Renderer({ store, t, svg, world, zoomLabel });
const schematic = new SchematicRenderer({
  store,
  t,
  svg: schematicSvg,
  world: schematicWorld,
  zoomLabel: schematicZoom,
});
const dialogs = createDialogs(t);
const toast = createToasts(toastHost);
const commands = createCommandRegistry();

initPanels(panelHost);
initInlineEdit({ host: overlay, renderer, store });
initViewMode(views);

/** Identifiers of the floating panels. */
const PANEL = { report: "report", plugins: "plugins", guide: "guide", pluginGuide: "plugin-guide" } as const;
let lastIssues: Issue[] | undefined;

const app: AppContext = {
  store,
  renderer,
  schematic,
  t,
  locale: getLocale(),
  dialogs,
  toast,
  commands,
  plugins: undefined as never, // assigned right below: the host needs the context
  exporters: [...builtinExporters()],
  sidebarSections: [] as SidebarSection[],
  version: APP_VERSION,
  get doc(): HarnessDoc {
    return store.doc;
  },
  refreshUi(): void {
    document.documentElement.lang = getLocale();
    app.locale = getLocale();
    hint.textContent = store.tool === "branch" ? t("hint.branch") : t("hint.select");
    // each view says which one it is, in the same place and the same shape:
    // side by side they are two halves of one interface, not two programs
    boardTag.textContent = t("board.title");
    schematicTag.textContent = t("schematic.title");
    renderTopbar(app, topbarHost);
    refreshPanels();
  },
  refreshProps(): void {
    // There is no properties panel any more: edits happen on the sheet. What
    // is left to refresh are the floating panels that happen to be open.
    refreshPanels();
  },
  showReport(issues?: Issue[]): void {
    lastIssues = issues;
    openPanel({
      id: PANEL.report,
      title: t("validate.title"),
      width: 330,
      render: (body) => renderReport(app, body, lastIssues),
    });
  },
  showPlugins(): void {
    openPanel({
      id: PANEL.plugins,
      title: t("plugins.title"),
      width: 340,
      render: (body) => {
        renderPluginsPanel(app, body);
        // sections registered by plugins used to live in the sidebar; they now
        // sit at the end of the panel, which is their natural home
        for (const section of app.sidebarSections) {
          try {
            section(body, store.selection, app);
          } catch (err) {
            console.error("[harness] a plugin panel section threw", err);
          }
        }
      },
    });
  },
  showProps(): void {
    // kept for plugin compatibility: closes whatever covers the sheet
    closeAllPanels();
  },
  showGuide(): void {
    openPanel({
      id: PANEL.guide,
      title: t("props.quickGuide"),
      width: 360,
      render: (body) => renderGuide(app, body),
    });
  },
  showPluginGuide(): void {
    openPanel({
      id: PANEL.pluginGuide,
      title: t("plugins.docsLink"),
      width: 460,
      render: (body) => renderPluginGuide(app, body),
    });
  },
  openFilePicker(): void {
    fileInput.click();
  },
  pickCsv(): Promise<string | null> {
    return new Promise((resolve) => {
      let settled = false;
      const done = (value: string | null): void => {
        if (settled) return;
        settled = true;
        csvInput.value = "";
        csvInput.onchange = null;
        csvInput.oncancel = null;
        window.removeEventListener("focus", onWindowFocus);
        resolve(value);
      };
      // if the user dismisses the picker without choosing, `change` never
      // fires, and without this way out the promise would hang forever
      const onWindowFocus = (): void => {
        window.setTimeout(() => {
          if (!csvInput.files?.length) done(null);
        }, 400);
      };
      csvInput.oncancel = () => done(null);
      csvInput.onchange = () => {
        const file = csvInput.files?.[0];
        if (!file) return done(null);
        file
          .text()
          .then((text) => done(text))
          .catch(() => done(null));
      };
      window.addEventListener("focus", onWindowFocus);
      csvInput.click();
    });
  },
};

app.plugins = createPluginHost({
  getApp: () => app,
  builtins: [
    { kind: "builtin", value: new URL("./plugins/metraggi.js", document.baseURI).href },
    { kind: "builtin", value: new URL("./plugins/connettore-tondo.js", document.baseURI).href },
  ],
});

/* ---------------- autosave ---------------- */

let storageWarned = false;
let saveTimer: number | undefined;

store.setPersister((doc) => {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    const result = safeSet(DOC_KEY, JSON.stringify(doc));
    // the other tabs share the same storage, so they have to be told the
    // latest autosave is no longer theirs
    if (result === "ok") announceDocSaved();
    if (result === "ok" || storageWarned) return;
    storageWarned = true;
    toast.error(t(result === "quota" ? "toast.storageFull" : "toast.storageOff"));
  }, 250);
});

/* ---------------- event wiring ---------------- */

/* ---------------- the two views ---------------- */

/**
 * Views waiting to be fitted to what they are showing.
 *
 * Neither can be fitted while it is hidden — a view with no size on screen has
 * no ratio to fit to — so a fit asked for while a view is away waits until it
 * is shown. Both come round again whenever a different drawing is loaded.
 */
let boardToFit = true;
let schematicToFit = true;

const drawViews = (): void => {
  if (showsBoard()) renderer.requestRedraw();
  if (showsSchematic()) schematic.requestRedraw();
};

/**
 * The sheet answering the schematic: the branches a wire picked over there
 * runs through, and the connectors at its two ends.
 */
const syncHighlight = (): void => {
  const lit = schematic.boardHighlight();
  renderer.highlight = lit.nodes.size || lit.segments.size ? lit : null;
  renderer.requestRedraw();
};

/** Fits each view the first moment it is both waiting for it and on screen. */
const fitViewsIfNeeded = (): void => {
  if (boardToFit && showsBoard()) {
    boardToFit = false;
    renderer.fitView();
  }
  if (schematicToFit && showsSchematic()) {
    schematicToFit = false;
    schematic.fitView();
  }
};

store.on("doc", ({ reason }) => {
  // A redraw is not a rebuild. Panning, picking or changing tool alters nothing
  // the schematic is made of, and rebuilding it would route every wire in the
  // harness again on a frame that only had to move the view.
  if (reason !== "view" && reason !== "selection" && reason !== "tool") schematic.invalidate();
  drawViews();
  // the check report goes stale the moment the drawing changes
  if (isPanelOpen(PANEL.report)) lastIssues = undefined;
});
store.on("load", () => {
  closeInlineEditor();
  schematic.invalidate();
  schematic.focusedWire = null;
  renderer.highlight = null;
  boardToFit = true;
  schematicToFit = true;
  requestAnimationFrame(fitViewsIfNeeded);
  refreshPanels();
});
// picking something on the sheet is a different question from the wire in hand:
// two answers lit at once in both views would be two, not one
store.on("selection", ({ selection }) => {
  if (!selection || !schematic.focusedWire) return;
  schematic.focusedWire = null;
  schematic.requestRedraw();
  syncHighlight();
});

onViewModeChange(() => {
  app.refreshUi();
  // a view that was hidden has no size, so nothing could be drawn or fitted to
  // it while it was away: both happen the moment it comes back
  requestAnimationFrame(() => {
    drawViews();
    fitViewsIfNeeded();
  });
});
store.on("tool", ({ tool }) => {
  hint.textContent = tool === "branch" ? t("hint.branch") : t("hint.select");
});

onLocaleChange(() => {
  app.refreshUi();
  // the schematic writes the words it is given, so a change of language is a
  // change to what is drawn on it
  schematic.requestRedraw();
});
// the sheet follows the theme: light paper by day, dark sheet by night
onThemeChange(() => {
  setDrawingTheme(resolvedTheme());
  drawViews();
});

/* ---------------- interaction and commands ---------------- */

registerBuiltinCommands(app);
attachKeyboard(app);
attachInteraction({
  store,
  renderer,
  svg,
  hint,
  t,
  onContextMenu: (target: Selection | null, world_: Point, ev: MouseEvent) => {
    const hit = editTargetFrom(ev.target as Element | null);
    const cell = hit?.row !== undefined && hit.col !== undefined ? { row: hit.row, col: hit.col } : undefined;
    openMenu(ev.clientX, ev.clientY, contextMenuItems(app, target, world_, cell));
  },
  onEdit: (ev: MouseEvent) => {
    const world_ = renderer.screenToWorld(ev);
    // The first click selects and redraws the sheet, so by the second one the
    // element under the pointer is a different object and the double click
    // bubbles to the SVG. In that case the selection just made is the one that
    // counts, with the cell worked out from the point.
    const hit =
      editTargetFrom(ev.target as Element | null) ??
      (store.selection ? { selection: store.selection } : null);
    if (hit) editOnSheet(app, { ...hit, world: world_ });
  },
});

attachSchematicInteraction({
  store,
  schematic,
  svg: schematicSvg,
  onFocusChange: syncHighlight,
  onReveal: (selection) => {
    // asking where a connector is on the sheet, from a view the sheet may not
    // even be next to: it is brought out first, then centred once it has a size
    if (!showsBoard()) setViewMode("split");
    requestAnimationFrame(() => {
      const box = renderer.entityBBox(selection);
      if (box) renderer.centerOn(box);
    });
  },
});

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  fileInput.value = "";
  if (!file) return;
  readDocFile(file)
    .then((parsed) => {
      // normalizeDoc takes any structure, so an incomplete document can no
      // longer leave the application in an unrecoverable state
      // the fit is the business of the load listener, which knows which of the
      // two views is on screen and can fit one that is not yet
      store.load(parsed, { reason: "open" });
      toast.show(t("toast.opened"));
    })
    .catch((err: unknown) => {
      void dialogs.alert({
        title: t("topbar.open"),
        body: t("dialog.invalidFile", { error: err instanceof Error ? err.message : String(err) }),
      });
    });
});

// the view fits the container again whenever the window is resized
window.addEventListener("resize", () => drawViews());
window.addEventListener("blur", () => closeMenu());
// an edit in progress must not stay hanging over a sheet that is changing
window.addEventListener("wheel", () => closeInlineEditor(), { passive: true });

/* ---------------- multiple tabs ---------------- */

watchOtherTabs(() => toast.show(t("toast.otherTab")));

/* ---------------- startup ---------------- */

function initialDoc(): unknown {
  // a drawing left open under a key another build used is carried over rather
  // than silently abandoned
  adoptAutosaveFrom(["harness.doc.v2", "harnessDoc"]);
  const saved = safeGet(DOC_KEY);
  if (saved) {
    try {
      return normalizeDoc(JSON.parse(saved));
    } catch {
      // unreadable autosave: start from the sample rather than stall
    }
  }
  return sampleDoc(t);
}

store.load(initialDoc(), { reason: "init" });
app.refreshUi();
requestAnimationFrame(fitViewsIfNeeded);

void app.plugins.loadAll().then(() => app.refreshUi());

/* ---------------- funzionamento offline ---------------- */

/**
 * Offers the update once one is ready and waiting.
 *
 * The service worker deliberately does not take over by itself: a tab must not
 * change version under someone in the middle of drawing. The cost of that is
 * that an update sits there in silence, and the only way to reach it is to
 * close every tab of the site — which nobody does, because nobody was told.
 * So it says so, and the reload happens when the offer is accepted.
 */
function offerUpdate(registration: ServiceWorkerRegistration): void {
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!reloading) return;
    reloading = false;
    location.reload();
  });

  const ready = (waiting: ServiceWorker | null): void => {
    // no controller yet means this is the first visit, not an update: there is
    // nothing to replace and nothing worth interrupting anyone about
    if (!waiting || !navigator.serviceWorker.controller) return;
    toast.show(t("toast.updateReady"), {
      duration: 0,
      action: {
        label: t("toast.updateReload"),
        run: () => {
          reloading = true;
          waiting.postMessage({ type: "SKIP_WAITING" });
        },
      },
    });
  };

  ready(registration.waiting);
  registration.addEventListener("updatefound", () => {
    const installing = registration.installing;
    if (!installing) return;
    installing.addEventListener("statechange", () => {
      if (installing.state === "installed") ready(registration.waiting);
    });
  });
}

// opened from file:// (the single-file copy) there is nothing to cache, and
// service workers are not even allowed on that protocol
if ("serviceWorker" in navigator && import.meta.env.PROD && location.protocol !== "file:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(new URL("sw.js", document.baseURI).href)
      .then(offerUpdate)
      .catch(() => {
        // a missing service worker does not affect use while online
      });
  });
}

// the web app manifest only makes sense when served from a site
if (location.protocol === "file:") {
  document.querySelector('link[rel="manifest"]')?.remove();
}

// handy for console diagnostics and for in-browser integration tests
Object.defineProperty(window, "harness", {
  value: { app, store, renderer, t, locales, isInlineEditing },
  writable: false,
});
