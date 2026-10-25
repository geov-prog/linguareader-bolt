function parseBackupMessage(payload: { text?: string; buffer?: ArrayBuffer }, transfer?: Transferable[]): Promise<unknown> {
  if (typeof Worker === "undefined") {
    return Promise.reject(new Error("Backup restore needs a browser."));
  }
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("../workers/backupParser.worker.ts", import.meta.url), { type: "module" });
    } catch (err) {
      reject(err instanceof Error ? err : new Error("Could not read that backup."));
      return;
    }
    let settled = false;
    const finish = (run: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      run();
    };
    const timer = setTimeout(() => {
      finish(() => reject(new Error("That backup took too long to read.")));
    }, 300_000);
    worker.onmessage = (event: MessageEvent<{ ok?: boolean; parsed?: unknown; error?: string }>) => {
      const data = event.data;
      if (!data?.ok) {
        finish(() => reject(new Error(data?.error || "That file is not valid JSON.")));
        return;
      }
      finish(() => resolve(data.parsed));
    };
    worker.onerror = () => {
      finish(() => reject(new Error("Could not read that backup.")));
    };
    try {
      if (transfer?.length) worker.postMessage(payload, transfer);
      else worker.postMessage(payload);
    } catch (err) {
      finish(() => reject(err instanceof Error ? err : new Error("Could not read that backup.")));
    }
  });
}

export function parseBackupJson(raw: string): Promise<unknown> {
  return parseBackupMessage({ text: raw });
}

export function parseBackupBuffer(buffer: ArrayBuffer): Promise<unknown> {
  return parseBackupMessage({ buffer }, [buffer]);
}
