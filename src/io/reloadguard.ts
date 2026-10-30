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
 * two Ctrl+Z).
 *
 * It must be asked about after every change to the history, not only when a
 * write is due: an edit made after the undo brings the position back up to the
 * floor while the drawing is still the one from before the Reload. So the
 * first time the position is seen below the floor the guard trips and stays
 * tripped, however the position moves afterwards, until the person decides: it
 * is let go only when the file and the screen agree because they said so
 * (opened, saved as, Save confirmed, linked drawing replaced) or another Reload
 * takes its place. An autosave that was written does not let it go.
 */
export class ReloadGuard {
  private floor: number | null = null;
  private tripped = false;

  /**
   * Called after a Reload with the text of the drawing before and after it, and
   * the position in the history it left. When the file said the same as the
   * screen there is nothing to protect.
   */
  arm(before: string, after: string, position: number): void {
    this.floor = before === after ? null : position;
    this.tripped = false;
  }

  /**
   * True when the drawing at `position` is, or has been since the Reload, one
   * from before it. Asking is also what notices the dip, so it has to be asked
   * at every position the history passes through.
   */
  wouldRevert(position: number): boolean {
    if (this.floor !== null && position < this.floor) this.tripped = true;
    return this.tripped;
  }

  /** The file and the screen agree again by the person's choice: nothing is left to protect. */
  clear(): void {
    this.floor = null;
    this.tripped = false;
  }
}
