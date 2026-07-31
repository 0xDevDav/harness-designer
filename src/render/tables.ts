import { tableColumns } from "@/core/doc";
import { colorsOf } from "@/core/colors";
import type { DocMeta, Table } from "@/core/types";
import type { Translate } from "@/i18n";
import { el, ellipsize, text, textWidth } from "./svg";
import { palette } from "./palette";

/** Row height and text size of the tables. */
export const ROW_H = 17;
export const FONT = 11;
const MIN_COL = 30;
const MAX_COL = 360;

/**
 * Index of the column holding wire colours. Swatches are drawn only there: a
 * cell reading "rosso" in a prose column stays prose.
 */
function colorColumn(t: Table): number | undefined {
  return tableColumns(t).color;
}

export function tableColumnWidths(t: Table): number[] {
  const columns = Math.max(t.head?.length ?? 0, ...t.rows.map((r) => r.length), 1);
  const colorCol = colorColumn(t);
  const widths: number[] = [];

  for (let c = 0; c < columns; c++) {
    const heading = t.head?.[c];
    let width = heading ? textWidth(heading, FONT, true) + 14 : MIN_COL;
    for (const row of t.rows) {
      const value = row[c] ?? "";
      const bands = c === colorCol ? colorsOf(value) : null;
      width = Math.max(width, bands ? Math.max(34, bands.length * 13 + 8) : textWidth(value, FONT) + 14);
    }
    widths.push(Math.max(MIN_COL, Math.min(MAX_COL, width)));
  }
  return widths;
}

export function titleBlockLayout(
  meta: DocMeta,
  t: Translate,
): { X1: number; X2: number; W: number; H: number } {
  const X1 = Math.max(
    250,
    textWidth(meta.title || "-", 13, true) + 18,
    textWidth(meta.description, 10.5) + 18,
    textWidth(t("meta.description"), 7.5) + 18,
  );
  const middle = Math.max(
    130,
    textWidth(meta.partNumber || "-", 11, true) + 16,
    textWidth(meta.revision, 11, true) + 16,
    textWidth(`${meta.drawnBy}  ${meta.date}`, 10) + 16,
    textWidth(t("meta.drawnByDate"), 7.5) + 16,
  );
  const right = Math.max(120, textWidth(meta.company, 13, true) + 28);
  return { X1, X2: X1 + middle, W: X1 + middle + right, H: ROW_H * 4 };
}

export function tableSize(table: Table, meta: DocMeta, t: Translate): { w: number; h: number } {
  if (table.kind === "title") {
    const layout = titleBlockLayout(meta, t);
    return { w: layout.W, h: layout.H };
  }
  const w = tableColumnWidths(table).reduce((a, b) => a + b, 0);
  const rows = (table.title ? 1 : 0) + (table.head?.length ? 1 : 0) + table.rows.length;
  return { w, h: ROW_H * rows };
}

export function drawTable(
  table: Table,
  meta: DocMeta,
  t: Translate,
  parent: Element,
  /** rows to highlight in red: same colour across more than two connectors */
  errorRows?: ReadonlySet<number>,
): void {
  const g = el(
    "g",
    {
      transform: `translate(${table.x},${table.y})`,
      "data-ent": "table",
      "data-id": table.id,
      style: "cursor:move",
    },
    parent,
  );
  if (table.kind === "title") {
    drawTitleBlock(meta, t, g);
    return;
  }

  const widths = tableColumnWidths(table);
  const W = widths.reduce((a, b) => a + b, 0);
  const { h: H } = tableSize(table, meta, t);
  const colorCol = colorColumn(table);
  let y = 0;

  el(
    "rect",
    {
      x: 0,
      y: 0,
      width: W,
      height: H,
      fill: palette().bundleInner,
      stroke: palette().tableBorder,
      "stroke-width": 1.2,
    },
    g,
  );

  if (table.title) {
    el(
      "rect",
      {
        x: 0,
        y: 0,
        width: W,
        height: ROW_H,
        fill: palette().tableTitleBg,
        stroke: palette().tableBorder,
        "stroke-width": 1,
      },
      g,
    );
    // an isolated table takes no part in automatic linking, and the sheet should say so
    const isolated = table.autoLink === false;
    text(
      W / 2,
      ROW_H - 5,
      ellipsize(table.title, FONT + 1, W - (isolated ? 26 : 10), true),
      {
        "font-size": FONT + 1,
        "font-weight": 700,
        "text-anchor": "middle",
        fill: palette().text,
      },
      g,
    );
    if (isolated) {
      text(
        W - 6,
        ROW_H - 5,
        "⊘",
        {
          "font-size": FONT + 1,
          "text-anchor": "end",
          fill: palette().textDim,
        },
        g,
      ).setAttribute("title", t("props.table.autoLinkOff"));
    }
    y += ROW_H;
  }

  if (table.head?.length) {
    el(
      "rect",
      {
        x: 0,
        y,
        width: W,
        height: ROW_H,
        fill: palette().tableHeadBg,
        stroke: palette().tableBorder,
        "stroke-width": 0.8,
      },
      g,
    );
    let x = 0;
    table.head.forEach((heading, c) => {
      const w = widths[c] ?? MIN_COL;
      text(
        x + 5,
        y + ROW_H - 5,
        ellipsize(heading, FONT, w - 9, true),
        {
          "font-size": FONT,
          "font-weight": 600,
          fill: palette().text,
        },
        g,
      );
      x += w;
    });
    y += ROW_H;
  }

  const cellHits: { x: number; y: number; w: number; r: number; c: number }[] = [];

  table.rows.forEach((row, rowIndex) => {
    let x = 0;
    // same colour across more than two connectors: the row has to stand out
    const inError = errorRows?.has(rowIndex) ?? false;
    if (inError) {
      el("rect", { x: 0, y, width: W, height: ROW_H, fill: palette().errorFill }, g);
    }
    for (let c = 0; c < widths.length; c++) {
      cellHits.push({ x, y, w: widths[c] ?? MIN_COL, r: rowIndex, c });
      const w = widths[c] ?? MIN_COL;
      const value = row[c] ?? "";
      const bands = c === colorCol ? colorsOf(value) : null;
      if (bands) {
        const x0 = x + 4;
        const y0 = y + 3.5;
        const w0 = w - 8;
        const h0 = ROW_H - 7;
        bands.forEach((color, i) => {
          el(
            "rect",
            { x: x0 + (w0 * i) / bands.length, y: y0, width: w0 / bands.length, height: h0, fill: color },
            g,
          );
        });
        el(
          "rect",
          {
            x: x0,
            y: y0,
            width: w0,
            height: h0,
            fill: "none",
            stroke: inError ? palette().errorStroke : palette().swatchBorder,
            "stroke-width": inError ? 1.6 : 0.8,
          },
          g,
        );
        // No name over the swatch. It only ever fitted on single colours, so
        // the column came out half labelled and half not, and the eye read the
        // difference as meaning something it did not.
      } else if (value !== "") {
        text(
          x + 5,
          y + ROW_H - 5,
          ellipsize(value, FONT, w - 9),
          { "font-size": FONT, fill: palette().text },
          g,
        );
      }
      x += w;
    }
    el("line", { x1: 0, y1: y, x2: W, y2: y, stroke: palette().tableLine, "stroke-width": 0.7 }, g);
    y += ROW_H;
  });

  let x = 0;
  for (let c = 0; c < widths.length - 1; c++) {
    x += widths[c] ?? MIN_COL;
    el(
      "line",
      { x1: x, y1: table.title ? ROW_H : 0, x2: x, y2: y, stroke: palette().tableLine, "stroke-width": 0.7 },
      g,
    );
  }

  // Per-cell hit areas, on top of everything else: they are what lets a cell be
  // edited directly on the sheet. They stay invisible and do not steal the
  // table drag, which still starts from the group.
  for (const hit of cellHits) {
    el(
      "rect",
      {
        x: hit.x,
        y: hit.y,
        width: hit.w,
        height: ROW_H,
        fill: "transparent",
        "data-ent": "table",
        "data-id": table.id,
        "data-row": hit.r,
        "data-col": hit.c,
        style: "cursor:text",
      },
      g,
    );
  }
  // headers: same thing, with row -1 to tell them apart
  if (table.head?.length) {
    const headY = table.title ? ROW_H : 0;
    let hx = 0;
    table.head.forEach((_h, c) => {
      const w = widths[c] ?? MIN_COL;
      el(
        "rect",
        {
          x: hx,
          y: headY,
          width: w,
          height: ROW_H,
          fill: "transparent",
          "data-ent": "table",
          "data-id": table.id,
          "data-row": -1,
          "data-col": c,
          style: "cursor:text",
        },
        g,
      );
      hx += w;
    });
  }
  // title: row -2
  if (table.title) {
    el(
      "rect",
      {
        x: 0,
        y: 0,
        width: W,
        height: ROW_H,
        fill: "transparent",
        "data-ent": "table",
        "data-id": table.id,
        "data-row": -2,
        "data-col": 0,
        style: "cursor:text",
      },
      g,
    );
  }
}

/** Conventional row indices used by the hit areas: title and headers. */
export const TITLE_ROW = -2;
export const HEAD_ROW = -1;

/**
 * The cell sitting under a point of the document.
 *
 * Needed because the sheet is redrawn between the two clicks of a double click:
 * the SVG elements are new objects by then and the event lands on the group
 * instead of the cell. Resolving by geometry does not care about DOM state.
 */
export function cellAt(table: Table, point: { x: number; y: number }): { row: number; col: number } | null {
  if (table.kind === "title") return null;
  const widths = tableColumnWidths(table);
  const W = widths.reduce((a, b) => a + b, 0);
  const local = { x: point.x - table.x, y: point.y - table.y };
  if (local.x < 0 || local.x > W || local.y < 0) return null;

  let col = 0;
  let acc = 0;
  for (let c = 0; c < widths.length; c++) {
    acc += widths[c] ?? 0;
    if (local.x <= acc) {
      col = c;
      break;
    }
    col = c;
  }

  let y = 0;
  if (table.title) {
    if (local.y < ROW_H) return { row: TITLE_ROW, col };
    y += ROW_H;
  }
  if (table.head?.length) {
    if (local.y < y + ROW_H) return { row: HEAD_ROW, col };
    y += ROW_H;
  }
  const row = Math.floor((local.y - y) / ROW_H);
  return row >= 0 && row < table.rows.length ? { row, col } : null;
}

/**
 * Box of a cell in document coordinates, used to place the in-place editor
 * exactly over it.
 */
export function cellRect(
  table: Table,
  row: number,
  col: number,
): { x: number; y: number; w: number; h: number } | null {
  if (table.kind === "title") return null;
  const widths = tableColumnWidths(table);
  const width = widths[col];
  if (width === undefined) return null;

  const W = widths.reduce((a, b) => a + b, 0);
  let x = 0;
  for (let c = 0; c < col; c++) x += widths[c] ?? MIN_COL;

  if (row === TITLE_ROW) return { x: table.x, y: table.y, w: W, h: ROW_H };

  const headOffset = table.title ? ROW_H : 0;
  if (row === HEAD_ROW) return { x: table.x + x, y: table.y + headOffset, w: width, h: ROW_H };

  const bodyOffset = headOffset + (table.head?.length ? ROW_H : 0);
  return { x: table.x + x, y: table.y + bodyOffset + row * ROW_H, w: width, h: ROW_H };
}

export function drawTitleBlock(meta: DocMeta, t: Translate, g: Element): void {
  const { X1, X2, W, H } = titleBlockLayout(meta, t);
  el(
    "rect",
    {
      x: 0,
      y: 0,
      width: W,
      height: H,
      fill: palette().bundleInner,
      stroke: palette().tableBorder,
      "stroke-width": 1.3,
    },
    g,
  );

  // left column: title and description
  el(
    "line",
    { x1: 0, y1: ROW_H * 2, x2: X1, y2: ROW_H * 2, stroke: palette().tableBorder, "stroke-width": 0.8 },
    g,
  );
  el("line", { x1: X1, y1: 0, x2: X1, y2: H, stroke: palette().tableBorder, "stroke-width": 1 }, g);
  text(5, 9, t("meta.title"), { "font-size": 7.5, fill: palette().textDim }, g);
  text(
    8,
    ROW_H * 2 - 7,
    ellipsize(meta.title || "-", 13, X1 - 14, true),
    {
      "font-size": 13,
      "font-weight": 700,
      fill: palette().text,
    },
    g,
  );
  text(5, ROW_H * 2 + 9, t("meta.description"), { "font-size": 7.5, fill: palette().textDim }, g);
  text(
    8,
    ROW_H * 4 - 8,
    ellipsize(meta.description, 10.5, X1 - 14),
    { "font-size": 10.5, fill: palette().text },
    g,
  );

  // middle column: part number, revision, author and date
  const cell = H / 3;
  el("line", { x1: X1, y1: cell, x2: X2, y2: cell, stroke: palette().tableBorder, "stroke-width": 0.8 }, g);
  el(
    "line",
    { x1: X1, y1: cell * 2, x2: X2, y2: cell * 2, stroke: palette().tableBorder, "stroke-width": 0.8 },
    g,
  );
  el("line", { x1: X2, y1: 0, x2: X2, y2: H, stroke: palette().tableBorder, "stroke-width": 1 }, g);
  text(X1 + 4, 8, t("meta.partNumber"), { "font-size": 7.5, fill: palette().textDim }, g);
  text(
    X1 + 7,
    cell - 4,
    meta.partNumber || "-",
    { "font-size": 11, "font-weight": 600, fill: palette().text },
    g,
  );
  text(X1 + 4, cell + 8, t("meta.revision"), { "font-size": 7.5, fill: palette().textDim }, g);
  text(X1 + 7, cell * 2 - 4, meta.revision, { "font-size": 11, "font-weight": 600, fill: palette().text }, g);
  text(X1 + 4, cell * 2 + 8, t("meta.drawnByDate"), { "font-size": 7.5, fill: palette().textDim }, g);
  text(X1 + 7, cell * 3 - 5, `${meta.drawnBy}  ${meta.date}`, { "font-size": 10, fill: palette().text }, g);

  // right column: company
  text(
    (X2 + W) / 2,
    H / 2 + 5,
    meta.company,
    {
      "font-size": 13,
      "font-weight": 800,
      "text-anchor": "middle",
      fill: palette().company,
    },
    g,
  );
}
