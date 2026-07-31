import type { AppContext } from "@/app/context";
import { validateDoc } from "@/core/validate";
import type { Issue } from "@/core/types";

/**
 * Check report in its floating panel. Every entry is clickable and brings the
 * offending element to the centre of the view.
 */
export function renderReport(app: AppContext, host: HTMLElement, precomputed?: Issue[]): void {
  const { t } = app;
  const issues = precomputed ?? validateDoc(app.store.doc, t);
  host.replaceChildren();

  // the title is already in the panel header, so only the outcome goes here
  if (!issues.length) {
    const ok = document.createElement("div");
    ok.className = "ok";
    ok.textContent = t("validate.ok");
    host.appendChild(ok);
    return;
  }

  for (const issue of issues) {
    const row = document.createElement("div");
    row.className = "issue" + (issue.severity === "warning" ? " issue--warning" : "");
    row.textContent = (issue.severity === "warning" ? "▲ " : "⚠ ") + issue.message;
    const target = issue.target;
    if (target) {
      row.tabIndex = 0;
      row.setAttribute("role", "button");
      const go = (): void => {
        app.store.select(target);
        const box = app.renderer.entityBBox(target);
        if (box) app.renderer.centerOn(box);
        // selecting used to send the sidebar back to the properties; here the
        // list has to stay put so the next problem is one click away
        app.showReport(issues);
      };
      row.addEventListener("click", go);
      row.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          go();
        }
      });
    }
    host.appendChild(row);
  }

  const footer = document.createElement("div");
  footer.className = "small";
  footer.textContent =
    issues.length === 1 ? t("validate.countOne") : t("validate.count", { n: issues.length });
  host.appendChild(footer);
}
