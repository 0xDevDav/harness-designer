export const SVGNS = "http://www.w3.org/2000/svg";

export type Attrs = Record<string, string | number>;

/** Creates an SVG element with the given attributes and appends it to a parent. */
export function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  parent?: Element,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVGNS, tag);
  for (const k in attrs) node.setAttribute(k, String(attrs[k]));
  parent?.appendChild(node);
  return node;
}

/** SVG text. The content goes through `textContent`, so no markup is parsed. */
export function text(
  x: number,
  y: number,
  content: string,
  attrs: Attrs = {},
  parent?: Element,
): SVGTextElement {
  const node = el("text", { x, y, "font-family": FONT_STACK, ...attrs }, parent);
  node.textContent = content;
  return node;
}

export const FONT_STACK = "Segoe UI, Roboto, Helvetica, Arial, sans-serif";

/* ---------------- text measurement ---------------- */

const cache = new Map<string, number>();
const CACHE_LIMIT = 4000;
let ctx: CanvasRenderingContext2D | null | undefined;

function measurer(): CanvasRenderingContext2D | null {
  if (ctx === undefined) {
    ctx = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
  }
  return ctx;
}

/**
 * Width of a string in pixels. Outside the browser, meaning in the tests, it
 * falls back to a proportional estimate, good enough for layout maths.
 */
export function textWidth(value: unknown, fontSize: number, bold = false): number {
  const str = String(value ?? "");
  if (!str) return 0;
  const key = `${bold ? "b" : ""}${fontSize}|${str}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const c = measurer();
  let width: number;
  if (c) {
    c.font = `${bold ? "600 " : ""}${fontSize}px ${FONT_STACK}`;
    width = c.measureText(str).width;
  } else {
    width = str.length * fontSize * 0.54;
  }

  if (cache.size > CACHE_LIMIT) cache.clear();
  cache.set(key, width);
  return width;
}

/** Shortens a text to fit the given width, adding an ellipsis. */
export function ellipsize(value: string, fontSize: number, maxWidth: number, bold = false): string {
  if (textWidth(value, fontSize, bold) <= maxWidth) return value;
  let lo = 0;
  let hi = value.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (textWidth(value.slice(0, mid) + "…", fontSize, bold) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? value.slice(0, lo) + "…" : "";
}
