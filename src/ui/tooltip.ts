/**
 * Suggerimenti.
 *
 * Icon-only buttons do not say what they do: the tooltip is the only label
 * they have. The browser's native one takes well over a second, cannot be
 * styled, and never shows up on touch, so it is rebuilt here with the same look
 * as the rest of the interface.
 *
 * It applies to any element carrying `data-tip`, including ones created later:
 * listening is delegated to the document, so nothing has to be registered.
 */

const DELAY = 340;
const GAP = 8;

let tip: HTMLElement | null = null;
let timer: number | undefined;
let anchor: HTMLElement | null = null;

function ensure(): HTMLElement {
  if (!tip) {
    tip = document.createElement("div");
    tip.className = "tooltip";
    tip.setAttribute("role", "tooltip");
    document.body.appendChild(tip);
  }
  return tip;
}

/** Splits "Undo (Ctrl+Z)" into the text and the shortcut, when there is one. */
const SHORTCUT_RE = /^(.*?)\s*\(([^()]+)\)\s*$/;

/**
 * The text without its shortcut. On a touch screen there is no keyboard to
 * press, so the bracket is noise wherever the label is read on its own.
 */
export function labelWithoutShortcut(value: string): string {
  return SHORTCUT_RE.exec(value)?.[1] ?? value;
}

/**
 * Text and shortcut are written "Undo (Ctrl+Z)": the part in brackets is drawn
 * as a key cap, so it can be told apart at a glance.
 */
function fill(box: HTMLElement, value: string): void {
  box.replaceChildren();
  const match = SHORTCUT_RE.exec(value);
  if (match?.[1] && match[2]) {
    box.appendChild(document.createTextNode(match[1]));
    const kbd = document.createElement("kbd");
    kbd.textContent = match[2];
    box.appendChild(kbd);
  } else {
    box.textContent = value;
  }
}

/**
 * Where the tooltip has nothing to add.
 *
 * On a phone or a tablet there is no pointer to rest on an element: the box
 * would either never appear or appear on a tap, sitting on top of whatever was
 * just pressed. The controls that relied on it there print their label instead,
 * so nothing is lost by staying quiet.
 */
function suppressed(): boolean {
  return window.matchMedia("(hover: none), (pointer: coarse), (max-width: 860px)").matches;
}

function show(target: HTMLElement): void {
  const value = target.dataset["tip"];
  if (!value || suppressed()) return;

  const box = ensure();
  fill(box, value);
  box.classList.add("is-visible");
  anchor = target;

  const rect = target.getBoundingClientRect();
  const size = box.getBoundingClientRect();
  // above the element where there is room, below otherwise
  const above = rect.top - size.height - GAP >= 6;
  const top = above ? rect.top - size.height - GAP : rect.bottom + GAP;
  const left = rect.left + rect.width / 2 - size.width / 2;

  box.style.top = `${Math.round(top)}px`;
  box.style.left = `${Math.round(Math.min(Math.max(6, left), window.innerWidth - size.width - 6))}px`;
}

function hide(): void {
  window.clearTimeout(timer);
  anchor = null;
  tip?.classList.remove("is-visible");
}

/** Hooks tooltips onto the document. Call once at startup. */
export function initTooltips(): void {
  const targetOf = (event: Event): HTMLElement | null => {
    const el = event.target;
    return el instanceof Element ? el.closest<HTMLElement>("[data-tip]") : null;
  };

  document.addEventListener(
    "pointerover",
    (ev) => {
      const target = targetOf(ev);
      if (!target || target === anchor) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => show(target), DELAY);
    },
    true,
  );

  document.addEventListener(
    "pointerout",
    (ev) => {
      const target = targetOf(ev);
      if (target && target === anchor) hide();
      else if (!target) hide();
    },
    true,
  );

  // keyboard focus deserves the same help as hovering does
  document.addEventListener("focusin", (ev) => {
    const target = targetOf(ev);
    if (target) show(target);
  });
  document.addEventListener("focusout", hide);

  // a click runs the action, so the tooltip has done its job
  document.addEventListener("pointerdown", hide, true);
  window.addEventListener("blur", hide);
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") hide();
  });
}

/**
 * Sets the tooltip on an element, replacing the browser's native one: two
 * overlapping boxes would be nothing but noise.
 */
export function setTip(element: HTMLElement, value: string): void {
  element.dataset["tip"] = value;
  element.removeAttribute("title");
}
