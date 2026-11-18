import type { AppContext } from "@/app/context";
import { setColorExempt } from "@/core/exempt";
import { validateDoc } from "@/core/validate";
import type { Issue } from "@/core/types";
import { openColorPicker, swatch } from "./colorpicker";

function smallButton(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "btn btn--small btn--outline";
  b.textContent = label;
  b.addEventListener("click", (ev) => {
    ev.stopPropagation();
    onClick();
  });
  return b;
}

/** Puts a colour on the list or takes it off, and checks the drawing again. */
function exempt(app: AppContext, color: string, on: boolean): void {
  app.store.edit((doc) => setColorExempt(doc, color, on), "exempt-colors");
  app.showReport(validateDoc(app.store.doc, app.t));
}

/**
 * The colours the drawing leaves out of the two-ends rule. It sits under the
 * report, where the error it switches off is read, and stays there when the
 * report is clean, so a colour put on the list can be taken off again.
 */
function renderExempt(app: AppContext, host: HTMLElement): void {
  const { t } = app;
  const box = document.createElement("div");
  box.className = "exempt";

  const title = document.createElement("div");
  title.className = "field__label";
  title.textContent = t("validate.exempt.title");
  const intro = document.createElement("p");
  intro.className = "small muted";
  intro.textContent = t("validate.exempt.intro");
  box.append(title, intro);

  const list = document.createElement("div");
  list.className = "stack";
  const colors = app.store.doc.exemptColors ?? [];
  if (!colors.length) {
    const none = document.createElement("span");
    none.className = "small muted";
    none.textContent = t("validate.exempt.none");
    list.append(none);
  }
  for (const color of colors) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "btn btn--small btn--outline exempt__chip";
    chip.title = t("validate.exempt.remove", { color });
    chip.setAttribute("aria-label", t("validate.exempt.remove", { color }));
    chip.append(swatch(color, 22, 11), document.createTextNode(`${color} ×`));
    chip.addEventListener("click", () => exempt(app, color, false));
    list.append(chip);
  }
  const add = smallButton(t("validate.exempt.add"), () =>
    openColorPicker({ anchor: add, value: "", onPick: (color) => color && exempt(app, color, true) }),
  );
  list.append(add);
  box.append(list);
  host.appendChild(box);
}

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
    renderExempt(app, host);
    return;
  }

  for (const issue of issues) {
    const row = document.createElement("div");
    row.className = "issue" + (issue.severity === "warning" ? " issue--warning" : "");
    // the message is the control that goes to the element, and the buttons sit
    // beside it and not inside, or a screen reader reads them as one
    const text = document.createElement("div");
    text.textContent = (issue.severity === "warning" ? "▲ " : "⚠ ") + issue.message;
    row.append(text);
    const target = issue.target;
    if (target) {
      text.tabIndex = 0;
      text.setAttribute("role", "button");
      const go = (): void => {
        app.store.select(target);
        const box = app.renderer.entityBBox(target);
        if (box) app.renderer.centerOn(box);
        // selecting used to send the sidebar back to the properties; here the
        // list has to stay put so the next problem is one click away
        app.showReport(issues);
      };
      // the whole box takes the click, the buttons in it stop their own
      row.addEventListener("click", go);
      text.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          go();
        }
      });
    }
    const color = issue.rule === "wire-ends" ? issue.color : undefined;
    if (color) {
      const actions = document.createElement("div");
      actions.className = "stack";
      actions.append(smallButton(t("validate.exempt.this", { color }), () => exempt(app, color, true)));
      row.append(actions);
    }
    host.appendChild(row);
  }

  const footer = document.createElement("div");
  footer.className = "small";
  footer.textContent =
    issues.length === 1 ? t("validate.countOne") : t("validate.count", { n: issues.length });
  host.appendChild(footer);
  renderExempt(app, host);
}
