import { afterEach, describe, expect, it, vi } from "vitest";
import type { ToastApi } from "@/app/context";
import { Store } from "@/core/store";
import type { Translate } from "@/i18n";
import type { FileHandleLike } from "@/io/diskfile";
import { createFileSession } from "@/io/filesession";
import type { FileSession } from "@/io/filesession";

/**
 * The drawing and its file working together, the whole way through: a real
 * store, the real session and disk file, and a file that lives in memory.
 *
 * These are the paths that can lose work on disk, so they are tested as a
 * person meets them (Reload, Ctrl+Z, edit, Save, Open) and not one function at a
 * time. The clock is the test's: an autosave waits 700 ms and the file is looked
 * at every two seconds, and both are wound forward by hand.
 */

/** A file that lives in memory. Somebody else can rewrite it, or make writing to it fail. */
function memoryFile(initial: string, name = "harness.json") {
  const state = {
    text: initial,
    modified: 1000,
    writes: 0,
    permission: "granted" as PermissionState,
    failWrites: false,
  };
  const handle: FileHandleLike = {
    name,
    getFile: () => Promise.resolve(new File([state.text], name, { lastModified: state.modified })),
    createWritable: () => {
      if (state.failWrites) return Promise.reject(new Error("disk full"));
      let buffer = "";
      return Promise.resolve({
        write: (data: string) => {
          buffer += data;
          return Promise.resolve();
        },
        close: () => {
          state.text = buffer;
          state.modified += 10;
          state.writes++;
          return Promise.resolve();
        },
      });
    },
    queryPermission: () => Promise.resolve(state.permission),
    requestPermission: () => Promise.resolve(state.permission),
  };
  const outside = (text: string): void => {
    state.text = text;
    state.modified += 500;
  };
  const title = (): string => (JSON.parse(state.text) as { meta: { title: string } }).meta.title;
  return { state, handle, outside, title };
}

const drawing = (title: string): string => JSON.stringify({ meta: { title } });

const t = ((key: string) => key) as Translate;

function setup(options: { permission?: PermissionState } = {}) {
  vi.useFakeTimers();
  const file = memoryFile(drawing("mine"));
  if (options.permission) file.state.permission = options.permission;
  const second = memoryFile(drawing("other file"), "second.json");
  const pickers = { open: file.handle, save: second.handle };

  vi.stubGlobal("window", {
    setTimeout: (fn: () => void, ms?: number) => setTimeout(fn, ms),
    clearTimeout: (id?: ReturnType<typeof setTimeout>) => clearTimeout(id),
    setInterval: (fn: () => void, ms?: number) => setInterval(fn, ms),
    clearInterval: (id?: ReturnType<typeof setInterval>) => clearInterval(id),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    showOpenFilePicker: () => Promise.resolve([pickers.open]),
    showSaveFilePicker: () => Promise.resolve(pickers.save),
  });
  vi.stubGlobal("document", { addEventListener: () => undefined, visibilityState: "visible" });

  const toast = { show: vi.fn(), error: vi.fn() } satisfies ToastApi;
  const dialogs = {
    confirm: vi.fn(() => Promise.resolve(true)),
    alert: vi.fn(() => Promise.resolve()),
    prompt: vi.fn(() => Promise.resolve(null)),
    choose: vi.fn(() => Promise.resolve(null)),
  };
  const store = new Store();
  const session: FileSession = createFileSession({
    store,
    toast,
    dialogs,
    t,
    openWithoutLink: vi.fn(),
  });
  store.setPersister(() => session.queueAutosave());

  return {
    file,
    second,
    store,
    session,
    toast,
    dialogs,
    /** how many times a message was shown, by its key */
    shown: (key: string): number => toast.show.mock.calls.filter((c) => c[0] === key).length,
    edit: (title: string): void => void store.edit((d) => void (d.meta.title = title)),
    screen: (): string => store.doc.meta.title ?? "",
    /** time passes: long enough for an autosave, and for the watcher to look */
    pass: async (ms = 1000): Promise<void> => {
      await vi.advanceTimersByTimeAsync(ms);
    },
  };
}

type Setup = ReturnType<typeof setup>;

/** Opens the file and lets whatever that raised settle. */
async function opened(): Promise<Setup> {
  const s = setup();
  await s.session.open();
  await s.pass();
  return s;
}

/** The file was changed from outside and the window has Reloaded: the screen holds the outside drawing. */
async function reloaded(s: Setup): Promise<void> {
  s.file.outside(drawing("theirs"));
  await s.session.reload();
  await s.pass();
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("autosave", () => {
  it("writes an edit a moment after it is made, not at once, and not when nothing changed", async () => {
    const s = await opened();
    expect(s.file.state.writes).toBe(0);
    s.edit("edited");
    await s.pass(100);
    expect(s.file.state.writes).toBe(0);
    await s.pass(800);
    expect(s.file.state.writes).toBe(1);
    expect(s.file.title()).toBe("edited");
    await s.pass(5000);
    expect(s.file.state.writes).toBe(1);
  });

  it("writes only the last of several quick edits", async () => {
    const s = await opened();
    for (const title of ["a", "b", "c"]) {
      s.edit(title);
      await s.pass(200);
    }
    await s.pass(1000);
    expect(s.file.state.writes).toBe(1);
    expect(s.file.title()).toBe("c");
  });

  it("does not write when write permission was refused", async () => {
    const s = setup({ permission: "denied" });
    await s.session.open();
    s.edit("edited");
    await s.pass(2000);
    expect(s.session.autosaving).toBe(false);
    expect(s.file.state.writes).toBe(0);
  });

  it("says once when a write fails, and goes on when it works again", async () => {
    const s = await opened();
    s.file.state.failWrites = true;
    s.edit("a");
    await s.pass(1000);
    s.edit("b");
    await s.pass(1000);
    expect(s.toast.error.mock.calls.filter((c) => c[0] === "toast.autosaveFailed")).toHaveLength(1);
    s.file.state.failWrites = false;
    s.edit("c");
    await s.pass(1000);
    expect(s.file.title()).toBe("c");
  });
});

describe("a change made from outside", () => {
  it("stops autosave, which would overwrite it, and says so once", async () => {
    const s = await opened();
    s.file.outside(drawing("theirs"));
    await s.pass(2100); // the watcher looks every two seconds
    expect(s.session.stale).toBe(true);
    s.edit("a");
    s.edit("b");
    await s.pass(2000);
    expect(s.file.state.writes).toBe(0);
    expect(s.file.title()).toBe("theirs");
    expect(s.shown("toast.fileChanged")).toBe(1);
  });

  it("is brought in by Reload, which writes nothing and lets autosave go on", async () => {
    const s = await opened();
    await reloaded(s);
    expect(s.screen()).toBe("theirs");
    expect(s.session.stale).toBe(false);
    expect(s.file.state.writes).toBe(0);
    s.edit("after");
    await s.pass();
    expect(s.file.title()).toBe("after");
  });
});

describe("Ctrl+Z after a Reload never puts the old drawing back on the file", () => {
  it.each([150, 500])("Reload, Ctrl+Z, then an edit %i ms later", async (later) => {
    const s = await opened();
    await reloaded(s);
    s.store.undo();
    await s.pass(later);
    s.edit("late");
    await s.pass(3000);
    expect(s.file.state.writes).toBe(0);
    expect(s.file.title()).toBe("theirs");
    expect(s.session.stale).toBe(true);
    expect(s.shown("toast.undoReload")).toBe(1);
  });

  it("Reload, an edit that was saved, then Ctrl+Z twice", async () => {
    const s = await opened();
    await reloaded(s);
    s.edit("edited");
    await s.pass();
    expect(s.file.state.writes).toBe(1);
    s.store.undo();
    s.store.undo();
    expect(s.screen()).toBe("mine");
    await s.pass(3000);
    expect(s.file.state.writes).toBe(1);
    expect(s.file.title()).toBe("edited");
    expect(s.shown("toast.undoReload")).toBe(1);
  });

  it("Reload, an edit, and two Ctrl+Z inside the autosave delay", async () => {
    const s = await opened();
    await reloaded(s);
    s.edit("edited");
    s.store.undo();
    s.store.undo();
    await s.pass(3000);
    expect(s.file.state.writes).toBe(0);
    expect(s.file.title()).toBe("theirs");
  });

  it("a Redo does not let it go", async () => {
    const s = await opened();
    await reloaded(s);
    s.store.undo();
    s.store.redo();
    await s.pass(3000);
    expect(s.file.state.writes).toBe(0);
    expect(s.session.autosaving).toBe(false);
  });

  it("holds against many edits after the undo", async () => {
    const s = await opened();
    await reloaded(s);
    s.store.undo();
    for (const title of ["a", "b", "c", "d"]) {
      s.edit(title);
      await s.pass(300);
    }
    await s.pass(3000);
    expect(s.file.state.writes).toBe(0);
    expect(s.file.title()).toBe("theirs");
  });

  it("still holds after a second Reload that found nothing new", async () => {
    const s = await opened();
    await reloaded(s);
    await s.session.reload(); // the file has not changed since
    await s.pass();
    s.store.undo(); // back to the drawing the first Reload brought in: the file's own
    s.store.undo(); // back to the one it replaced
    await s.pass(3000);
    expect(s.screen()).toBe("mine");
    expect(s.file.state.writes).toBe(0);
    expect(s.file.title()).toBe("theirs");
    expect(s.session.stale).toBe(true);
  });
});

describe("what lets the hold go", () => {
  /** Reload, then Ctrl+Z: the drawing on screen is the one the Reload replaced, and the file is on hold. */
  async function held(): Promise<Setup> {
    const s = await opened();
    await reloaded(s);
    s.store.undo();
    s.edit("late");
    await s.pass(2000);
    expect(s.file.state.writes).toBe(0);
    expect(s.session.autosaving).toBe(false);
    s.toast.show.mockClear();
    return s;
  }

  it("the next Reload does, at once: no second toast, no amber button, edits are written", async () => {
    const s = await held();
    await s.session.reload();
    await s.pass();
    expect(s.session.stale).toBe(false);
    expect(s.session.autosaving).toBe(true);
    expect(s.shown("toast.undoReload")).toBe(0);
    expect(s.shown("toast.fileChanged")).toBe(0);
    expect(s.shown("toast.reloaded")).toBe(1);
    s.edit("after");
    await s.pass();
    expect(s.file.state.writes).toBe(1);
    expect(s.file.title()).toBe("after");
  });

  it("opening the file does, and the toast does not say anything about undoing", async () => {
    const s = await held();
    await s.session.open();
    await s.pass();
    expect(s.session.stale).toBe(false);
    expect(s.session.autosaving).toBe(true);
    expect(s.shown("toast.undoReload")).toBe(0);
    expect(s.shown("toast.openedFile")).toBe(1);
    s.edit("after");
    await s.pass();
    expect(s.file.title()).toBe("after");
  });

  it("a Save that was confirmed does: the file gets what is on screen, and then autosave goes on", async () => {
    const s = await held();
    await s.session.save();
    expect(s.dialogs.confirm).toHaveBeenCalledTimes(1);
    expect(s.file.title()).toBe("late");
    expect(s.session.stale).toBe(false);
    s.edit("after");
    await s.pass();
    expect(s.file.title()).toBe("after");
  });

  it("a Save that was not confirmed does not: nothing is written and it stays on hold", async () => {
    const s = await held();
    s.dialogs.confirm.mockResolvedValueOnce(false);
    await s.session.save();
    expect(s.file.state.writes).toBe(0);
    s.edit("after");
    await s.pass(3000);
    expect(s.file.state.writes).toBe(0);
    expect(s.file.title()).toBe("theirs");
  });

  it("Save as does: the drawing goes to the new file, and autosave follows it there", async () => {
    const s = await held();
    await s.session.saveAs();
    expect(s.second.title()).toBe("late");
    expect(s.session.name).toBe("second.json");
    expect(s.file.state.writes).toBe(0);
    s.edit("after");
    await s.pass();
    expect(s.second.title()).toBe("after");
    expect(s.file.title()).toBe("theirs");
  });

  it("unlinking the file does: nothing is written to it, and the next file starts clean", async () => {
    const s = await held();
    s.session.detach();
    expect(s.session.attached).toBe(false);
    s.edit("elsewhere");
    await s.pass(3000);
    expect(s.file.state.writes).toBe(0);
    await s.session.open();
    await s.pass();
    s.edit("again");
    await s.pass();
    expect(s.file.title()).toBe("again");
  });

  it("nothing else does: time, further edits and the watcher leave it on hold", async () => {
    const s = await held();
    for (let i = 0; i < 5; i++) {
      s.edit(`edit ${i}`);
      await s.pass(2500);
    }
    expect(s.file.state.writes).toBe(0);
    expect(s.session.autosaving).toBe(false);
    expect(s.file.title()).toBe("theirs");
  });
});

describe("a Reload that finds nothing to protect", () => {
  it("leaves undo alone: it writes the earlier drawing, which is the file's own history", async () => {
    const s = await opened();
    await s.session.reload(); // the file says what the screen says
    await s.pass();
    s.edit("x");
    await s.pass();
    expect(s.file.title()).toBe("x");
    s.store.undo();
    await s.pass();
    expect(s.file.title()).toBe("mine");
    expect(s.shown("toast.undoReload")).toBe(0);
  });
});

describe("a file that is not a drawing", () => {
  it("is not loaded: the screen stays, the file is not written, and a good file recovers", async () => {
    const s = await opened();
    s.file.outside("this is not json");
    await s.session.reload();
    expect(s.dialogs.alert).toHaveBeenCalledTimes(1);
    expect(s.screen()).toBe("mine");
    expect(s.session.stale).toBe(true);
    s.edit("edited");
    await s.pass(3000);
    expect(s.file.state.writes).toBe(0);

    s.file.outside(drawing("repaired"));
    await s.session.reload();
    await s.pass();
    expect(s.screen()).toBe("repaired");
    expect(s.session.stale).toBe(false);
    s.edit("after");
    await s.pass();
    expect(s.file.title()).toBe("after");
  });

  it("does not let go of a hold that a Reload could not finish", async () => {
    const s = await opened();
    await reloaded(s);
    s.store.undo();
    s.edit("late");
    await s.pass(2000);
    s.file.outside("this is not json");
    await s.session.reload();
    s.edit("again");
    await s.pass(3000);
    expect(s.file.state.writes).toBe(0);
    expect(s.session.autosaving).toBe(false);
  });
});

describe("Save", () => {
  it("says why it failed, and writes nothing", async () => {
    const s = await opened();
    s.file.state.failWrites = true;
    await s.session.save();
    expect(s.toast.error).toHaveBeenCalledTimes(1);
    expect(s.toast.error.mock.calls[0]?.[0]).toBe("toast.saveFailed");
    expect(s.file.state.writes).toBe(0);
  });

  it("asks before overwriting a file that was changed from outside, and writes on a yes", async () => {
    const s = await opened();
    s.file.outside(drawing("theirs"));
    await s.pass(2100);
    s.edit("mine again");
    await s.session.save();
    expect(s.dialogs.confirm).toHaveBeenCalledTimes(1);
    expect(s.file.title()).toBe("mine again");
  });
});
