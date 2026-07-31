/**
 * Shared floating menu, used both by right-clicking the sheet and by the
 * dropdown buttons in the top bar.
 *
 * At most one exists at a time: opening another closes the previous one, so no
 * orphan menus are left behind when moving from one button to the next.
 */
import { t } from "@/i18n";
import type { AppContext } from "@/app/context";
import type { Point, Selection } from "@/core/types";

export type MenuItem =
  | { label: string; run: () => void; danger?: boolean; disabled?: boolean; shortcut?: string }
  | { separator: true }
  | { header: string };

/** Contesto passato a chi aggiunge voci al menù contestuale (plugin). */
export interface MenuContext {
  target: Selection | null;
  world: Point;
  app: AppContext;
}

export type MenuContributor = (ctx: MenuContext) => MenuItem[];

/* ---------------- contribution registry ---------------- */

const contributors = new Set<MenuContributor>();

/**
 * Adds entries to the right-click menu. The returned function removes the
 * contribution, which is what lets a plugin disappear without reloading the
 * pagina.
 */
export function registerMenuContributor(fn: MenuContributor): () => void {
  contributors.add(fn);
  return () => {
    contributors.delete(fn);
  };
}

export function menuContributors(): MenuContributor[] {
  return [...contributors];
}

/* ---------------- state of the open menu ---------------- */

interface Entry {
  el: HTMLElement;
  run: () => void;
}

let host: HTMLDivElement | null = null;
/** Only the entries that can really be picked: arrows skip headers and disabled items. */
let entries: Entry[] = [];
let activeIndex = -1;
/** The element that held focus before opening, to hand it back on close. */
let opener: HTMLElement | null = null;

const isSeparator = (item: MenuItem): item is { separator: true } => "separator" in item;
const isHeader = (item: MenuItem): item is { header: string } => "header" in item;

export function isMenuOpen(): boolean {
  return host !== null;
}

export function closeMenu(): void {
  destroy(true);
}

function destroy(restoreFocus: boolean): void {
  if (!host) return;
  window.removeEventListener("pointerdown", onPointerDown, true);
  window.removeEventListener("keydown", onKeyDown, true);
  window.removeEventListener("wheel", onWheel, true);
  window.removeEventListener("blur", onWindowBlur);
  host.remove();
  host = null;
  entries = [];
  activeIndex = -1;
  const previous = opener;
  opener = null;
  if (restoreFocus && previous && previous.isConnected) previous.focus({ preventScroll: true });
}

/**
 * Opens the menu at the given screen coordinates. The list is cleaned of
 * redundant separators, so whoever assembles the menu, plugins included, can
 * add them without worrying about duplicates or a trailing one.
 */
export function openMenu(x: number, y: number, items: MenuItem[]): void {
  destroy(false);
  const list = tidy(items);
  if (!list.length) return;

  opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const menu = document.createElement("div");
  menu.className = "menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", t("menu.aria"));
  menu.tabIndex = -1;

  let itemId = 0;
  for (const item of list) {
    if (isSeparator(item)) {
      const sep = document.createElement("div");
      sep.className = "menu__sep";
      sep.setAttribute("role", "separator");
      menu.append(sep);
      continue;
    }
    if (isHeader(item)) {
      const header = document.createElement("div");
      header.className = "menu__header";
      header.textContent = item.header;
      menu.append(header);
      continue;
    }

    const row = document.createElement("div");
    row.className = "menu__item" + (item.danger ? " menu__item--danger" : "");
    row.setAttribute("role", "menuitem");
    row.id = `menu-item-${itemId++}`;

    const label = document.createElement("span");
    label.textContent = item.label;
    row.append(label);

    if (item.shortcut) {
      const kbd = document.createElement("kbd");
      kbd.textContent = item.shortcut;
      row.append(kbd);
    }

    if (item.disabled) {
      row.setAttribute("aria-disabled", "true");
    } else {
      const entry: Entry = { el: row, run: item.run };
      const index = entries.length;
      entries.push(entry);
      row.addEventListener("click", () => activate(entry));
      row.addEventListener("pointermove", () => setActive(index));
    }
    menu.append(row);
  }

  document.body.append(menu);
  host = menu;
  place(x, y);

  window.addEventListener("pointerdown", onPointerDown, true);
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("wheel", onWheel, { capture: true, passive: true });
  window.addEventListener("blur", onWindowBlur);

  menu.focus({ preventScroll: true });
}

/** Toglie separatori iniziali, finali e ripetuti. */
function tidy(items: MenuItem[]): MenuItem[] {
  const out: MenuItem[] = [];
  for (const item of items) {
    if (isSeparator(item)) {
      const last = out[out.length - 1];
      if (!last || isSeparator(last)) continue;
      out.push(item);
      continue;
    }
    out.push(item);
  }
  while (out.length) {
    const last = out[out.length - 1];
    if (last && isSeparator(last)) out.pop();
    else break;
  }
  return out;
}

/** Places the menu, keeping it inside the window edges. */
function place(x: number, y: number): void {
  if (!host) return;
  host.style.left = "0px";
  host.style.top = "0px";
  const r = host.getBoundingClientRect();
  const left = Math.max(4, Math.min(x, window.innerWidth - r.width - 8));
  const top = Math.max(4, Math.min(y, window.innerHeight - r.height - 8));
  host.style.left = `${left}px`;
  host.style.top = `${top}px`;
}

function setActive(index: number): void {
  if (!host || !entries.length) return;
  const next = Math.max(0, Math.min(index, entries.length - 1));
  const previous = entries[activeIndex];
  if (previous) previous.el.classList.remove("is-active");
  activeIndex = next;
  const entry = entries[activeIndex];
  if (!entry) return;
  entry.el.classList.add("is-active");
  host.setAttribute("aria-activedescendant", entry.el.id);
  entry.el.scrollIntoView({ block: "nearest" });
}

function move(delta: number): void {
  if (!entries.length) return;
  if (activeIndex < 0) {
    setActive(delta > 0 ? 0 : entries.length - 1);
    return;
  }
  setActive((activeIndex + delta + entries.length) % entries.length);
}

/**
 * The action runs with the menu already closed: if it opens a dialog, focus is
 * free and no element is left hanging on screen.
 */
function activate(entry: Entry): void {
  closeMenu();
  try {
    entry.run();
  } catch (err) {
    console.error("[harness] a menu action failed", err);
  }
}

/* ---------------- automatic closing ---------------- */

function onPointerDown(ev: PointerEvent): void {
  if (!host) return;
  if (ev.target instanceof Node && host.contains(ev.target)) return;
  closeMenu();
}

function onWheel(ev: WheelEvent): void {
  if (!host) return;
  // the wheel scrolls a long menu from inside; from outside it closes it
  if (ev.target instanceof Node && host.contains(ev.target)) return;
  closeMenu();
}

function onWindowBlur(): void {
  destroy(false);
}

function onKeyDown(ev: KeyboardEvent): void {
  if (!host) return;
  switch (ev.key) {
    case "Escape":
    case "Tab":
      stop(ev);
      closeMenu();
      return;
    case "ArrowDown":
      stop(ev);
      move(1);
      return;
    case "ArrowUp":
      stop(ev);
      move(-1);
      return;
    case "Home":
      stop(ev);
      setActive(0);
      return;
    case "End":
      stop(ev);
      setActive(entries.length - 1);
      return;
    case "Enter":
    case " ": {
      stop(ev);
      const entry = entries[activeIndex];
      if (entry) activate(entry);
      return;
    }
    default:
      // any other key, modifiers alone aside, leaves the menu and lets the
      // event carry on, so the shortcut acts on a clean state
      if (!MODIFIER_KEYS.has(ev.key)) closeMenu();
      return;
  }
}

const MODIFIER_KEYS = new Set([
  "Shift",
  "Control",
  "Alt",
  "Meta",
  "AltGraph",
  "CapsLock",
  "ContextMenu",
  "Dead",
]);

/** While the menu is open the keys are its own: app shortcuts must not fire. */
function stop(ev: KeyboardEvent): void {
  ev.preventDefault();
  ev.stopPropagation();
}
