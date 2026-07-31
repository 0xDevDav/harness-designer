import type { Rect } from "@/core/types";
import type { Store } from "@/core/store";
import type { RendererApi } from "@/app/context";

/**
 * In-place editing.
 *
 * An HTML text field is laid over the sheet, exactly on top of the cell or
 * label being edited. The field cannot live inside the SVG: every redraw empties
 * `#world`, so it sits in its own layer and repositions itself when the view
 * changes.
 *
 * Two lessons from technical drawing: below a certain scale the text on the
 * sheet is unreadable, so the editor never drops under a minimum legible size;
 * and Tab has to jump to the next cell without reaching for the mouse, or
 * filling in a pin-out becomes
 * lentissimo.
 */

/** Minimum font size of the editor, in screen pixels. */
const MIN_FONT = 12;
/** Minimum width of the field, in screen pixels. */
const MIN_WIDTH = 70;

export interface InlineEditOptions {
  /** box to cover, in document coordinates */
  rect: Rect;
  value: string;
  /** text size in the document; it is scaled with the view */
  fontSize?: number;
  align?: "left" | "center";
  /** called on every keystroke, which is what makes the live preview possible */
  onInput?: (value: string) => void;
  /** called on confirm; `next` says whether to move to the following cell */
  onCommit: (value: string, next: "none" | "forward" | "back" | "up" | "down") => void;
  onCancel?: () => void;
}

interface ActiveEditor {
  input: HTMLInputElement;
  rect: Rect;
  fontSize: number;
  reposition: () => void;
}

let active: ActiveEditor | null = null;
let host: HTMLElement | null = null;
let renderer: RendererApi | null = null;
let store: Store | null = null;
let detachView: (() => void) | null = null;

/** Connects the editor to the overlay layer and to the view. */
export function initInlineEdit(options: { host: HTMLElement; renderer: RendererApi; store: Store }): void {
  host = options.host;
  renderer = options.renderer;
  store = options.store;
  detachView?.();
  // pan, zoom and redraws move the sheet under the editor, so it is realigned
  detachView = store.on("doc", () => active?.reposition());
}

export const isInlineEditing = (): boolean => active !== null;

export function closeInlineEditor(): void {
  if (!active) return;
  const { input } = active;
  active = null;
  input.remove();
}

export function openInlineEditor(options: InlineEditOptions): void {
  if (!host || !renderer) return;
  closeInlineEditor();

  const input = document.createElement("input");
  input.type = "text";
  input.className = "inline-edit";
  input.value = options.value;
  input.spellcheck = false;
  input.autocomplete = "off";
  if (options.align === "center") input.style.textAlign = "center";

  const editor: ActiveEditor = {
    input,
    rect: options.rect,
    fontSize: options.fontSize ?? 11,
    reposition: () => {
      if (!renderer) return;
      const view = store?.view ?? { x: 0, y: 0, k: 1 };
      const topLeft = renderer.worldToScreen({ x: editor.rect.x, y: editor.rect.y });
      const width = Math.max(MIN_WIDTH, editor.rect.w * view.k);
      const height = Math.max(MIN_FONT + 8, editor.rect.h * view.k);
      input.style.left = `${topLeft.x}px`;
      input.style.top = `${topLeft.y}px`;
      input.style.width = `${width}px`;
      input.style.height = `${height}px`;
      input.style.fontSize = `${Math.max(MIN_FONT, editor.fontSize * view.k)}px`;
    },
  };

  let closing = false;
  const finish = (next: Parameters<InlineEditOptions["onCommit"]>[1]): void => {
    if (closing) return;
    closing = true;
    const value = input.value;
    closeInlineEditor();
    options.onCommit(value, next);
  };
  const abandon = (): void => {
    if (closing) return;
    closing = true;
    closeInlineEditor();
    options.onCancel?.();
  };

  input.addEventListener("input", () => options.onInput?.(input.value));
  input.addEventListener("keydown", (ev) => {
    // global shortcuts must not fire while typing
    ev.stopPropagation();
    if (ev.key === "Escape") {
      ev.preventDefault();
      abandon();
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      finish(ev.shiftKey ? "up" : "down");
    } else if (ev.key === "Tab") {
      ev.preventDefault();
      finish(ev.shiftKey ? "back" : "forward");
    } else if (ev.key === "ArrowUp" || ev.key === "ArrowDown") {
      // vertical arrows change row only when the caret is not needed in the text
      ev.preventDefault();
      finish(ev.key === "ArrowUp" ? "up" : "down");
    }
  });
  input.addEventListener("blur", () => finish("none"));

  host.appendChild(input);
  active = editor;
  editor.reposition();
  input.focus();
  input.select();
}
