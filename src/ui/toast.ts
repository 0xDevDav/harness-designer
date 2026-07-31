/**
 * Temporary messages at the bottom of the page.
 *
 * The container (#toasts) is already `aria-live="polite"`, so inserting the
 * text is enough for it to be announced. Messages queue up, disappear on their
 * own and are removed from the DOM, so a run of autosaves does not leave dozens
 * of invisible nodes behind.
 */
import type { ToastApi, ToastOptions } from "@/app/context";

const DEFAULT_DURATION = 3200;
/** Errors stay longer: they are meant to be read, not just glimpsed. */
const ERROR_DURATION = 5200;
/** Past this count the messages cover each other and become unreadable. */
const MAX_VISIBLE = 4;
const FADE_MS = 160;

export function createToasts(host: HTMLElement): ToastApi {
  /** Messages still alive, oldest first. */
  const live: HTMLElement[] = [];
  const timers = new Map<HTMLElement, number>();

  const drop = (el: HTMLElement): void => {
    const index = live.indexOf(el);
    if (index >= 0) live.splice(index, 1);
    const timer = timers.get(el);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timers.delete(el);
    }
  };

  const dismiss = (el: HTMLElement, animate: boolean): void => {
    if (!timers.has(el) && live.indexOf(el) < 0) return;
    drop(el);
    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!animate || reduced || typeof el.animate !== "function") {
      el.remove();
      return;
    }
    const fade = el.animate([{ opacity: 1 }, { opacity: 0, transform: "translateY(6px)" }], {
      duration: FADE_MS,
      easing: "ease-in",
      fill: "forwards",
    });
    fade.addEventListener("finish", () => el.remove());
    fade.addEventListener("cancel", () => el.remove());
  };

  const show = (message: string, options?: ToastOptions): void => {
    if (message === "") return;
    const kind = options?.kind ?? "info";
    const requested = options?.duration;
    const duration =
      requested !== undefined && Number.isFinite(requested) && requested > 0
        ? requested
        : kind === "error"
          ? ERROR_DURATION
          : DEFAULT_DURATION;

    const el = document.createElement("div");
    el.className = kind === "error" ? "toast toast--error" : "toast";
    el.textContent = message;
    host.append(el);
    live.push(el);

    // The oldest make way at once, with no fade: otherwise the stack would sit
    // still for the length of the animation.
    while (live.length > MAX_VISIBLE) {
      const oldest = live[0];
      if (!oldest) break;
      dismiss(oldest, false);
    }

    timers.set(
      el,
      window.setTimeout(() => dismiss(el, true), duration),
    );
  };

  return {
    show,
    error: (message: string): void => show(message, { kind: "error" }),
  };
}
