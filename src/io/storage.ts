/**
 * Access to `localStorage` that never throws.
 *
 * Storage can be missing or forbidden (private browsing, third-party cookies
 * blocked, sandboxed iframe) and it can refuse a write because the quota is
 * full. Those are two different failures: the first is final and should be
 * ignored quietly, the second is recoverable and deserves telling the user.
 * That is why `safeSet` distinguishes them instead of returning a bare
 * boolean.
 */

/** Autosave key for the document. */
export const DOC_KEY = "harness.doc";

export type SaveResult = "ok" | "quota" | "unavailable";

/**
 * Some browsers throw on merely touching the `localStorage` property, not only
 * on calling its methods, so every access has to be wrapped.
 */
function store(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Recognizes a quota overrun. The standard name is `QuotaExceededError`, but
 * Firefox uses `NS_ERROR_DOM_QUOTA_REACHED` and older browsers expose only the
 * numeric code: 22, or 1014 on Firefox.
 */
function isQuotaError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const name = err.name;
  if (name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED") return true;
  const code = (err as DOMException).code;
  return code === 22 || code === 1014;
}

export function safeGet(key: string): string | null {
  const s = store();
  if (!s) return null;
  try {
    return s.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Writes a value. Returns `"quota"` when the space is used up, in which case
 * the document can still be saved to a file, and `"unavailable"` when storage
 * cannot be used at all.
 */
export function safeSet(key: string, value: string): SaveResult {
  const s = store();
  if (!s) return "unavailable";
  try {
    s.setItem(key, value);
    return "ok";
  } catch (err) {
    return isQuotaError(err) ? "quota" : "unavailable";
  }
}

export function safeRemove(key: string): void {
  const s = store();
  if (!s) return;
  try {
    s.removeItem(key);
  } catch {
    /* nothing to be done: the key stays, but it is not the user's problem */
  }
}

/**
 * Carries an autosave written under an older key over to the current one.
 *
 * Losing the drawing someone left open, because a storage key was renamed
 * between builds, is not an acceptable way to ship a change. Runs once at
 * startup and does nothing when there is nothing to move.
 */
export function adoptLegacyAutosave(oldKeys: readonly string[]): void {
  if (safeGet(DOC_KEY)) return;
  for (const key of oldKeys) {
    const value = safeGet(key);
    if (!value) continue;
    if (safeSet(DOC_KEY, value) === "ok") safeRemove(key);
    return;
  }
}
