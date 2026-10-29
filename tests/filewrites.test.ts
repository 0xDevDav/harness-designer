import { describe, expect, it } from "vitest";
import { Store } from "@/core/store";
import { ReloadGuard } from "@/io/reloadguard";
import { createWriteQueue } from "@/io/writequeue";

describe("ReloadGuard", () => {
  it("knows nothing before a Reload", () => {
    expect(new ReloadGuard().wouldRevert(0)).toBe(false);
  });

  it("flags any position below the one a Reload left, and none at or above it", () => {
    const guard = new ReloadGuard();
    guard.arm("before", "after", 5);
    expect(guard.wouldRevert(4)).toBe(true);
    expect(guard.wouldRevert(3)).toBe(true);
    expect(guard.wouldRevert(5)).toBe(false);
    expect(guard.wouldRevert(7)).toBe(false);
  });

  it("has nothing to protect when the file said what the screen said", () => {
    const guard = new ReloadGuard();
    guard.arm("same", "same", 5);
    expect(guard.wouldRevert(0)).toBe(false);
  });

  it("stays armed however many times it is asked, because writing does not let it go", () => {
    const guard = new ReloadGuard();
    guard.arm("before", "after", 5);
    expect(guard.wouldRevert(4)).toBe(true);
    expect(guard.wouldRevert(4)).toBe(true);
    // a redo back to the Reload's own drawing is fine, and an undo again is not
    expect(guard.wouldRevert(5)).toBe(false);
    expect(guard.wouldRevert(4)).toBe(true);
  });

  it("lets go when the person has settled it", () => {
    const guard = new ReloadGuard();
    guard.arm("before", "after", 5);
    guard.clear();
    expect(guard.wouldRevert(0)).toBe(false);
  });

  it("follows the latest Reload", () => {
    const guard = new ReloadGuard();
    guard.arm("one", "two", 3);
    guard.arm("two", "three", 8);
    expect(guard.wouldRevert(5)).toBe(true);
    expect(guard.wouldRevert(8)).toBe(false);
  });

  it("works on the history the store keeps: Reload, an edit, then two undos reaches below", () => {
    const store = new Store();
    store.load({ meta: { title: "on screen" } });
    // Reload replaces the drawing, as one step that can be undone
    store.load({ meta: { title: "from the file" } }, { resetHistory: false, reason: "reload" });
    const guard = new ReloadGuard();
    guard.arm("on screen", "from the file", store.historyPosition);

    store.edit((d) => {
      d.meta.title = "edited after";
    });
    expect(guard.wouldRevert(store.historyPosition)).toBe(false);
    store.undo();
    expect(guard.wouldRevert(store.historyPosition)).toBe(false);
    store.undo();
    expect(store.doc.meta.title).toBe("on screen");
    expect(guard.wouldRevert(store.historyPosition)).toBe(true);
    store.redo();
    expect(guard.wouldRevert(store.historyPosition)).toBe(false);
  });

  it("keeps counting when the oldest steps are dropped to make room", () => {
    const store = new Store();
    store.load({});
    for (let i = 0; i < 130; i++) {
      store.edit((d) => {
        d.meta.title = `step ${i}`;
      });
    }
    const here = store.historyPosition;
    store.edit((d) => {
      d.meta.title = "one more";
    });
    expect(store.historyPosition).toBe(here + 1);
    store.undo();
    expect(store.historyPosition).toBe(here);
  });
});

describe("createWriteQueue", () => {
  const later = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  it("runs jobs one at a time, in the order they were asked for", async () => {
    const queue = createWriteQueue();
    const log: string[] = [];
    const slow = queue(async () => {
      log.push("slow start");
      await later(20);
      log.push("slow end");
    });
    const fast = queue(() => {
      log.push("fast");
      return Promise.resolve();
    });
    await Promise.all([slow, fast]);
    expect(log).toEqual(["slow start", "slow end", "fast"]);
  });

  it("gives each job's result to whoever asked for it", async () => {
    const queue = createWriteQueue();
    expect(await queue(() => Promise.resolve(7))).toBe(7);
  });

  it("reports a failed job to its caller and still runs the ones behind it", async () => {
    const queue = createWriteQueue();
    const failed = queue(() => Promise.reject(new Error("disk full")));
    const after = queue(() => Promise.resolve("written"));
    await expect(failed).rejects.toThrow("disk full");
    await expect(after).resolves.toBe("written");
  });
});
