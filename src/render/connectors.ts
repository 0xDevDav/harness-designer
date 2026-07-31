import { el } from "./svg";

/**
 * Termination symbol. Drawing happens inside a group already rotated so that
 * the wire comes in from the right, which means the symbol extends towards
 * negative x, with the origin on the node.
 */
export interface ConnectorSymbol {
  id: string;
  /** i18n key of the name shown in the menus */
  labelKey: string;
  /** distance from the origin to the nose, used to place the node label */
  tip: number;
  draw(group: SVGGElement): void;
  /** hidden symbols stay drawable but do not appear in the menus */
  hidden?: boolean;
}

const symbols = new Map<string, ConnectorSymbol>();

export function registerConnectorSymbol(symbol: ConnectorSymbol): () => void {
  symbols.set(symbol.id, symbol);
  return () => symbols.delete(symbol.id);
}

export const connectorSymbols = (): ConnectorSymbol[] => [...symbols.values()];
export const visibleConnectorSymbols = (): ConnectorSymbol[] =>
  [...symbols.values()].filter((s) => !s.hidden);

export function connectorSymbol(id: string): ConnectorSymbol | undefined {
  return symbols.get(id);
}

/* ---------------- built-in symbols ---------------- */

registerConnectorSymbol({
  id: "plug",
  labelKey: "style.plug",
  tip: 40,
  draw(g) {
    el(
      "rect",
      {
        x: -30,
        y: -9,
        width: 26,
        height: 18,
        rx: 2.5,
        fill: "#c9d2dc",
        stroke: "#5b6773",
        "stroke-width": 1.3,
      },
      g,
    );
    el(
      "rect",
      { x: -38, y: -6, width: 8, height: 12, rx: 1.5, fill: "#8f9aa8", stroke: "#5b6773", "stroke-width": 1 },
      g,
    );
    el("line", { x1: -4, y1: 0, x2: 2, y2: 0, stroke: "#8f9aa8", "stroke-width": 4 }, g);
  },
});

registerConnectorSymbol({
  id: "ring",
  labelKey: "style.ring",
  tip: 31,
  draw(g) {
    el(
      "rect",
      { x: -14, y: -3.5, width: 12, height: 7, fill: "#c9a05a", stroke: "#7a5c22", "stroke-width": 1 },
      g,
    );
    el("circle", { cx: -21, cy: 0, r: 8, fill: "#d9c08a", stroke: "#7a5c22", "stroke-width": 1.3 }, g);
    el("circle", { cx: -21, cy: 0, r: 3.4, fill: "#f4f6f9", stroke: "#7a5c22", "stroke-width": 1 }, g);
  },
});

registerConnectorSymbol({
  id: "faston",
  labelKey: "style.faston",
  tip: 26,
  draw(g) {
    el(
      "rect",
      {
        x: -24,
        y: -5,
        width: 14,
        height: 10,
        rx: 1.5,
        fill: "#c9d2dc",
        stroke: "#5b6773",
        "stroke-width": 1.2,
      },
      g,
    );
    el(
      "rect",
      { x: -10, y: -3.5, width: 9, height: 7, fill: "#8f9aa8", stroke: "#5b6773", "stroke-width": 1 },
      g,
    );
    el("line", { x1: -21, y1: 0, x2: -13, y2: 0, stroke: "#5b6773", "stroke-width": 1 }, g);
  },
});

registerConnectorSymbol({
  id: "pin",
  labelKey: "style.pin",
  tip: 26,
  draw(g) {
    el(
      "rect",
      { x: -16, y: -3, width: 12, height: 6, fill: "#b9c2cc", stroke: "#5b6773", "stroke-width": 1 },
      g,
    );
    el("line", { x1: -24, y1: 0, x2: -16, y2: 0, stroke: "#5b6773", "stroke-width": 2.5 }, g);
  },
});

registerConnectorSymbol({
  id: "splice",
  labelKey: "style.splice",
  tip: 33,
  draw(g) {
    // amber heat-shrink sleeve with the crimp band in the middle
    el(
      "rect",
      {
        x: -31,
        y: -5.5,
        width: 26,
        height: 11,
        rx: 5,
        fill: "#f2c46a",
        stroke: "#a5761f",
        "stroke-width": 1.3,
      },
      g,
    );
    el(
      "rect",
      { x: -24, y: -4, width: 12, height: 8, fill: "#b9c2cc", stroke: "#5b6773", "stroke-width": 1 },
      g,
    );
    el("line", { x1: -6, y1: 0, x2: 2, y2: 0, stroke: "#8f9aa8", "stroke-width": 4 }, g);
  },
});

registerConnectorSymbol({
  id: "none",
  labelKey: "style.none",
  tip: 8,
  draw() {
    /* estremità libera: nessun simbolo */
  },
});
