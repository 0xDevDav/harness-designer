/**
 * Example plugin: "connettore-tondo" (round connector).
 *
 * It adds the "round" symbol, a DIN-style circular connector, listed with the
 * housings so that a connector whose housing is the DIN one is drawn with it,
 * and the DIN 47002 colour codes used on German-market drawings.
 *
 * Example plugin: a round (DIN-style) connector symbol for the housing table,
 * and the DIN 47002 wire-colour abbreviations.
 */

const ID = "connettore-tondo";

/** Style identifier: it ends up in `node.style`, and so in the .json file. */
const STYLE_ID = "round";

const SVGNS = "http://www.w3.org/2000/svg";

const MESSAGES = {
  it: {
    "plugin.connettore-tondo.style": "Connettore tondo (DIN)",
  },
  en: {
    "plugin.connettore-tondo.style": "Round connector (DIN)",
  },
};

/**
 * DIN 47002 codes. The tints match those of the names already known, so a
 * swatch written "ge/sw" and one written "giallo/nero" stay identical.
 */
const DIN_COLORS = {
  sw: "#111111", // schwarz
  rt: "#c62828", // rot
  ge: "#e6c700", // gelb
  gn: "#2e9e3f", // grün
  bl: "#1d4fd7", // blau
  br: "#7a4b22", // braun
  ws: "#ffffff", // weiß
  gr: "#9e9e9e", // grau
};

/* ============================ drawing ============================ */

function el(tag, attrs, parent) {
  const node = document.createElementNS(SVGNS, tag);
  for (const key of Object.keys(attrs)) node.setAttribute(key, String(attrs[key]));
  parent.appendChild(node);
  return node;
}

/** Body centre and outer radius; the nose (`tip`) follows from these. */
const CX = -24;
const R = 14;

/**
 * The group handed in is already rotated so the wire enters from the right,
 * with the origin on the node, so the symbol extends towards negative x.
 */
function drawRound(g) {
  // stretch of wire up to the collar
  el("line", { x1: CX + R - 2, y1: 0, x2: 2, y2: 0, stroke: "#8f9aa8", "stroke-width": 4 }, g);
  // ghiera esterna zigrinata
  el("circle", { cx: CX, cy: 0, r: R, fill: "#c9d2dc", stroke: "#5b6773", "stroke-width": 1.3 }, g);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    el(
      "line",
      {
        x1: CX + Math.cos(a) * (R - 2.6),
        y1: Math.sin(a) * (R - 2.6),
        x2: CX + Math.cos(a) * R,
        y2: Math.sin(a) * R,
        stroke: "#5b6773",
        "stroke-width": 0.8,
      },
      g,
    );
  }
  // inner insulator and the orientation key at the top
  el("circle", { cx: CX, cy: 0, r: 9.5, fill: "#eef2f6", stroke: "#5b6773", "stroke-width": 1 }, g);
  el("rect", { x: CX - 1.6, y: -9.5, width: 3.2, height: 3.4, fill: "#5b6773" }, g);
  // contacts: one in the middle and four around the ring
  el("circle", { cx: CX, cy: 0, r: 1.9, fill: "#5b6773" }, g);
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i / 4) * Math.PI * 2;
    el("circle", { cx: CX + Math.cos(a) * 5.6, cy: Math.sin(a) * 5.6, r: 1.9, fill: "#5b6773" }, g);
  }
}

/* ============================ plugin ============================ */

export default {
  id: ID,
  name: "Connettore tondo (DIN)",
  version: "1.0.0",
  author: "Harness Designer",
  description:
    "Simbolo di connettore circolare per la tabella degli alloggiamenti e sigle colore DIN 47002. / Round connector symbol for the housing table and DIN 47002 colour codes.",

  activate(api) {
    api.i18n.add("it", MESSAGES.it);
    api.i18n.add("en", MESSAGES.en);

    api.symbols.registerConnector({
      id: STYLE_ID,
      labelKey: "plugin.connettore-tondo.style",
      role: "housing", // listed with the housings, next to the multi-pin plug
      tip: -CX + R, // distanza dall'origine al bordo esterno della ghiera
      draw: drawRound,
    });

    for (const [name, hex] of Object.entries(DIN_COLORS)) api.colors.registerName(name, hex);
  },
};
