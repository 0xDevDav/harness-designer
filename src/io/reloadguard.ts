/**
 * Notices when an undo would put back what a Reload replaced.
 *
 * Reload is one undo step, so Ctrl+Z after it brings back the drawing as it was
 * before the file was read again. If autosave then wrote that drawing, the
 * changes made outside the window, the very ones Reload took, would be gone from
 * the file.
 *
 * It does not compare drawings but counts steps: the position in the history
 * right after the Reload is the floor, and any drawing from below it is one the
 * file must not be given. That holds however it is got to (one Ctrl+Z, two
 * quick ones inside the autosave delay, or Reload, an edit that was saved and
 * two Ctrl+Z) and it holds until the person decides: it is let go only when
 * the file and the screen agree because they said so (opened, saved as, Save
 * confirmed, linked drawing replaced) or another Reload takes its place. An
 * autosave that was written does not let it go.
 */
export class ReloadGuard {
  private floor: number | null = null;

  /**
   * Called after a Reload with the text of the drawing before and after it, and
   * the position in the history it left. When the file said the same as the
   * screen there is nothing to protect.
   */
  arm(before: string, after: string, position: number): void {
    this.floor = before === after ? null : position;
  }

  /** True when the drawing at `position` is one from before the last Reload. */
  wouldRevert(position: number): boolean {
    return this.floor !== null && position < this.floor;
  }

  /** The file and the screen agree again by the person's choice: nothing is left to protect. */
  clear(): void {
    this.floor = null;
  }
}
