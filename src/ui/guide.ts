import type { AppContext } from "@/app/context";

/**
 * Quick guide, now that there is no sidebar to hold it.
 * It lists the gestures that replaced the old properties panel.
 */
const LINES = [
  "guide.doubleClick",
  "guide.rightClick",
  "guide.tab",
  "guide.branch",
  "guide.drag",
  "guide.copy",
  "guide.keys",
  "guide.views",
] as const;

export function renderGuide(app: AppContext, host: HTMLElement): void {
  const list = document.createElement("div");
  list.className = "guide";
  for (const key of LINES) {
    const row = document.createElement("p");
    // the guide strings contain <b> to pick out the keys: they are translation
    // texts, not user data
    row.innerHTML = app.t(key);
    list.appendChild(row);
  }
  host.appendChild(list);
}
