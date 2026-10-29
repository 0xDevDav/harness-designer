import { describe, expect, it } from "vitest";
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
