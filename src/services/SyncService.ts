const CHANNEL_NAME = "linguareader.sync.v1";

export type SyncEvent =
  | { type: "library"; origin: string }
  | { type: "settings"; origin: string }
  | {
      type: "progress";
      origin: string;
      documentId: string;
      sentenceOffset: number;
    }
  | { type: "active"; origin: string; documentId: string | null };

export const TAB_ID =
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `tab-${Math.random().toString(36).slice(2)}`;

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

type Handler = (event: SyncEvent) => void;

const handlers = new Set<Handler>();
let channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  if (channel) return channel;
  channel = new BroadcastChannel(CHANNEL_NAME);
  channel.onmessage = (ev: MessageEvent<SyncEvent>) => {
    const data = ev.data;
    if (!data || typeof data !== "object" || !("type" in data)) return;
    if (data.origin === TAB_ID) return;
    for (const handler of handlers) handler(data);
  };
  return channel;
}

export function subscribe(handler: Handler): () => void {
  getChannel();
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
}

export function broadcast(event: DistributiveOmit<SyncEvent, "origin">): void {
  const full = { ...event, origin: TAB_ID } as SyncEvent;
  getChannel()?.postMessage(full);
}

export const SyncService = {
  subscribe,
  broadcast,
  TAB_ID,
};
