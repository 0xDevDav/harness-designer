/**
 * Export (SVG, PNG, CSV) and print.
 *
 * The picture of the drawing always comes from `renderer.renderToString()`: a
 * self-contained SVG in a neutral view, so the export does not depend on zoom,
 * pan or selection.
 */
import type { AppContext, Exporter } from "@/app/context";
import { wireListHeadings } from "@/core/factories";
import { wireRowsWithLength } from "@/core/routing";
import { wireListCsv } from "@/core/wirelist";
import { documentFileName, downloadBlob } from "@/io/file";

/** The PNG comes out at twice the drawing size, so it stays readable zoomed in. */
const PNG_SCALE = 2;

/** Cautious limit on a canvas side; past it browsers hand back an empty image. */
const MAX_CANVAS_SIDE = 16384;

/** How long the print iframe may live if the browser never fires `afterprint`. */
const PRINT_CLEANUP_MS = 60_000;

/* ---------------- SVG ---------------- */

export function exportSvgFile(app: AppContext): void {
  const blob = new Blob([withXmlProlog(app.renderer.renderToString())], {
    type: "image/svg+xml;charset=utf-8",
  });
  downloadBlob(blob, documentFileName(app.doc, "svg"));
  app.toast.show(app.t("toast.exported"));
}

/* ---------------- PNG ---------------- */

export async function exportPngFile(app: AppContext): Promise<void> {
  const svg = withXmlProlog(app.renderer.renderToString());
  const box = app.renderer.contentBBox();
  const scale = Math.min(PNG_SCALE, MAX_CANVAS_SIDE / Math.max(box.w, box.h, 1));
  const width = Math.max(1, Math.round(box.w * scale));
  const height = Math.max(1, Math.round(box.h * scale));

  /** Draws the SVG onto a canvas and returns the PNG. */
  const render = async (url: string): Promise<Blob> => {
    const image = await loadImage(url);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d context unavailable");

    // White background: the PNG carries no transparency, or prints and dark
    // renderebbero illeggibili i tratti neri.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);
    return canvasToBlob(canvas);
  };

  // A blob URL rather than a data URI: large drawings would blow past the
  // address length some browsers impose. Opening the program from disk under
  // `file://`, though, that blob taints the canvas and the PNG can no longer be
  // read, so there it falls back to the data URI, which raises no origin
  // question because it is part of the document.
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    let blob: Blob;
    try {
      blob = await render(url);
    } catch {
      blob = await render(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
    }
    downloadBlob(blob, documentFileName(app.doc, "png"));
    app.toast.show(app.t("toast.exported"));
  } catch {
    app.toast.error(app.t("toast.exportFailed"));
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("svg image load failed"));
    image.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("canvas encoding failed"));
    }, "image/png");
  });
}

/* ---------------- wire list ---------------- */

export function exportWireCsv(app: AppContext): void {
  const rows = wireRowsWithLength(app.doc);
  if (rows.length === 0) {
    app.toast.error(app.t("wirelist.empty"));
    return;
  }
  const csv = wireListCsv(rows, wireListHeadings(app.t));
  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), documentFileName(app.doc, "csv"));
  app.toast.show(app.t("toast.exported"));
}

/* ---------------- print ---------------- */

/**
 * Prints the whole drawing laid out on the sheet, not the on-screen view: a
 * separate document is built with the SVG at page width and printed from
 * there. If the iframe cannot be used it falls back to printing the page,
 * fitting the view first so the drawing does not come out cropped.
 */
export function printDrawing(app: AppContext): void {
  const svg = app.renderer.renderToString();
  const box = app.renderer.contentBBox();
  const title = app.doc.meta.title.trim() || app.t("app.name");
  const page = printDocument(svg, escapeHtml(title), app.locale, box.w > box.h);

  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  // Off-screen but with real dimensions: zero-area iframes
  // producono stampe vuote in alcuni browser.
  frame.style.cssText = "position:fixed;left:-10000px;top:0;width:1024px;height:768px;border:0;";

  let settled = false;
  const cleanup = (): void => {
    frame.remove();
  };
  const fallback = (): void => {
    if (settled) return;
    settled = true;
    cleanup();
    printCurrentView(app);
  };

  frame.addEventListener("load", () => {
    const win = frame.contentWindow;
    if (!win) {
      fallback();
      return;
    }
    try {
      settled = true;
      // Removing it straight away would cancel the print, so it waits for
      // `afterprint`, with a time limit for browsers that never fire it.
      win.addEventListener("afterprint", () => window.setTimeout(cleanup, 0));
      window.setTimeout(cleanup, PRINT_CLEANUP_MS);
      win.focus();
      win.print();
    } catch {
      settled = false;
      fallback();
    }
  });

  try {
    frame.srcdoc = page;
    document.body.appendChild(frame);
  } catch {
    fallback();
  }
}

/** Fallback: fit the view to the content and print the application page. */
function printCurrentView(app: AppContext): void {
  app.renderer.fitView();
  app.renderer.redrawNow();
  app.toast.show(app.t("toast.printFallback"));
  window.print();
}

function printDocument(svg: string, title: string, locale: string, landscape: boolean): string {
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><title>${title}</title>
<style>
@page { size: A4 ${landscape ? "landscape" : "portrait"}; margin: 12mm; }
html, body { margin: 0; padding: 0; background: #fff; }
svg { display: block; width: 100%; height: auto; max-width: 100%; }
</style></head><body>${svg}</body></html>`;
}

/* ---------------- list for the menu ---------------- */

export function builtinExporters(): Exporter[] {
  return [
    { id: "export.svg", labelKey: "export.svg", run: (app) => exportSvgFile(app) },
    { id: "export.png", labelKey: "export.png", run: (app) => exportPngFile(app) },
    { id: "export.csv", labelKey: "export.csv", run: (app) => exportWireCsv(app) },
    { id: "export.print", labelKey: "export.print", run: (app) => printDrawing(app) },
  ];
}

/* ---------------- utilità ---------------- */

/** States the encoding: without the prolog some viewers read the SVG as Latin-1. */
function withXmlProlog(svg: string): string {
  return svg.startsWith("<?xml") ? svg : `<?xml version="1.0" encoding="UTF-8"?>\n${svg}`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
