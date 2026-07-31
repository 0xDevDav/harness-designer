/**
 * Contracts shared by the interface modules.
 *
 * This file holds no implementations: it declares the service interfaces
 * (dialogs, messages, commands, plugins, drawing) so that every module depends
 * on a stable type instead of on the other modules. Read this first before
 * adding a feature.
 */
import type { Store } from "@/core/store";
import type { HarnessDoc, Issue, Point, Rect, Selection } from "@/core/types";
import type { Locale, Translate } from "@/i18n";

/* ---------------- drawing ---------------- */

export interface RendererApi {
  /** node highlighted under the pointer, the snap target */
  hoverNodeId: string | null;
  /** point the preview reaches towards while a branch is being drawn */
  branchPreviewTo: Point | null;
  /** redraw deferred to the next frame: safe to call on every event */
  requestRedraw(): void;
  /** immediate redraw: only when the result has to be read straight away */
  redrawNow(): void;
  /** box containing the whole drawing, with a margin */
  contentBBox(): Rect;
  /** box of one element, in document coordinates */
  entityBBox(selection: Selection): Rect | null;
  selectionBBox(): Rect | null;
  fitView(): void;
  /** brings the given box to the centre of the view, leaving zoom alone */
  centerOn(rect: Rect): void;
  zoomBy(factor: number, pivotScreen?: Point): void;
  screenToWorld(ev: { clientX: number; clientY: number }): Point;
  /** the reverse conversion, to place the in-place editor over an element */
  worldToScreen(point: Point): Point;
  /** nearest node to a point within the given radius, in document coordinates */
  nodeNear(point: Point, radius: number): string | null;
  /** self-contained SVG of the whole drawing, for export and print */
  renderToString(): string;
}

/* ---------------- messages and dialogs ---------------- */

export interface ToastOptions {
  kind?: "info" | "error";
  /** duration in milliseconds, 3200 by default */
  duration?: number;
}

export interface ToastApi {
  show(message: string, options?: ToastOptions): void;
  error(message: string): void;
}

export interface ConfirmOptions {
  title: string;
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

export interface PromptOptions {
  title: string;
  label: string;
  value?: string;
  placeholder?: string;
}

export interface DialogsApi {
  confirm(options: ConfirmOptions): Promise<boolean>;
  prompt(options: PromptOptions): Promise<string | null>;
  alert(options: { title: string; body: string }): Promise<void>;
}

/* ---------------- commands ---------------- */

export interface Command {
  id: string;
  /** i18n key of the title shown in the palette */
  titleKey: string;
  /** declarative shortcut, e.g. "Ctrl+S", "Delete", "B" */
  shortcut?: string;
  /** grouping in the palette, an optional i18n key */
  groupKey?: string;
  /** false hides the command from the palette; it stays callable by id */
  palette?: boolean;
  enabled?(app: AppContext): boolean;
  run(app: AppContext): void | Promise<void>;
}

export interface CommandRegistry {
  register(command: Command): () => void;
  get(id: string): Command | undefined;
  all(): Command[];
  run(id: string): void;
  /** command bound to a key combination, e.g. "ctrl+s" */
  matchShortcut(event: KeyboardEvent): Command | undefined;
}

/* ---------------- exporters ---------------- */

export interface Exporter {
  id: string;
  /** i18n key of the menu entry */
  labelKey: string;
  run(app: AppContext): void | Promise<void>;
}

/* ---------------- plugin ---------------- */

export type PluginStatus = "enabled" | "disabled" | "failed";

export interface PluginSource {
  /** `builtin` for the plugins shipped with the application */
  kind: "builtin" | "url" | "inline";
  /** module address, or the source code itself for `inline` */
  value: string;
}

export interface PluginRecord {
  id: string;
  name: string;
  version: string;
  author?: string;
  description?: string;
  source: PluginSource;
  status: PluginStatus;
  error?: string;
  /** readable list of what the plugin adds: commands, rules… */
  contributions: string[];
}

export interface PluginHostApi {
  list(): PluginRecord[];
  /** loads and activates the stored plugins; call this at startup */
  loadAll(): Promise<void>;
  install(source: PluginSource): Promise<PluginRecord>;
  setEnabled(id: string, enabled: boolean): Promise<void>;
  remove(id: string): void;
}

/* ---------------- panel sections ---------------- */

/**
 * A plugin may add a section to the properties panel: it is handed the
 * container and the current selection, and draws whatever it likes.
 */
export type SidebarSection = (container: HTMLElement, selection: Selection | null, app: AppContext) => void;

/* ---------------- application context ---------------- */

export interface AppContext {
  store: Store;
  renderer: RendererApi;
  t: Translate;
  locale: Locale;
  dialogs: DialogsApi;
  toast: ToastApi;
  commands: CommandRegistry;
  plugins: PluginHostApi;
  exporters: Exporter[];
  /** extra properties-panel sections registered by plugins */
  sidebarSections: SidebarSection[];
  /** application version */
  version: string;

  /** rebuilds the top bar and the properties panel: language change, plugins */
  refreshUi(): void;
  /** rebuilds only the properties panel */
  refreshProps(): void;
  /** shows the check report in its floating panel */
  showReport(issues?: Issue[]): void;
  /** closes the floating panels and leaves the sheet clear */
  showProps(): void;
  /** opens the quick guide to the editing gestures */
  showGuide(): void;
  /** opens the guide for plugin authors */
  showPluginGuide(): void;
  /** opens the file picker to load a document */
  openFilePicker(): void;
  /** asks for a CSV file and returns its contents */
  pickCsv(): Promise<string | null>;
  /** current document, a shorthand for `store.doc` */
  readonly doc: HarnessDoc;
  /** opens the plugin management panel */
  showPlugins(): void;
}
