import { describe, expect, it } from "vitest";
import { ReloadGuard } from "@/io/reloadguard";
import { createWriteQueue } from "@/io/writequeue";

describe("ReloadGuard", () => {
  it("knows nothing before a Reload", () => {
    expect(new ReloadGuard().wouldRevert("anything")).toBe(false);
  });

  it("flags the drawing a Reload replaced, and only that one", () => {
    const guard = new ReloadGuard();
    guard.arm("before", "after");
    expect(guard.wouldRevert("before")).toBe(true);
    expect(guard.wouldRevert("after")).toBe(false);
    expect(guard.wouldRevert("edited after")).toBe(false);
  });

  it("has nothing to protect when the file said what the screen said", () => {
    const guard = new ReloadGuard();
    guard.arm("same", "same");
    expect(guard.wouldRevert("same")).toBe(false);
  });

  it("lets go once the file and the screen agree again", () => {
    const guard = new ReloadGuard();
    guard.arm("before", "after");
    guard.clear();
    expect(guard.wouldRevert("before")).toBe(false);
  });

  it("follows the latest Reload", () => {
    const guard = new ReloadGuard();
    guard.arm("one", "two");
    guard.arm("two", "three");
    expect(guard.wouldRevert("one")).toBe(false);
    expect(guard.wouldRevert("two")).toBe(true);
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
