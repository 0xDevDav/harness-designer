/**
 * The application's modal windows: confirm, ask for text, notify.
 *
 * They replace the native `confirm()`/`prompt()`/`alert()`: they block the page
 * just as those do, but they return a Promise, can be translated and stay
 * inside the application theme. Focus is trapped in the window while it is open
 * and goes back to where it came from on close. Without that, anyone using a
 * keyboard or a screen reader would end up navigating the page underneath.
 */
import type { ConfirmOptions, DialogsApi, PromptOptions } from "@/app/context";
import type { Translate } from "@/i18n";

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "a[href]",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/** Counter for the ids used by aria-labelledby and aria-describedby. */
let idSeed = 0;

interface DialogConfig<T> {
  title: string;
  confirmLabel: string;
  /** absent means a notice-only window, with the confirm button on its own */
  cancelLabel?: string;
  danger?: boolean;
  /** fills the body and returns the element to focus when it opens */
  fillBody(body: HTMLElement): HTMLElement | null;
  confirmValue(): T;
  cancelValue(): T;
}

function focusableInside(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.hasAttribute("hidden") && el.tabIndex >= 0,
  );
}

let openDialogs = 0;

/**
 * True while a modal window is open. The keyboard shortcuts consult it: with
 * focus on a confirm button, pressing "B" or Delete must not act on the
 * drawing behind.
 */
export const isDialogOpen = (): boolean => openDialogs > 0;

function openDialog<T>(config: DialogConfig<T>): Promise<T> {
  return new Promise<T>((resolve) => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const seq = ++idSeed;
    openDialogs++;

    const backdrop = document.createElement("div");
    backdrop.className = "backdrop";

    const dialog = document.createElement("div");
    dialog.className = "dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", `dialog-title-${seq}`);

    const title = document.createElement("h3");
    title.className = "dialog__title";
    title.id = `dialog-title-${seq}`;
    title.textContent = config.title;

    const body = document.createElement("div");
    body.className = "dialog__body";
    body.id = `dialog-body-${seq}`;
    const initialFocus = config.fillBody(body);
    // The body describes the window only when it is prose: if it holds a
    // field, that field's label is already the useful part and repeating it is
    // just noise.
    if (!initialFocus && (body.textContent ?? "").trim() !== "") {
      dialog.setAttribute("aria-describedby", body.id);
    }

    const actions = document.createElement("div");
    actions.className = "dialog__actions";

    let closed = false;
    const close = (value: T): void => {
      if (closed) return;
      closed = true;
      openDialogs = Math.max(0, openDialogs - 1);
      backdrop.remove();
      if (previous && previous.isConnected) previous.focus();
      resolve(value);
    };

    if (config.cancelLabel !== undefined) {
      const cancelButton = document.createElement("button");
      cancelButton.type = "button";
      cancelButton.className = "btn";
      cancelButton.textContent = config.cancelLabel;
      cancelButton.addEventListener("click", () => close(config.cancelValue()));
      actions.append(cancelButton);
    }

    const confirmButton = document.createElement("button");
    confirmButton.type = "button";
    confirmButton.className = config.danger ? "btn btn--danger" : "btn btn--primary";
    confirmButton.textContent = config.confirmLabel;
    confirmButton.addEventListener("click", () => close(config.confirmValue()));
    actions.append(confirmButton);

    dialog.addEventListener("keydown", (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        ev.stopPropagation();
        close(config.cancelValue());
        return;
      }
      if (ev.key === "Enter" && !ev.altKey && !ev.ctrlKey && !ev.metaKey) {
        // On a button Enter already activates it, so intercepting would confirm
        // even when focus is on cancel.
        const target = ev.target;
        if (target instanceof HTMLButtonElement || target instanceof HTMLTextAreaElement) return;
        ev.preventDefault();
        close(config.confirmValue());
        return;
      }
      if (ev.key === "Tab") {
        const items = focusableInside(dialog);
        if (items.length === 0) {
          ev.preventDefault();
          return;
        }
        const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const at = active ? items.indexOf(active) : -1;
        const last = items.length - 1;
        const index =
          at < 0 ? (ev.shiftKey ? last : 0) : (at + (ev.shiftKey ? -1 : 1) + items.length) % items.length;
        ev.preventDefault();
        items[index]?.focus();
      }
    });

    // Click-outside close, but only when press and release both land on the
    // backdrop; otherwise a drag started in the field would close it.
    let pressedOnBackdrop = false;
    backdrop.addEventListener("pointerdown", (ev: PointerEvent) => {
      pressedOnBackdrop = ev.target === backdrop;
    });
    backdrop.addEventListener("pointerup", (ev: PointerEvent) => {
      const outside = pressedOnBackdrop && ev.target === backdrop;
      pressedOnBackdrop = false;
      if (outside) close(config.cancelValue());
    });

    dialog.append(title, body, actions);
    backdrop.append(dialog);
    document.body.append(backdrop);

    const toFocus = initialFocus ?? confirmButton;
    toFocus.focus();
    if (toFocus instanceof HTMLInputElement) toFocus.select();
  });
}

export function createDialogs(t: Translate): DialogsApi {
  return {
    confirm(options: ConfirmOptions): Promise<boolean> {
      return openDialog<boolean>({
        title: options.title,
        confirmLabel: options.confirmLabel ?? t("dialog.confirm"),
        cancelLabel: options.cancelLabel ?? t("dialog.cancel"),
        danger: options.danger === true,
        fillBody: (body) => {
          body.textContent = options.body;
          return null;
        },
        confirmValue: () => true,
        cancelValue: () => false,
      });
    },

    prompt(options: PromptOptions): Promise<string | null> {
      let input: HTMLInputElement | null = null;
      return openDialog<string | null>({
        title: options.title,
        confirmLabel: t("dialog.ok"),
        cancelLabel: t("dialog.cancel"),
        fillBody: (body) => {
          const seq = ++idSeed;
          const field = document.createElement("div");
          field.className = "field";
          const label = document.createElement("label");
          label.className = "field__label";
          label.htmlFor = `dialog-input-${seq}`;
          label.textContent = options.label;
          const control = document.createElement("input");
          control.type = "text";
          control.id = `dialog-input-${seq}`;
          control.value = options.value ?? "";
          control.autocomplete = "off";
          if (options.placeholder !== undefined) control.placeholder = options.placeholder;
          field.append(label, control);
          body.append(field);
          input = control;
          return control;
        },
        // The value is not trimmed: spaces can be deliberate in a label.
        confirmValue: () => (input ? input.value : null),
        cancelValue: () => null,
      });
    },

    alert(options: { title: string; body: string }): Promise<void> {
      return openDialog<void>({
        title: options.title,
        confirmLabel: t("dialog.ok"),
        fillBody: (body) => {
          body.textContent = options.body;
          return null;
        },
        confirmValue: () => undefined,
        cancelValue: () => undefined,
      });
    },
  };
}
