/**
 * The file on disk the drawing belongs to.
 *
 * A browser tab normally cannot write to a file it opened: saving is a download
 * into some folder, and the drawing lives only in `localStorage`, which belongs
 * to one address and one port. Where the browser offers the File System Access
 * API the tab can hold a handle to the real file instead, and that buys three
 * things at once: every edit can be written back (no "forgot to save"), the file
 * can be read again on demand, and the tab can notice when something else — an
 * editor, a script, an assistant — has changed the file underneath it.
 *
 * Nothing here knows about the document model: it moves text. The caller gives
 * it the serialized drawing and gets text back, which keeps this testable with a
 * handle made of plain objects.
 */

/** What is used of a writable stream: the real one has far more. */
interface WritableLike {
  write(data: string): Promise<void>;
  close(): Promise<void>;
}

/** The part of `FileSystemFileHandle` this module relies on. */
export interface FileHandleLike {
  readonly name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<WritableLike>;
  queryPermission?(descriptor: { mode: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission?(descriptor: { mode: "read" | "readwrite" }): Promise<PermissionState>;
}

interface PickerWindow {
  showOpenFilePicker?: (options?: object) => Promise<FileHandleLike[]>;
  showSaveFilePicker?: (options?: object) => Promise<FileHandleLike>;
}

const JSON_TYPES = [{ description: "Harness drawing", accept: { "application/json": [".json"] } }];

/** How often the file is looked at, besides whenever the window gets focus back. */
const WATCH_MS = 2000;

/** The user closed the picker: not an error, and nothing worth telling them. */
const isCancel = (err: unknown): boolean => err instanceof DOMException && err.name === "AbortError";

const stampOf = (file: File): string => `${file.lastModified}:${file.size}`;

/**
 * The cases a person can be told about in their own language: the caller turns
 * the code into a message, since this module knows no language.
 */
export type DiskFileProblem = "permission" | "no-file";

export class DiskFileError extends Error {
  constructor(readonly problem: DiskFileProblem) {
    super(problem === "permission" ? "write permission was not granted" : "no file is attached");
  }
}

/** Runs a job on its own turn: the caller's queue, so that reads do not overlap writes. */
type Exclusive = <T>(job: () => Promise<T>) => Promise<T>;

export class DiskFile {
  private handle: FileHandleLike | null = null;
  /** modification time and size as of the last time this tab read or wrote the file */
  private stamp = "";
  /** the file's contents as of that same moment */
  private fileText = "";
  /** the drawing as last written or loaded: writing the same thing again is skipped */
  private docText = "";
  private changed = false;
  private canWrite = false;
  private timer: number | undefined;
  private listeners = new Set<() => void>();
  private exclusive: Exclusive = (job) => job();

  /**
   * Makes the reads that nobody asked for at a given moment — the timer, the
   * window getting focus, Reload — wait their turn behind the writes, and so
   * never see the file half written. The caller's write queue goes here.
   */
  serializeWith(run: Exclusive): void {
    this.exclusive = run;
  }

  /** True where the browser can open and save files in place. */
  static supported(): boolean {
    const w = typeof window === "undefined" ? undefined : (window as unknown as PickerWindow);
    return typeof w?.showOpenFilePicker === "function" && typeof w.showSaveFilePicker === "function";
  }

  get attached(): boolean {
    return this.handle !== null;
  }
  get name(): string | null {
    return this.handle?.name ?? null;
  }
  /** Something other than this tab has changed the file since this tab last saw it. */
  get isStale(): boolean {
    return this.changed;
  }
  /** Edits can be written to the file as they are made. */
  get canAutosave(): boolean {
    return this.handle !== null && this.canWrite && !this.changed;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  /* ---------------- attaching ---------------- */

  /** Shows the open dialog. Resolves to the file's text, or null if it was dismissed. */
  async pick(): Promise<string | null> {
    const w = window as unknown as PickerWindow;
    if (!w.showOpenFilePicker) return null;
    let handles: FileHandleLike[];
    try {
      handles = await w.showOpenFilePicker({ types: JSON_TYPES, multiple: false });
    } catch (err) {
      if (isCancel(err)) return null;
      throw err;
    }
    const handle = handles[0];
    return handle ? this.attach(handle) : null;
  }

  /**
   * Shows the save dialog and writes the drawing there. Resolves false if the
   * dialog was dismissed, in which case nothing is attached or written.
   */
  async pickToSave(suggestedName: string, text: string): Promise<boolean> {
    const w = window as unknown as PickerWindow;
    if (!w.showSaveFilePicker) return false;
    let handle: FileHandleLike;
    try {
      handle = await w.showSaveFilePicker({ suggestedName, types: JSON_TYPES });
    } catch (err) {
      if (isCancel(err)) return false;
      throw err;
    }
    this.useHandle(handle, true);
    await this.write(text, true);
    return true;
  }

  /** Attaches a handle and returns what the file holds. */
  async attach(handle: FileHandleLike): Promise<string> {
    this.useHandle(handle, await this.askToWrite(handle));
    return this.readText();
  }

  private useHandle(handle: FileHandleLike, writable: boolean): void {
    this.handle = handle;
    this.canWrite = writable;
    this.changed = false;
    this.stamp = "";
    this.fileText = "";
    this.docText = "";
    this.startWatching();
    this.emit();
  }

  private async askToWrite(handle: FileHandleLike): Promise<boolean> {
    try {
      if ((await handle.queryPermission?.({ mode: "readwrite" })) === "granted") return true;
      return (await handle.requestPermission?.({ mode: "readwrite" })) === "granted";
    } catch {
      return false;
    }
  }

  /** Lets go of the file: the drawing is no longer the file's, and edits stop being written. */
  detach(): void {
    if (!this.handle) return;
    this.handle = null;
    this.canWrite = false;
    this.changed = false;
    window.clearInterval(this.timer);
    this.timer = undefined;
    window.removeEventListener("focus", this.onFocus);
    this.emit();
  }

  /* ---------------- reading ---------------- */

  /** Reads the file again. The tab now has everything the file has. */
  readText(): Promise<string> {
    return this.exclusive(() => this.readNow());
  }

  private async readNow(): Promise<string> {
    const handle = this.requireHandle();
    const file = await handle.getFile();
    const text = await file.text();
    this.stamp = stampOf(file);
    this.fileText = text;
    this.docText = "";
    const wasStale = this.changed;
    this.changed = false;
    if (wasStale) this.emit();
    return text;
  }

  /**
   * Puts the outside-change flag back. For a file that was read and could not be
   * used: reading it cleared the flag, but the tab still does not have its
   * contents, so autosave must not go on to overwrite them.
   */
  flagChanged(): void {
    if (!this.handle || this.changed) return;
    this.changed = true;
    this.emit();
  }

  /**
   * Tells the file that the drawing in the tab is, as it stands, what was read.
   *
   * The tab normalizes what it loads, so its own serialization rarely matches
   * the file byte for byte. Without this the first edit-free save after a load
   * would rewrite a file nobody had changed.
   */
  markLoaded(docText: string): void {
    this.docText = docText;
  }

  /* ---------------- writing ---------------- */

  /**
   * Writes the drawing. Unless `force` is set it refuses to overwrite a file
   * somebody else has changed in the meantime: that is checked first, here, so
   * that no caller can forget to.
   */
  async write(text: string, force = false): Promise<"written" | "skipped" | "stale"> {
    const handle = this.requireHandle();
    if (!force) {
      if (!this.canWrite) return "skipped";
      if (text === this.docText) return "skipped";
      if (await this.checkNow()) return "stale";
    }
    if (!(await this.askToWrite(handle))) {
      this.canWrite = false;
      this.emit();
      throw new DiskFileError("permission");
    }
    this.canWrite = true;
    const out = await handle.createWritable();
    try {
      await out.write(text);
    } finally {
      await out.close();
    }
    const file = await handle.getFile();
    // another program may have written between our close and this read: its
    // stamp is not ours to take, or the watcher would take its change for ours
    if (file.size !== new TextEncoder().encode(text).length || (await file.text()) !== text) {
      this.docText = text;
      await this.checkNow();
      return "written";
    }
    this.stamp = stampOf(file);
    this.fileText = text;
    this.docText = text;
    if (this.changed) {
      this.changed = false;
      this.emit();
    }
    return "written";
  }

  /* ---------------- watching ---------------- */

  /**
   * Looks at the file and says whether it differs from what this tab last saw.
   *
   * A newer timestamp alone is not taken as a change: cloud-sync clients touch
   * files without altering them, and a button that lights up for nothing soon
   * stops meaning anything. The contents are compared before it does.
   */
  check(): Promise<boolean> {
    return this.exclusive(() => this.checkNow());
  }

  /** `check` for when the turn is already ours: a write looks first. */
  private async checkNow(): Promise<boolean> {
    const handle = this.handle;
    if (!handle) return false;
    let file: File;
    try {
      file = await handle.getFile();
    } catch {
      return this.changed; // moved, deleted or locked: not something to guess about
    }
    if (handle !== this.handle) return false;
    const stamp = stampOf(file);
    if (stamp === this.stamp) return this.changed;
    let text: string;
    try {
      text = await file.text();
    } catch {
      return this.changed;
    }
    if (text === this.fileText) {
      this.stamp = stamp;
      return this.changed;
    }
    if (!this.changed) {
      this.changed = true;
      this.emit();
    }
    return true;
  }

  private onFocus = (): void => {
    void this.check();
  };

  private startWatching(): void {
    window.clearInterval(this.timer);
    this.timer = window.setInterval(() => void this.check(), WATCH_MS);
    window.removeEventListener("focus", this.onFocus);
    window.addEventListener("focus", this.onFocus);
  }

  private requireHandle(): FileHandleLike {
    if (!this.handle) throw new DiskFileError("no-file");
    return this.handle;
  }
}
