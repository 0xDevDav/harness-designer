/**
 * Keyboard shortcuts: a single window listener that turns an event into a
 * command. All the logic lives in the commands; what stays here are the rules
 * of engagement, namely never intercept typing in a field and never steal a
 * combination from the browser when the modifiers do not match.
 */
import type { AppContext } from "@/app/context";
import { closeMenu, isMenuOpen } from "@/ui/menu";
import { isDialogOpen } from "@/ui/dialogs";

/** While typing in a field the keyboard belongs to the field, not the sheet. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "OPTION") return true;
  return target.isContentEditable;
}

export function attachKeyboard(app: AppContext): () => void {
  const onKeyDown = (ev: KeyboardEvent): void => {
    if (ev.defaultPrevented || isTypingTarget(ev.target)) return;
    // a modal dialog owns the keyboard: it handles Esc and Enter itself
    if (isDialogOpen()) return;

    if (ev.key === "Escape") {
      if (isMenuOpen()) {
        closeMenu();
        ev.preventDefault();
        return;
      }
      // while a branch is being drawn, leaving is up to the sheet interaction
      if (app.store.tool === "branch") return;
      if (app.store.selection) {
        app.store.select(null);
        ev.preventDefault();
      }
      return;
    }

    const command = app.commands.matchShortcut(ev);
    // an unavailable command (undo with no history, delete with no selection)
    // should not take the combination away from the browser either
    if (!command || command.enabled?.(app) === false) return;
    // the combination is ours, so the browser must not also do its own thing
    ev.preventDefault();
    app.commands.run(command.id);
  };

  window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
}
