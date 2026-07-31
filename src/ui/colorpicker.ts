import { WIRE_PALETTE, colorsOf, wireColorOf } from "@/core/colors";
import type { WireColor } from "@/core/colors";
import { getLocale, t } from "@/i18n";
import { setTip } from "@/ui/tooltip";

/**
 * Wire colour picker.
 *
 * In a harness the colour is not a free tint but a code: the palette is the
 * standard one (IEC 60757 / DIN 47002) and a wire can have a base and a tracer.
 * The order of the two bands tells "white/yellow" from "yellow/white", so the
 * picker keeps them apart instead of listing every combination.
 *
 * A free-text field remains, for non-standard cases and for documents that were
 * already written.
 */

/** Colour name in the interface language: this is the text written into the cell. */
export const wireColorName = (c: WireColor): string => (getLocale() === "en" ? c.en : c.it);

/** Readable label with the code, for the button and the tooltips. */
export const wireColorLabel = (c: WireColor): string => `${wireColorName(c)} · ${c.code}`;

/** Splits a written value into base and tracer, where they can be recognized. */
export function splitWireColor(value: string): { base?: WireColor; trace?: WireColor; free: boolean } {
  const parts = value
    .split(/[,/+]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.length) return { free: false };
  const base = parts[0] ? wireColorOf(parts[0]) : undefined;
  const trace = parts[1] ? wireColorOf(parts[1]) : undefined;
  // "free" when the text cannot be rebuilt from the palette
  const free = !base || parts.length > 2 || (parts.length === 2 && !trace);
  return { ...(base ? { base } : {}), ...(trace ? { trace } : {}), free };
}

const compose = (base: WireColor | null, trace: WireColor | null): string =>
  base ? (trace ? `${wireColorName(base)}/${wireColorName(trace)}` : wireColorName(base)) : "";

/** Banded swatch, used both in the button and in the palette entries. */
export function swatch(value: string, width = 26, height = 14): HTMLElement {
  const box = document.createElement("span");
  box.className = "swatch";
  box.style.width = `${width}px`;
  box.style.height = `${height}px`;
  const bands = colorsOf(value);
  if (bands) {
    box.style.background =
      bands.length === 1
        ? bands[0]!
        : `linear-gradient(90deg, ${bands
            .map((c, i) => `${c} ${(i * 100) / bands.length}%, ${c} ${((i + 1) * 100) / bands.length}%`)
            .join(", ")})`;
  } else {
    box.classList.add("swatch--empty");
  }
  return box;
}

interface PickerOptions {
  /** element to hand focus back to on close */
  anchor?: HTMLElement | null;
  value: string;
  onPick: (value: string) => void;
}

let openPicker: HTMLElement | null = null;

export function closeColorPicker(): void {
  openPicker?.remove();
  openPicker = null;
}

/**
 * Opens the palette in the centre of the screen.
 *
 * It is not anchored to the cell: tables can sit anywhere on the sheet at any
 * scale, and a window that jumps from one corner to another has to be hunted
 * for every time. In the centre it is always where you expect it.
 */
export function openColorPicker({ anchor, value, onPick }: PickerOptions): void {
  closeColorPicker();

  const current = splitWireColor(value);
  let base: WireColor | null = current.base ?? null;
  let trace: WireColor | null = current.trace ?? null;

  const panel = document.createElement("div");
  panel.className = "picker";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", t("color.picker.title"));

  const preview = document.createElement("div");
  preview.className = "picker__preview";

  const renderPreview = (): void => {
    preview.replaceChildren();
    const text = compose(base, trace) || t("color.picker.empty");
    preview.appendChild(swatch(compose(base, trace), 34, 16));
    const label = document.createElement("span");
    label.textContent = text;
    preview.appendChild(label);
  };

  const section = (
    labelKey: string,
    selected: () => WireColor | null,
    pick: (c: WireColor | null) => void,
    withNone: boolean,
  ): HTMLElement => {
    const wrap = document.createElement("div");
    const title = document.createElement("div");
    title.className = "picker__label";
    title.textContent = t(labelKey);
    wrap.appendChild(title);

    const grid = document.createElement("div");
    grid.className = "picker__grid";

    const cell = (color: WireColor | null): HTMLButtonElement => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "picker__cell";
      const label = color ? wireColorLabel(color) : t("color.picker.none");
      // data-tip and not title: the native tooltip is slow, cannot be styled
      // and never appears on touch, which is where this palette is used most
      setTip(b, label);
      b.setAttribute("aria-label", label);
      if (color) {
        b.appendChild(swatch(color.it, 22, 14));
        const code = document.createElement("span");
        code.className = "picker__code";
        code.textContent = color.code;
        b.appendChild(code);
      } else {
        b.textContent = "—";
      }
      if (selected() === color) b.classList.add("is-active");
      b.addEventListener("click", () => {
        pick(color);
        for (const other of grid.querySelectorAll(".picker__cell")) other.classList.remove("is-active");
        b.classList.add("is-active");
        renderPreview();
        onPick(compose(base, trace));
      });
      return b;
    };

    if (withNone) grid.appendChild(cell(null));
    for (const color of WIRE_PALETTE) grid.appendChild(cell(color));
    wrap.appendChild(grid);
    return wrap;
  };

  panel.appendChild(preview);
  renderPreview();
  panel.appendChild(
    section(
      "color.picker.base",
      () => base,
      (c) => {
        base = c;
        if (!c) trace = null;
      },
      true,
    ),
  );
  panel.appendChild(
    section(
      "color.picker.trace",
      () => trace,
      (c) => {
        trace = c;
      },
      true,
    ),
  );

  // free field: for non-standard codes and for documents already written
  const freeWrap = document.createElement("div");
  freeWrap.className = "picker__free";
  const freeLabel = document.createElement("label");
  freeLabel.className = "picker__label";
  freeLabel.textContent = t("color.picker.free");
  const freeInput = document.createElement("input");
  freeInput.type = "text";
  freeInput.value = value;
  freeInput.addEventListener("input", () => {
    const parsed = splitWireColor(freeInput.value);
    base = parsed.base ?? null;
    trace = parsed.trace ?? null;
    renderPreview();
    onPick(freeInput.value);
  });
  freeLabel.appendChild(freeInput);
  freeWrap.appendChild(freeLabel);
  panel.appendChild(freeWrap);

  const done = document.createElement("button");
  done.type = "button";
  done.className = "btn btn--primary btn--small picker__done";
  done.textContent = t("dialog.ok");
  done.addEventListener("click", () => {
    closeColorPicker();
    anchor?.focus();
  });
  panel.appendChild(done);

  // backdrop that centres the palette and catches clicks outside it
  const backdrop = document.createElement("div");
  backdrop.className = "backdrop backdrop--soft";
  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);
  openPicker = backdrop;

  const cleanup = (): void => {
    window.removeEventListener("keydown", onKeyDown, true);
    closeColorPicker();
    anchor?.focus();
  };
  const onKeyDown = (ev: KeyboardEvent): void => {
    if (ev.key === "Escape") {
      ev.stopPropagation();
      cleanup();
    }
  };
  backdrop.addEventListener("pointerdown", (ev) => {
    if (ev.target === backdrop) cleanup();
  });
  window.addEventListener("keydown", onKeyDown, true);

  panel.querySelector<HTMLElement>(".picker__cell")?.focus();
}

/**
 * Any colour at all, through the one the operating system already provides.
 *
 * The palette above is for wires, where a colour is a name from a fixed list
 * and often two of them; a label is not a wire and takes a single free colour,
 * so what it needs is a colour picker and not a wire palette. The browser has
 * one built in, it works offline and it costs no dependency, which is the
 * standing rule here.
 *
 * The control itself is never seen: it exists to be opened. It goes as soon as
 * a colour is chosen, and if the picker is dismissed instead it goes on the way
 * back — a cancelled pick fires nothing, so waiting for one would leave it in
 * the page for good.
 */
export function pickFreeColor(current: string, onPick: (hex: string) => void): void {
  const input = document.createElement("input");
  input.type = "color";
  input.value = /^#[0-9a-f]{6}$/i.test(current.trim()) ? current.trim() : "#e8942a";
  input.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;opacity:0;pointer-events:none";
  document.body.appendChild(input);

  let done = false;
  const finish = (): void => {
    if (done) return;
    done = true;
    window.removeEventListener("focus", onReturn);
    input.remove();
  };
  const onReturn = (): void => {
    // the picker has closed one way or the other; a chosen colour has already
    // been reported by then, so anything left here is a dismissal
    window.setTimeout(finish, 300);
  };

  input.addEventListener("change", () => {
    onPick(input.value);
    finish();
  });
  window.addEventListener("focus", onReturn);
  input.click();
}
