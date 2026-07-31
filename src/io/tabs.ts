/**
 * Noticing that another tab has saved the same document.
 *
 * Two open tabs share the autosave: with no warning, the last one to write
 * wipes out the other's work and nobody notices. The channel carries only the
 * fact that a save happened, not the document itself: the tab being told
 * decides what to offer the user.
 */
import { DOC_KEY } from "./storage";

const CHANNEL_NAME = "harness-designer";
const SAVED = "doc-saved";
/** Window within which the channel and the `storage` event count as one save. */
const DEDUP_MS = 1500;

/** Identifies this tab: the channel also delivers to other objects on the same page. */
const TAB_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function openChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  try {
    return new BroadcastChannel(CHANNEL_NAME);
  } catch {
    return null;
  }
}

let sender: BroadcastChannel | null | undefined;

/**
 * Tells the other tabs the document was saved. Call it after the autosave:
 * without `BroadcastChannel` the warning still travels on the `storage` event,
 * which the browser raises by itself.
 */
export function announceDocSaved(): void {
  if (sender === undefined) sender = openChannel();
  if (!sender) return;
  try {
    sender.postMessage({ type: SAVED, tab: TAB_ID });
  } catch {
    /* channel closed by the browser: the storage event remains */
  }
}

/**
 * Registers the listener and returns the detach function.
 *
 * Both sources are listened to: the channel warns immediately, the `storage`
 * event covers browsers that do not expose it. The dedup window keeps one save
 * from producing two notifications.
 */
export function watchOtherTabs(onOtherTabSaved: () => void): () => void {
  let last = 0;
  const fire = (): void => {
    const now = Date.now();
    if (now - last < DEDUP_MS) return;
    last = now;
    onOtherTabSaved();
  };

  const channel = openChannel();
  const onMessage = (ev: MessageEvent): void => {
    const data = ev.data as { type?: unknown; tab?: unknown } | null;
    if (!data || typeof data !== "object") return;
    if (data.type !== SAVED || data.tab === TAB_ID) return;
    fire();
  };
  channel?.addEventListener("message", onMessage);

  // The event only ever comes from other tabs; key removal is ignored.
  const onStorage = (ev: StorageEvent): void => {
    if (ev.key !== DOC_KEY || ev.newValue === null) return;
    fire();
  };
  window.addEventListener("storage", onStorage);

  return () => {
    window.removeEventListener("storage", onStorage);
    if (channel) {
      channel.removeEventListener("message", onMessage);
      channel.close();
    }
  };
}
