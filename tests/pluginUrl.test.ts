import { describe, expect, it } from "vitest";
import { checkModuleUrl } from "@/plugins/host";

const PAGE = "https://example.com/harness/";

describe("checkModuleUrl", () => {
  it("accepts a path relative to the page", () => {
    const out = checkModuleUrl("plugins/metraggi.js", PAGE);
    expect(out).toEqual({ ok: true, href: "https://example.com/harness/plugins/metraggi.js" });
  });

  it("accepts an external https address", () => {
    const out = checkModuleUrl("https://altro.example/p.js", PAGE);
    expect(out.ok).toBe(true);
  });

  it("rejects external http", () => {
    const out = checkModuleUrl("http://altro.example/p.js", PAGE);
    expect(out).toEqual({ ok: false, reason: "insecure", detail: "http" });
  });

  it("rejects data: and javascript:", () => {
    expect(checkModuleUrl("data:text/javascript,alert(1)", PAGE).ok).toBe(false);
    expect(checkModuleUrl("javascript:alert(1)", PAGE).ok).toBe(false);
  });

  it("rejects a malformed address", () => {
    // no valid base: not even a relative path can be resolved
    expect(checkModuleUrl("plugin.js", "not-an-address")).toEqual({
      ok: false,
      reason: "malformed",
      detail: "plugin.js",
    });
  });

  it("accepts same-origin even when the page is served over http", () => {
    // the dev server is http://localhost: blocking it would make trying the
    // built-in plugins impossible
    const out = checkModuleUrl("plugins/p.js", "http://localhost:5173/");
    expect(out).toEqual({ ok: true, href: "http://localhost:5173/plugins/p.js" });
  });

  it("accepts a local file when the page itself is a file", () => {
    // the single-file distribution opened with a double click
    const out = checkModuleUrl("plugins/p.js", "file:///C:/schemi/index.html");
    expect(out.ok).toBe(true);
  });

  it("rejects external http from an http page too", () => {
    const out = checkModuleUrl("http://altro.example/p.js", "http://localhost:5173/");
    expect(out).toEqual({ ok: false, reason: "insecure", detail: "http" });
  });
});
