/**
 * Command bar.
 *
 * It is arranged by **task**, not as a list: the document and what gets
 * inserted on the left, actions on the drawing and the view in the middle, the
 * environment tools on the right (search, plugins, guide, appearance,
 * language). Rarely used entries live in dropdowns; the constant ones stay one
 * click away.
 *
 * The bar holds no application logic: every control invokes a command from the
 * registry, which keeps bar, shortcuts and palette a single thing. It is
 * rebuilt in full only when language, theme or the set of plugins changes; the
 * varying state (undo, grid, number of problems) updates in place.
 */
import type { AppContext } from "@/app/context";
import { validateDoc } from "@/core/validate";
import { LOCALES, LOCALE_NAMES, getLocale, setLocale } from "@/i18n";
import type { Locale } from "@/i18n";
import { closeMenu, openMenu } from "@/ui/menu";
import type { MenuItem } from "@/ui/menu";
import { icon } from "@/ui/icons";
import { THEMES, getTheme, setTheme } from "@/ui/theme";
import type { Theme } from "@/ui/theme";
import { labelWithoutShortcut, setTip } from "@/ui/tooltip";

/** Store-event unsubscribes belonging to the bar currently on screen. */
let disposers: Array<() => void> = [];

interface ButtonOptions {
  label?: string;
  iconName?: string;
  tip: string;
  onClick: (ev: MouseEvent) => void;
  variant?: "primary" | "outline" | "ghost";
  /** the label disappears on narrow screens, the icon stays */
  collapsible?: boolean;
  menu?: boolean;
}

function button(options: ButtonOptions): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "btn" + (options.variant ? ` btn--${options.variant}` : "");
  if (!options.label) el.classList.add("btn--icon");
  // the tooltip is the only label an icon-only button has
  setTip(el, options.tip);
  // the drawer prints this instead of the icon alone; the shortcut is dropped
  // because a phone has no keyboard to press it on
  el.dataset["label"] = labelWithoutShortcut(options.tip);
  el.setAttribute("aria-label", options.label ? `${options.label} · ${options.tip}` : options.tip);

  if (options.iconName) el.appendChild(icon(options.iconName));
  if (options.label) {
    const span = document.createElement("span");
    span.textContent = options.label;
    if (options.collapsible) span.className = "btn__label--optional";
    el.appendChild(span);
  }
  if (options.menu) {
    el.appendChild(icon("chevron", 13));
    el.setAttribute("aria-haspopup", "menu");
  }
  el.addEventListener("click", options.onClick);
  return el;
}

/**
 * A group of controls. `section` is the heading the drawer prints above it: on
 * a wide screen the pill shape is enough to tell the groups apart, but in a
 * single column the eye needs a word.
 */
function group(section: string, ...children: HTMLElement[]): HTMLElement {
  const box = document.createElement("div");
  box.className = "navgroup";
  box.dataset["section"] = section;
  box.append(...children);
  return box;
}

function plainGroup(section: string, ...children: HTMLElement[]): HTMLElement {
  const box = document.createElement("div");
  box.className = "navgroup navgroup--plain";
  box.dataset["section"] = section;
  box.append(...children);
  return box;
}

function spacer(): HTMLElement {
  const el = document.createElement("div");
  el.className = "navspacer";
  return el;
}

/**
 * Name above, tagline below. On one line the pair pushed the whole bar wide;
 * stacked, the two lines fit inside the height of the mark, so the bar itself
 * does not grow.
 */
function brand(name: string, tagline: string): HTMLElement {
  const box = document.createElement("div");
  box.className = "brand";
  const mark = document.createElement("span");
  mark.className = "brand__mark";
  mark.appendChild(icon("wire", 17));
  const text = document.createElement("div");
  text.className = "brand__text";
  const title = document.createElement("span");
  title.className = "brand__name";
  title.textContent = name;
  const sub = document.createElement("span");
  sub.className = "brand__sub btn__label--optional";
  sub.textContent = tagline;
  text.append(title, sub);
  box.append(mark, text);
  box.dataset["tip"] = `${name} · ${tagline}`;
  return box;
}

/** Opens a menu anchored under the button that asked for it. */
function dropdown(anchor: HTMLElement, items: MenuItem[]): void {
  const box = anchor.getBoundingClientRect();
  openMenu(box.left, box.bottom + 6, items);
}

const run = (app: AppContext, id: string) => (): void => app.commands.run(id);

/**
 * Below the breakpoint the controls move into a drawer instead of being crammed
 * into one row. The markup is the same in both cases: only the container
 * changes shape, so nothing has to be built twice.
 */
function createDrawer(t: AppContext["t"]): {
  nav: HTMLElement;
  burger: HTMLButtonElement;
  backdrop: HTMLElement;
  dispose: () => void;
} {
  const nav = document.createElement("div");
  nav.className = "topbar__nav";
  nav.id = "topbar-nav";
  // inert only matters while the drawer exists as a drawer; on a wide screen the
  // media query never turns it into one and the attribute is cleared at startup
  if (window.innerWidth <= 860) nav.setAttribute("inert", "");

  // Header of the drawer, shown only when it is one. A panel that covers the
  // screen has to say what it is and offer a way out that is not a guess.
  const head = document.createElement("div");
  head.className = "navhead";
  const headTitle = document.createElement("span");
  headTitle.className = "navhead__title";
  headTitle.textContent = t("topbar.menu");
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "btn btn--icon navhead__close";
  closeBtn.setAttribute("aria-label", t("topbar.menu.close"));
  closeBtn.appendChild(icon("close"));
  head.append(headTitle, closeBtn);
  nav.append(head);

  const backdrop = document.createElement("div");
  backdrop.className = "nav-veil";
  backdrop.hidden = true;

  const burger = document.createElement("button");
  burger.type = "button";
  burger.className = "btn btn--icon topbar__burger";
  burger.setAttribute("aria-controls", nav.id);
  burger.setAttribute("aria-expanded", "false");
  burger.setAttribute("aria-label", t("topbar.menu"));
  setTip(burger, t("topbar.menu"));
  burger.appendChild(icon("menu"));

  const setOpen = (open: boolean): void => {
    nav.classList.toggle("is-open", open);
    backdrop.hidden = !open;
    burger.setAttribute("aria-expanded", String(open));
    // `inert` and not `visibility: hidden`: a closed drawer has to be out of the
    // tab order, but hiding it that way would also refuse the focus we hand it
    // on opening, since the transition is still running on this frame
    if (open) nav.removeAttribute("inert");
    else nav.setAttribute("inert", "");
    // the first real command, not the close button: the drawer was opened to
    // reach a command, and landing on the way out would be a small insult
    if (open) nav.querySelector<HTMLElement>(".navgroup button")?.focus();
  };
  const close = (): void => {
    if (nav.classList.contains("is-open")) {
      setOpen(false);
      burger.focus();
    }
  };

  burger.addEventListener("click", () => setOpen(!nav.classList.contains("is-open")));
  backdrop.addEventListener("click", close);
  closeBtn.addEventListener("click", close);
  // choosing a command is the end of the errand the drawer was opened for
  nav.addEventListener("click", (ev) => {
    if ((ev.target as HTMLElement).closest("button")) close();
  });

  const onKeyDown = (ev: KeyboardEvent): void => {
    if (ev.key === "Escape") close();
  };
  // back on a wide screen the drawer has no meaning: it must not stay latched,
  // and its controls have to be reachable again as an ordinary row
  const onResize = (): void => {
    if (window.innerWidth > 860) {
      nav.classList.remove("is-open");
      backdrop.hidden = true;
      burger.setAttribute("aria-expanded", "false");
      nav.removeAttribute("inert");
    } else if (!nav.classList.contains("is-open")) {
      nav.setAttribute("inert", "");
    }
  };
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("resize", onResize);

  return {
    nav,
    burger,
    backdrop,
    dispose: () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onResize);
    },
  };
}

export function renderTopbar(app: AppContext, host: HTMLElement): void {
  closeMenu();
  for (const off of disposers) off();
  disposers = [];
  host.replaceChildren();

  const { t, store } = app;

  const drawer = createDrawer(t);
  disposers.push(drawer.dispose);
  host.append(brand(t("app.name"), t("app.tagline")), drawer.burger, drawer.nav, drawer.backdrop);

  // every control goes into the drawer container: on a wide screen it is simply
  // the row of the bar, on a narrow one it slides in from the side
  const nav = drawer.nav;

  // A spacer on each side of the command groups, so on a wide screen they sit
  // in the middle between the brand and the environment tools instead of
  // trailing off to the left. Both are hidden inside the drawer.
  nav.append(spacer());

  /* ---------------- document ---------------- */

  const fileMenu = (ev: MouseEvent): void => {
    const items: MenuItem[] = [
      { label: t("topbar.new"), run: run(app, "doc.new") },
      { label: t("topbar.open"), shortcut: "Ctrl+O", run: run(app, "doc.open") },
      { label: t("topbar.sample"), run: run(app, "doc.sample") },
      { separator: true },
      { header: t("topbar.export") },
      { label: t("export.svg"), run: run(app, "export.svg") },
      { label: t("export.png"), run: run(app, "export.png") },
      { label: t("export.csv"), run: run(app, "export.csv") },
      { label: t("export.print"), run: run(app, "export.print") },
    ];
    // exporters added by plugins
    for (const exporter of app.exporters) {
      if (/^export\.(svg|png|csv|print|json)$/.test(exporter.id)) continue;
      items.push({ label: t(exporter.labelKey), run: () => void exporter.run(app) });
    }
    dropdown(ev.currentTarget as HTMLElement, items);
  };

  nav.append(
    group(
      t("topbar.section.document"),
      button({
        label: t("topbar.file"),
        iconName: "file",
        tip: t("topbar.file.tip"),
        onClick: fileMenu,
        menu: true,
        collapsible: true,
      }),
      button({
        label: t("topbar.save"),
        iconName: "save",
        tip: `${t("topbar.save")} (Ctrl+S)`,
        onClick: run(app, "doc.save"),
        variant: "primary",
        collapsible: true,
      }),
    ),
  );

  /* ---------------- inserting and drawing ---------------- */

  const insertMenu = (ev: MouseEvent): void =>
    dropdown(ev.currentTarget as HTMLElement, [
      { label: t("insert.cavity"), run: run(app, "insert.cavity") },
      { label: t("insert.notes"), run: run(app, "insert.notes") },
      { label: t("insert.revisions"), run: run(app, "insert.revisions") },
      { label: t("insert.wirelist"), run: run(app, "insert.wirelist") },
      { separator: true },
      { label: t("insert.titleblock"), run: run(app, "insert.titleblock") },
    ]);

  nav.append(
    group(
      t("topbar.section.draw"),
      button({
        label: t("topbar.insert"),
        iconName: "plus",
        tip: t("topbar.insert.tip"),
        onClick: insertMenu,
        menu: true,
        collapsible: true,
      }),
      button({
        label: t("topbar.branch"),
        iconName: "branch",
        tip: `${t("topbar.branch")} (B)`,
        onClick: run(app, "tool.branch"),
        collapsible: true,
      }),
    ),
  );

  /* ---------------- editing ---------------- */

  const undo = button({ iconName: "undo", tip: t("topbar.undo.tip"), onClick: run(app, "edit.undo") });
  const redo = button({ iconName: "redo", tip: t("topbar.redo.tip"), onClick: run(app, "edit.redo") });
  nav.append(group(t("topbar.section.edit"), undo, redo));

  /* ---------------- harness check ---------------- */

  const checkButton = button({
    label: t("topbar.check"),
    iconName: "check",
    tip: t("topbar.check.tip"),
    onClick: run(app, "doc.check"),
    collapsible: true,
  });
  const checkBadge = document.createElement("span");
  checkBadge.className = "badge badge--muted";
  // The content is a glyph or a digit: on its own it says nothing to someone
  // who cannot see the screen. The button label states the whole thing.
  checkBadge.setAttribute("aria-hidden", "true");
  checkButton.appendChild(checkBadge);

  nav.append(
    group(
      t("topbar.section.check"),
      checkButton,
      button({ iconName: "link", tip: t("cmd.autoLinkAll"), onClick: run(app, "doc.autolink") }),
    ),
  );

  /* ---------------- view ---------------- */

  const snap = document.createElement("button");
  snap.type = "button";
  snap.className = "switch";
  setTip(snap, `${t("topbar.snap")} · ${t("topbar.snap.tip")}`);
  const track = document.createElement("span");
  track.className = "switch__track";
  const snapLabel = document.createElement("span");
  snapLabel.className = "btn__label--optional";
  snapLabel.textContent = t("topbar.snap");
  snap.append(track, snapLabel);
  snap.addEventListener("click", run(app, "view.snap"));

  nav.append(
    group(
      t("topbar.section.view"),
      button({ iconName: "zoomOut", tip: `${t("cmd.zoomOut")} (-)`, onClick: run(app, "view.zoomOut") }),
      button({ iconName: "fit", tip: `${t("topbar.fit")} (F)`, onClick: run(app, "view.fit") }),
      button({ iconName: "zoomIn", tip: `${t("cmd.zoomIn")} (+)`, onClick: run(app, "view.zoomIn") }),
      snap,
    ),
  );

  nav.append(spacer());

  /* ---------------- ambiente ---------------- */

  const themeMenu = (ev: MouseEvent): void => {
    const labels: Record<Theme, string> = {
      auto: t("theme.auto"),
      light: t("theme.light"),
      dark: t("theme.dark"),
    };
    dropdown(
      ev.currentTarget as HTMLElement,
      THEMES.map((value) => ({
        label: (getTheme() === value ? "● " : "○ ") + labels[value],
        run: () => {
          setTheme(value);
          app.refreshUi();
        },
      })),
    );
  };

  const languageMenu = (ev: MouseEvent): void =>
    dropdown(
      ev.currentTarget as HTMLElement,
      LOCALES.map((value: Locale) => ({
        label: (getLocale() === value ? "● " : "○ ") + LOCALE_NAMES[value],
        run: () => {
          setLocale(value);
          app.refreshUi();
        },
      })),
    );

  const themeIcon = getTheme() === "light" ? "sun" : getTheme() === "dark" ? "moon" : "auto";

  nav.append(
    plainGroup(
      t("topbar.section.tools"),
      button({
        iconName: "search",
        tip: `${t("topbar.commands")} (Ctrl+K)`,
        onClick: run(app, "app.palette"),
      }),
      button({ iconName: "plugin", tip: t("topbar.plugins.tip"), onClick: run(app, "app.plugins") }),
      button({ iconName: "help", tip: `${t("cmd.guide")} (F1)`, onClick: run(app, "app.guide") }),
      button({ iconName: themeIcon, tip: t("theme.tip"), onClick: themeMenu }),
      button({ iconName: "language", tip: t("topbar.language.tip"), onClick: languageMenu }),
    ),
  );

  /* ---------------- state updated without rebuilding the bar ---------------- */

  const syncEdit = (): void => {
    undo.disabled = !store.canUndo;
    redo.disabled = !store.canRedo;
  };
  const syncSnap = (): void => {
    snap.classList.toggle("is-on", store.snapEnabled);
    snap.setAttribute("aria-pressed", String(store.snapEnabled));
  };
  /** The problem counter is the drawing's health light. */
  const syncCheck = (): void => {
    const issues = validateDoc(store.doc, t);
    const errors = issues.filter((i) => i.severity === "error").length;
    checkBadge.textContent = issues.length === 0 ? "✓" : String(issues.length);
    checkBadge.className = "badge" + (errors > 0 ? "" : issues.length ? " badge--muted" : " badge--ok");
    const state = issues.length ? t("topbar.check.count", { n: issues.length }) : t("topbar.check.none");
    setTip(checkButton, state);
    checkButton.setAttribute("aria-label", state);
  };

  syncEdit();
  syncSnap();
  syncCheck();

  // the count costs a full scan of the tables, so it refreshes once a burst of
  // edits settles rather than on every keystroke
  let pending: number | undefined;
  disposers.push(
    store.on("doc", () => {
      syncEdit();
      window.clearTimeout(pending);
      pending = window.setTimeout(syncCheck, 400);
    }),
    store.on("settings", syncSnap),
    store.on("load", syncCheck),
  );
}
