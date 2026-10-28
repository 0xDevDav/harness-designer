import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DiskFile } from "@/io/diskfile";
import type { FileHandleLike } from "@/io/diskfile";

/** A file that lives in memory, with a clock the test winds forward by hand. */
function memoryFile(initial: string, name = "harness.json") {
  const state = { text: initial, modified: 1000, writes: 0, permission: "granted" as PermissionState };
  const handle: FileHandleLike = {
    name,
    getFile: () => Promise.resolve(new File([state.text], name, { lastModified: state.modified })),
    createWritable: () => {
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
  /** Somebody else rewrites the file. */
  const outside = (text: string): void => {
    state.text = text;
    state.modified += 500;
  };
  return { state, handle, outside };
}

beforeEach(() => {
  vi.stubGlobal("window", {
    setInterval: () => 1,
    clearInterval: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("DiskFile", () => {
  it("reads what the file holds when it is attached", async () => {
    const disk = new DiskFile();
    const file = memoryFile('{"a":1}');
    expect(await disk.attach(file.handle)).toBe('{"a":1}');
    expect(disk.attached).toBe(true);
    expect(disk.name).toBe("harness.json");
    expect(disk.canAutosave).toBe(true);
  });

  it("writes an edit back to the file", async () => {
    const disk = new DiskFile();
    const file = memoryFile("old");
    await disk.attach(file.handle);
    expect(await disk.write("new")).toBe("written");
    expect(file.state.text).toBe("new");
  });

  it("does not rewrite a drawing that is already what was loaded or written", async () => {
    const disk = new DiskFile();
    const file = memoryFile("raw file text");
    await disk.attach(file.handle);
    disk.markLoaded("canonical");
    expect(await disk.write("canonical")).toBe("skipped");
    expect(file.state.writes).toBe(0);
    expect(await disk.write("edited")).toBe("written");
    expect(await disk.write("edited")).toBe("skipped");
    expect(file.state.writes).toBe(1);
  });

  it("notices when something else changes the file", async () => {
    const disk = new DiskFile();
    const file = memoryFile("one");
    await disk.attach(file.handle);
    const seen = vi.fn();
    disk.onChange(seen);

    expect(await disk.check()).toBe(false);
    file.outside("two");
    expect(await disk.check()).toBe(true);
    expect(disk.isStale).toBe(true);
    expect(seen).toHaveBeenCalledTimes(1);
    // asked again, it is still the same single change
    await disk.check();
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("ignores a touched file whose contents did not change", async () => {
    const disk = new DiskFile();
    const file = memoryFile("same");
    await disk.attach(file.handle);
    file.outside("same");
    expect(await disk.check()).toBe(false);
    expect(disk.isStale).toBe(false);
  });

  it("does not take its own write for an outside change", async () => {
    const disk = new DiskFile();
    const file = memoryFile("one");
    await disk.attach(file.handle);
    await disk.write("two");
    expect(await disk.check()).toBe(false);
  });

  it("will not overwrite a file that changed outside, and stops autosaving", async () => {
    const disk = new DiskFile();
    const file = memoryFile("one");
    await disk.attach(file.handle);
    file.outside("theirs");
    expect(await disk.write("mine")).toBe("stale");
    expect(file.state.text).toBe("theirs");
    expect(disk.canAutosave).toBe(false);
  });

  it("overwrites on purpose when forced", async () => {
    const disk = new DiskFile();
    const file = memoryFile("one");
    await disk.attach(file.handle);
    file.outside("theirs");
    await disk.check();
    expect(await disk.write("mine", true)).toBe("written");
    expect(file.state.text).toBe("mine");
    expect(disk.isStale).toBe(false);
    expect(disk.canAutosave).toBe(true);
  });

  it("reading the file again clears the outside-change flag", async () => {
    const disk = new DiskFile();
    const file = memoryFile("one");
    await disk.attach(file.handle);
    file.outside("theirs");
    await disk.check();
    expect(await disk.readText()).toBe("theirs");
    expect(disk.isStale).toBe(false);
    expect(await disk.check()).toBe(false);
  });

  it("does not autosave to a file it was refused write access to", async () => {
    const disk = new DiskFile();
    const file = memoryFile("one");
    file.state.permission = "denied";
    await disk.attach(file.handle);
    expect(disk.canAutosave).toBe(false);
    expect(await disk.write("two")).toBe("skipped");
    expect(file.state.writes).toBe(0);
  });

  it("lets go of the file on detach", async () => {
    const disk = new DiskFile();
    await disk.attach(memoryFile("x").handle);
    disk.detach();
    expect(disk.attached).toBe(false);
    expect(disk.canAutosave).toBe(false);
    expect(await disk.check()).toBe(false);
  });
});
