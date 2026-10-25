interface BackupIn {
  text?: string;
  buffer?: ArrayBuffer;
}

interface BackupOut {
  ok: boolean;
  parsed?: unknown;
  error?: string;
}

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<BackupIn>) => void) | null;
  postMessage: (data: BackupOut) => void;
};

scope.onmessage = (event) => {
  try {
    let text = event.data?.text;
    if (!text && event.data?.buffer) {
      text = new TextDecoder().decode(event.data.buffer);
    }
    if (typeof text !== "string" || !text) throw new Error("That file is not valid JSON.");
    const parsed = JSON.parse(text) as unknown;
    scope.postMessage({ ok: true, parsed });
  } catch (err) {
    scope.postMessage({
      ok: false,
      error: err instanceof Error ? err.message : "That file is not valid JSON.",
    });
  }
};
