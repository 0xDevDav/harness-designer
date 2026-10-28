/**
 * Notices when an undo would put back what a Reload replaced.
 *
 * Reload is one undo step, so Ctrl+Z after it brings back the drawing as it was
 * before the file was read again. If autosave then wrote that drawing, the
 * changes made outside the window, the very ones Reload took, would be gone from
 * the file. The guard remembers the drawing a Reload replaced, and says so when
 * it is about to be written.
 */
export class ReloadGuard {
  private replaced: string | null = null;

  /**
   * Called after a Reload with the text of the drawing before and after it. When
   * the file said the same as the screen there is nothing to protect.
   */
  arm(before: string, after: string): void {
    this.replaced = before === after ? null : before;
  }

  /** True when `text` is the drawing the last Reload replaced. */
  wouldRevert(text: string): boolean {
    return this.replaced !== null && text === this.replaced;
  }

  /** The file and the screen agree again (written, opened, unlinked): nothing is left to protect. */
  clear(): void {
    this.replaced = null;
  }
}
