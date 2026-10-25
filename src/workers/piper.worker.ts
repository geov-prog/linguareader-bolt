import * as tts from "@mintplex-labs/piper-tts-web";

interface PiperIn {
  id: number;
  text: string;
  voiceId: string;
  modelUrls?: string[];
  configUrls?: string[];
}

interface PiperOut {
  id: number;
  ok: boolean;
  wav?: Blob;
  error?: string;
}

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<PiperIn>) => void) | null;
  postMessage: (data: PiperOut) => void;
  navigator: Navigator;
};

const MODEL_ERROR = "Piper model error. Using system voice.";
const DOWNLOAD_ERROR = "Piper model download failed. Using system voice.";

async function fetchRemote(url: string, kind: "model" | "config"): Promise<Uint8Array | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes[0] === 0x3c) return null;
    if (kind === "model" && (bytes.byteLength < 1_000_000 || bytes[4] !== 0x4f || bytes[5] !== 0x52 || bytes[6] !== 0x54 || bytes[7] !== 0x4d)) return null;
    if (kind === "config" && (bytes.byteLength < 20 || bytes.byteLength > 100_000 || bytes[0] !== 0x7b)) return null;
    return bytes;
  } catch {
    return null;
  }
}

async function storedFile(name: string, minSize: number): Promise<boolean> {
  try {
    const root = await scope.navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle("piper");
    const handle = await dir.getFileHandle(name);
    const file = await handle.getFile();
    return file.size >= minSize;
  } catch {
    return false;
  }
}

async function saveFile(name: string, bytes: Uint8Array): Promise<void> {
  const root = await scope.navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle("piper", { create: true });
  const handle = await dir.getFileHandle(name, { create: true });
  const syncHandle = handle as FileSystemFileHandle & {
    createSyncAccessHandle?: () => Promise<{
      truncate: (size: number) => void;
      write: (data: Uint8Array, options?: { at?: number }) => number;
      flush: () => void;
      close: () => void;
    }>;
  };
  if (syncHandle.createSyncAccessHandle) {
    const access = await syncHandle.createSyncAccessHandle();
    try {
      access.truncate(0);
      access.write(bytes, { at: 0 });
      access.flush();
    } finally {
      access.close();
    }
    return;
  }
  const writable = await handle.createWritable();
  await writable.write(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  await writable.close();
}

async function storedOrt(name: string): Promise<boolean> {
  try {
    const root = await scope.navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle("piper");
    const handle = await dir.getFileHandle(name);
    const file = await handle.getFile();
    if (file.size < 1_000_000) return false;
    const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    return head[4] === 0x4f && head[5] === 0x52 && head[6] === 0x54 && head[7] === 0x4d;
  } catch {
    return false;
  }
}

async function fetchFirst(urls: string[], kind: "model" | "config"): Promise<Uint8Array | null> {
  for (const url of urls) {
    const bytes = await fetchRemote(url, kind);
    if (bytes) return bytes;
  }
  return null;
}

async function ensureLocalModel(voiceId: string, modelUrls: string[], configUrls: string[]): Promise<void> {
  const modelName = `${voiceId}.onnx`;
  const configName = `${voiceId}.onnx.json`;
  if (!(await storedOrt(modelName))) {
    const bytes = await fetchFirst(modelUrls, "model");
    if (!bytes) throw new Error(DOWNLOAD_ERROR);
    await saveFile(modelName, bytes);
  }
  if (!(await storedFile(configName, 20))) {
    const bytes = await fetchFirst(configUrls, "config");
    if (!bytes) throw new Error(DOWNLOAD_ERROR);
    await saveFile(configName, bytes);
  }
}

let chain: Promise<void> = Promise.resolve();

scope.onmessage = (event) => {
  const job = event.data;
  chain = chain.then(async () => {
    try {
      if (!job?.text || !job.voiceId || !job.modelUrls?.length || !job.configUrls?.length) throw new Error(DOWNLOAD_ERROR);
      await ensureLocalModel(job.voiceId, job.modelUrls, job.configUrls);
      const wav = await tts.predict({ text: job.text, voiceId: job.voiceId });
      if (!wav || wav.size < 800) throw new Error(MODEL_ERROR);
      scope.postMessage({ id: job.id, ok: true, wav });
    } catch (err) {
      const message = err instanceof Error && err.message.includes("download failed") ? DOWNLOAD_ERROR : MODEL_ERROR;
      scope.postMessage({ id: job.id, ok: false, error: message });
    }
  });
};
