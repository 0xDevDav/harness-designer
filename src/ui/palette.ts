/**
 * Command palette (Ctrl+K): a filterable list of everything that can be done.
 *
 * It is the one interface that does not require knowing where a button lives,
 * which is why it also shows each command's shortcut: anyone using it picks up
 * the combinations without looking them up elsewhere.
 */
import type { AppContext, Command } from "@/app/context";

/** The palette currently open; there is at most one. */
let openInstance: { close: () => void; focus: () => void } | null = null;

export function openCommandPalette(app: AppContext): void {
  if (openInstance) {
    openInstance.focus();
    return;
  }

  const t = app.t;
  const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  // A disabled command cannot run, so listing it in the palette would only
  // produce entries that ignore the click.
  const available = app.commands.all().filter((c) => c.palette !== false && (c.enabled?.(app) ?? true));

  const backdrop = document.createElement("div");
  backdrop.className = "backdrop";

  const panel = document.createElement("div");
  panel.className = "palette";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", t("topbar.commands"));

  const input = document.createElement("input");
  input.className = "palette__input";
  input.type = "text";
  input.placeholder = t("palette.placeholder");
  input.setAttribute("aria-label", t("palette.placeholder"));
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "true");
  input.autocomplete = "off";
  input.spellcheck = false;

  const list = document.createElement("div");
  list.className = "palette__list";
  list.id = "palette-list";
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", t("topbar.commands"));
  input.setAttribute("aria-controls", list.id);

  panel.append(input, list);
  backdrop.append(panel);

  let matches: Command[] = [];
  let active = 0;

  const render = (): void => {
    const query = input.value.trim().toLowerCase();
    const terms = query ? query.split(/\s+/) : [];
    matches = available.filter((c) => {
      const label = t(c.titleKey).toLowerCase();
      return terms.every((term) => label.includes(term));
    });
    active = Math.min(Math.max(active, 0), Math.max(matches.length - 1, 0));

    list.textContent = "";
    if (matches.length === 0) {
      const empty = document.createElement("div");
      empty.className = "palette__hint";
      empty.textContent = t("palette.empty");
      list.append(empty);
      input.removeAttribute("aria-activedescendant");
      return;
    }

    matches.forEach((command, index) => {
      const item = document.createElement("div");
      item.className = index === active ? "palette__item is-active" : "palette__item";
      item.id = `palette-item-${index}`;
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", String(index === active));

      const label = document.createElement("span");
      label.textContent = t(command.titleKey);
      item.append(label);

      if (command.shortcut) {
        const kbd = document.createElement("kbd");
        kbd.textContent = command.shortcut;
        item.append(kbd);
      }

      item.addEventListener("pointerdown", (ev) => {
        ev.preventDefault(); // il campo di ricerca conserva il fuoco fino alla chiusura
        execute(index);
      });
      item.addEventListener("pointermove", () => {
        if (active === index) return;
        active = index;
        render();
      });

      list.append(item);
    });

    input.setAttribute("aria-activedescendant", `palette-item-${active}`);
    list.children[active]?.scrollIntoView({ block: "nearest" });
  };

  const move = (delta: number): void => {
    if (matches.length === 0) return;
    active = (active + delta + matches.length) % matches.length;
    render();
  };

  const execute = (index: number): void => {
    const command = matches[index];
    if (!command) return;
    close();
    app.commands.run(command.id);
  };

  function close(): void {
    if (openInstance === instance) openInstance = null;
    backdrop.remove();
    previouslyFocused?.focus();
  }

  const onKeyDown = (ev: KeyboardEvent): void => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      close();
    } else if (ev.key === "ArrowDown" || (ev.key === "Tab" && !ev.shiftKey)) {
      ev.preventDefault();
      move(1);
    } else if (ev.key === "ArrowUp" || (ev.key === "Tab" && ev.shiftKey)) {
      ev.preventDefault();
      move(-1);
    } else if (ev.key === "Home") {
      ev.preventDefault();
      active = 0;
      render();
    } else if (ev.key === "End") {
      ev.preventDefault();
      active = matches.length - 1;
      render();
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      execute(active);
    }
  };

  input.addEventListener("input", () => {
    active = 0;
    render();
  });
  backdrop.addEventListener("keydown", onKeyDown);
  backdrop.addEventListener("pointerdown", (ev) => {
    if (ev.target === backdrop) close();
  });

  const instance = { close, focus: () => input.focus() };
  openInstance = instance;

  document.body.append(backdrop);
  render();
  input.focus();
}

/** Closes the palette if open; used when the interface is rebuilt. */
export function closeCommandPalette(): void {
  openInstance?.close();
}
