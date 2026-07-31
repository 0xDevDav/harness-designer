/**
 * Example plugin: "metraggi" (branch lengths).
 *
 * It totals branch lengths grouped by covering (conduit, sleeve, tape…) and
 * writes the result as a table on the sheet; it also adds a validation rule
 * that flags branches with no usable length.
 *
 * The file is plain JavaScript with no imports: the application loads it with a
 * dynamic `import()`, so everything it needs arrives through the `api` object.
 *
 * Example plugin: total branch length grouped by covering, plus a validation
 * rule for branches whose length cannot be read.
 */

const ID = "metraggi";

/* ============================ dizionari ============================ */

const MESSAGES = {
  it: {
    "plugin.metraggi.command": "Metraggio per copertura",
    "plugin.metraggi.table.title": "Metraggi per copertura",
    "plugin.metraggi.head.covering": "Copertura",
    "plugin.metraggi.head.branches": "Rami",
    "plugin.metraggi.head.mm": "Lunghezza (mm)",
    "plugin.metraggi.head.m": "Lunghezza (m)",
    "plugin.metraggi.covering.none": "Senza copertura",
    "plugin.metraggi.row.total": "Totale",
    "plugin.metraggi.row.unmeasured": "Rami senza lunghezza",
    "plugin.metraggi.toast.done": "Metraggi aggiornati: {branches} rami, {meters} m",
    "plugin.metraggi.toast.empty": "Nessun ramo con una lunghezza interpretabile",
    "plugin.metraggi.issue.noLength": "Ramo {branch}: lunghezza mancante o non interpretabile",
  },
  en: {
    "plugin.metraggi.command": "Length report by covering",
    "plugin.metraggi.table.title": "Lengths by covering",
    "plugin.metraggi.head.covering": "Covering",
    "plugin.metraggi.head.branches": "Branches",
    "plugin.metraggi.head.mm": "Length (mm)",
    "plugin.metraggi.head.m": "Length (m)",
    "plugin.metraggi.covering.none": "No covering",
    "plugin.metraggi.row.total": "Total",
    "plugin.metraggi.row.unmeasured": "Branches without length",
    "plugin.metraggi.toast.done": "Lengths updated: {branches} branches, {meters} m",
    "plugin.metraggi.toast.empty": "No branch has a readable length",
    "plugin.metraggi.issue.noLength": "Branch {branch}: missing or unreadable length",
  },
};

/* ============================ lunghezze ============================ */

/** Conversion factors to the millimetre, the drawing's unit. */
const UNITS = {
  "": 1, // valore nudo: il disegno è quotato in millimetri
  mm: 1,
  millimetro: 1,
  millimetri: 1,
  millimeter: 1,
  millimeters: 1,
  cm: 10,
  centimetro: 10,
  centimetri: 10,
  centimeter: 10,
  centimeters: 10,
  dm: 100,
  m: 1000,
  metro: 1000,
  metri: 1000,
  meter: 1000,
  meters: 1000,
  mt: 1000,
  km: 1000000,
  in: 25.4,
  inch: 25.4,
  inches: 25.4,
  pollice: 25.4,
  pollici: 25.4,
  '"': 25.4,
  ft: 304.8,
  feet: 304.8,
  foot: 304.8,
  piede: 304.8,
  piedi: 304.8,
  "'": 304.8,
  yd: 914.4,
  yard: 914.4,
  yards: 914.4,
};

/**
 * The length field is free text, so the conversion has to accept the forms in
 * use ("600 mm", "1,2 m", "12 ft") and reject everything else quietly, because
 * a note reading "to be defined" is not a typo waiting to be corrected.
 * Returns millimetres, or null when the value is not a measurement.
 */
function parseLengthMm(value) {
  if (typeof value !== "string") return null;
  const raw = value.trim().toLowerCase().replace(/\s+/g, " ");
  if (!raw) return null;
  const m = /^([0-9]+(?:[.,][0-9]+)?)\s*([a-z"'µ]*)\.?$/.exec(raw);
  if (!m) return null;
  const amount = Number(m[1].replace(",", "."));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const factor = UNITS[m[2]];
  return factor === undefined ? null : amount * factor;
}

/* ============================ coperture ============================ */

/**
 * The covering is not a field of the model: it is written as an inline label on
 * the branch ("COR ø13", "GUAINA", "NASTRO"). So the labels naming a protection
 * are recognized and the rest, fuses and circuit codes, are ignored.
 */
const COVERING_RE =
  /(?:^|[\s.\-_/])(cor|corrugat\w*|guain\w*|sleev\w*|nastr\w*|tape|tub\w*|conduit|calz\w*|braid|termo\w*|shrink|spiral\w*)\b/i;

function coveringOf(doc, segment, t) {
  // the label is kept as written, since symbols like "ø" do not survive a case
  // change; uniqueness is judged case-insensitively
  const byKey = new Map();
  for (const i of doc.inlines) {
    if (i.seg !== segment.id || !COVERING_RE.test(String(i.text))) continue;
    const label = String(i.text).trim().replace(/\s+/g, " ");
    const key = label.toLowerCase();
    if (!byKey.has(key)) byKey.set(key, label);
  }
  if (!byKey.size) return t("plugin.metraggi.covering.none");
  return [...byKey.keys()]
    .sort()
    .map((k) => byKey.get(k))
    .join(" + ");
}

/** Readable label of a branch, for the check messages. */
function branchLabel(doc, segment) {
  const name = (id) => {
    const node = doc.nodes.find((n) => n.id === id);
    const label = node ? node.name.trim() : "";
    return label || (node ? `${Math.round(node.x)},${Math.round(node.y)}` : "?");
  };
  return `${name(segment.a)} → ${name(segment.b)}`;
}

/* ============================ riepilogo ============================ */

const formatMm = (mm) => String(Math.round(mm));
const formatM = (mm) => (mm / 1000).toFixed(2);

/** Groups branches by covering; the longest groups come first. */
function summarize(doc, t) {
  const groups = new Map();
  let unmeasured = 0;

  for (const segment of doc.segments) {
    const mm = parseLengthMm(segment.len);
    if (mm === null) {
      unmeasured++;
      continue;
    }
    const key = coveringOf(doc, segment, t);
    const group = groups.get(key) ?? { covering: key, branches: 0, mm: 0 };
    group.branches++;
    group.mm += mm;
    groups.set(key, group);
  }

  const rows = [...groups.values()].sort((a, b) => b.mm - a.mm);
  const totalMm = rows.reduce((sum, g) => sum + g.mm, 0);
  const totalBranches = rows.reduce((sum, g) => sum + g.branches, 0);
  return { rows, totalMm, totalBranches, unmeasured };
}

function buildTableRows(summary, t) {
  const rows = summary.rows.map((g) => [g.covering, String(g.branches), formatMm(g.mm), formatM(g.mm)]);
  if (summary.unmeasured > 0) {
    rows.push([t("plugin.metraggi.row.unmeasured"), String(summary.unmeasured), "", ""]);
  }
  rows.push([
    t("plugin.metraggi.row.total"),
    String(summary.totalBranches),
    formatMm(summary.totalMm),
    formatM(summary.totalMm),
  ]);
  return rows;
}

/* ============================ plugin ============================ */

export default {
  id: ID,
  name: "Metraggi",
  version: "1.0.0",
  author: "Harness Designer",
  description:
    "Metraggio dei rami raggruppato per copertura, con verifica dei rami privi di lunghezza. / Branch length report grouped by covering, plus a check for branches without length.",

  activate(api) {
    // After deactivation a contribution can still be in the user's hands, say a
    // menu entry already on screen: the guard prevents late edits.
    let disposed = false;
    api.onDispose(() => {
      disposed = true;
    });

    api.i18n.add("it", MESSAGES.it);
    api.i18n.add("en", MESSAGES.en);

    api.commands.register({
      id: "metraggi.report",
      titleKey: "plugin.metraggi.command",
      run(app) {
        if (disposed) return;
        const t = api.t;
        const doc = api.getDoc();
        const summary = summarize(doc, t);
        if (!summary.rows.length) {
          api.ui.toast(t("plugin.metraggi.toast.empty"));
          return;
        }

        const head = [
          t("plugin.metraggi.head.covering"),
          t("plugin.metraggi.head.branches"),
          t("plugin.metraggi.head.mm"),
          t("plugin.metraggi.head.m"),
        ];
        const rows = buildTableRows(summary, t);

        // There is only one lengths table: it is recognized by its own id and
        // rewritten on every run, so repeating the command piles up nothing.
        const savedId = api.storage.get("tableId", "");
        const existing =
          doc.tables.find((tb) => tb.id === savedId) ??
          doc.tables.find((tb) => tb.kind === "table" && tb.id.startsWith("t-metraggi"));
        const id = existing ? existing.id : `t-metraggi-${Date.now().toString(36)}`;

        const box = app.renderer.contentBBox();
        const snap = (v) => Math.round(v / 10) * 10;
        const x = existing ? existing.x : snap(box.x + box.w + 40);
        const y = existing ? existing.y : snap(box.y);

        api.edit((d) => {
          const table = d.tables.find((tb) => tb.id === id);
          if (table) {
            table.title = t("plugin.metraggi.table.title");
            table.head = head;
            table.rows = rows;
          } else {
            d.tables.push({ id, x, y, kind: "table", title: t("plugin.metraggi.table.title"), head, rows });
          }
        }, "metraggi.report");

        api.storage.set("tableId", id);
        api.select({ type: "table", id });
        api.ui.toast(
          t("plugin.metraggi.toast.done", {
            branches: summary.totalBranches,
            meters: formatM(summary.totalMm),
          }),
        );
      },
    });

    api.validation.addRule({
      id: "metraggi.missing-length",
      run(ctx) {
        const issues = [];
        for (const segment of ctx.doc.segments) {
          if (parseLengthMm(segment.len) !== null) continue;
          issues.push({
            rule: "metraggi.missing-length",
            severity: "warning",
            message: ctx.t("plugin.metraggi.issue.noLength", { branch: branchLabel(ctx.doc, segment) }),
            target: { type: "segment", id: segment.id },
          });
        }
        return issues;
      },
    });
  },
};
