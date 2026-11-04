import { describe, expect, it, vi } from "vitest";
import type { AppContext } from "@/app/context";
import { normalizeDoc } from "@/core/doc";
import { t } from "@/i18n";
import { schematicMenuItems } from "@/ui/contextmenu";

const app = (): AppContext =>
  ({
    t,
    doc: normalizeDoc({
      nodes: [
        { id: "c", x: 0, y: 0, kind: "connector", name: "C1" },
        { id: "s", x: 100, y: 0, kind: "connector", name: "S1", style: "splice" },
      ],
    }),
  }) as unknown as AppContext;

const labelOf = (target: Parameters<typeof schematicMenuItems>[1]): string | undefined => {
  const item = schematicMenuItems(app(), target)[1];
  return item && "label" in item ? item.label : undefined;
};

describe("the menu of a box in the schematic", () => {
  it("deletes a connector, and a splice that is on the sheet", () => {
    expect(labelOf({ kind: "box", name: "C1", nodeId: "c" })).toBe(t("menu.deleteConnector"));
    expect(labelOf({ kind: "box", name: "S1", nodeId: "s" })).toBe(t("menu.deleteSplice"));
  });

  it("calls a bare name a splice, unless it has a cavity table", () => {
    expect(labelOf({ kind: "box", name: "S9" })).toBe(t("menu.deleteSplice"));
    expect(labelOf({ kind: "box", name: "C9", hasTable: true })).toBe(t("menu.deleteConnector"));
  });
});

describe("the question before deleting from the schematic", () => {
  /** An app with a wire from A.1 to the splice S1, and a dialog that records what it was asked. */
  const asked = (
    target: Parameters<typeof schematicMenuItems>[1],
    wired = true,
  ): { title: string; body: string } => {
    const confirm = vi.fn(() => Promise.resolve(false));
    const doc = normalizeDoc({
      nodes: [
        { id: "a", x: 0, y: 0, kind: "connector", name: "A" },
        { id: "s", x: 100, y: 0, kind: "connector", name: "S1", style: "splice" },
      ],
      tables: wired
        ? [{ id: "ta", node: "a", x: 0, y: 0, kind: "table", head: ["Cavity", "To"], rows: [["1", "S1"]] }]
        : [],
    });
    const app = { t, doc, dialogs: { confirm } } as unknown as AppContext;
    const item = schematicMenuItems(app, target)[1];
    // the question is put synchronously: the dialog is called before the first await
    if (item && "run" in item) item.run();
    const options = (confirm.mock.calls[0] as unknown as [{ title: string; body: string }])[0];
    return { title: options.title, body: options.body };
  };

  it("does not say a splice goes with its table, since it has none", () => {
    const { body } = asked({ kind: "box", name: "S1", nodeId: "s" }, false);
    expect(body).toBe(t("dialog.deleteConnector.bodyNoTable", { name: "S1" }));
    expect(body).not.toBe(t("dialog.deleteConnector.body", { name: "S1" }));
  });

  it("says so for one wire and for several, still without a table", () => {
    const one = asked({ kind: "box", name: "S1", nodeId: "s" });
    expect(one.body).toBe(t("dialog.deleteConnector.bodyNoTableWire", { name: "S1" }));
    expect(one.body).not.toBe(t("dialog.deleteConnector.bodyWire", { name: "S1" }));
  });

  it("still says a connector goes with its table", () => {
    const { body } = asked({ kind: "box", name: "A", nodeId: "a", hasTable: true }, false);
    expect(body).toBe(t("dialog.deleteConnector.body", { name: "A" }));
    expect(body).not.toBe(t("dialog.deleteConnector.bodyNoTable", { name: "A" }));
  });
});
