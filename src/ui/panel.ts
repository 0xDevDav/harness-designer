import { t } from "@/i18n";
import { icon } from "./icons";

/**
 * Floating panels.
 *
 * They replace the sidebar for what cannot be edited straight on the drawing:
 * the check report, plugins, the guide. They are movable, non-modal windows
 * that stay open while work continues on the sheet, which is exactly why they
 * are not dialogs.
 *
 * Every panel has an id: reopening one refreshes the existing window instead of
 * piling up new ones, and the position the user chose is kept for the whole
 * session.
 */

interface OpenPanel {
  root: HTMLElement;
  body: HTMLElement;
  title: HTMLElement;
}

const panels = new Map<string, OpenPanel>();
const positions = new Map<string, { x: number; y: number }>();
let host: HTMLElement | null = null;
let offsetSeed = 0;

export function initPanels(container: HTMLElement): void {
  host = container;
}

export interface PanelOptions {
  id: string;
  title: string;
  /** fills the body; called again on every refresh */
  render: (body: HTMLElement) => void;
  /** preferred width in pixels */
  width?: number;
}

export function isPanelOpen(id: string): boolean {
  return panels.has(id);
}

export function closePanel(id: string): void {
  const panel = panels.get(id);
  if (!panel) return;
  panel.root.remove();
  panels.delete(id);
}

export function closeAllPanels(): void {
  for (const id of [...panels.keys()]) closePanel(id);
}

/** Redraws the contents of the open panels: language change, document edit. */
export function refreshPanels(): void {
  for (const [id, panel] of panels) {
    const render = renderers.get(id);
    if (!render) continue;
    panel.body.replaceChildren();
    try {
      render(panel.body);
    } catch (err) {
      console.error(`[harness] panel "${id}" threw`, err);
    }
  }
}

const renderers = new Map<string, (body: HTMLElement) => void>();

/** Opens a panel, or brings it to the front and refreshes it if already open. */
export function openPanel(options: PanelOptions): void {
  if (!host) return;
  renderers.set(options.id, options.render);

  const existing = panels.get(options.id);
  if (existing) {
    existing.title.textContent = options.title;
    existing.body.replaceChildren();
    options.render(existing.body);
    host.appendChild(existing.root); // in primo piano
    return;
  }

  const root = document.createElement("section");
  root.className = "panel";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", options.title);
  if (options.width) root.style.width = `${options.width}px`;

  const header = document.createElement("header");
  header.className = "panel__head";

  const title = document.createElement("h2");
  title.className = "panel__title";
  title.textContent = options.title;

  const close = document.createElement("button");
  close.type = "button";
  close.className = "panel__close";
  close.appendChild(icon("close", 13));
  close.setAttribute("aria-label", t("panel.close"));
  close.dataset["tip"] = t("panel.close");
  close.addEventListener("click", () => closePanel(options.id));

  header.append(title, close);

  const body = document.createElement("div");
  body.className = "panel__body";
  options.render(body);

  root.append(header, body);
  host.appendChild(root);
  panels.set(options.id, { root, body, title });

  // position: the one chosen before, otherwise the centre of the screen, with
  // a small offset if another panel is already sitting there
  const saved = positions.get(options.id);
  const box = root.getBoundingClientRect();
  const shift = panels.size > 1 ? (offsetSeed % 4) * 26 : 0;
  offsetSeed++;
  const startX = saved?.x ?? (window.innerWidth - box.width) / 2 + shift;
  const startY = saved?.y ?? (window.innerHeight - box.height) / 2 + shift;
  place(root, startX, startY);

  makeDraggable(root, header, (x, y) => positions.set(options.id, { x, y }));

  root.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      ev.stopPropagation();
      closePanel(options.id);
    }
  });
}

function place(root: HTMLElement, x: number, y: number): void {
  const box = root.getBoundingClientRect();
  const maxX = Math.max(8, window.innerWidth - box.width - 8);
  const maxY = Math.max(8, window.innerHeight - box.height - 8);
  root.style.left = `${Math.min(Math.max(8, x), maxX)}px`;
  root.style.top = `${Math.min(Math.max(8, y), maxY)}px`;
}

/** Drag by the header: a panel must never cover what is being worked on. */
function makeDraggable(
  root: HTMLElement,
  handle: HTMLElement,
  onMoved: (x: number, y: number) => void,
): void {
  handle.addEventListener("pointerdown", (ev) => {
    if ((ev.target as HTMLElement).closest(".panel__close")) return;
    ev.preventDefault();
    const box = root.getBoundingClientRect();
    const dx = ev.clientX - box.left;
    const dy = ev.clientY - box.top;
    handle.setPointerCapture(ev.pointerId);

    const move = (e: PointerEvent): void => place(root, e.clientX - dx, e.clientY - dy);
    const stop = (): void => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", stop);
      handle.removeEventListener("pointercancel", stop);
      onMoved(Number.parseFloat(root.style.left), Number.parseFloat(root.style.top));
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
  });
}
