import { speakStoryChunk } from "@/lib/story-tts";
import { speakEdgeMp3 } from "@/services/media/edgeSpeak";
import { getTtsClip, putTtsClip } from "@/services/StorageService";
import { fetchAndroidStory } from "@/services/media/AndroidVoices";
import { isAndroidChrome, isInstalledAndroidApp, isIOS } from "@/utils/platform";
import { toast } from "sonner";

export const STORY_PREFIX = "story:";
export const STORY_AUTO = "story:auto";

export type StoryGender = "female" | "male";
export type StoryLang = "zh" | "en";

export interface StoryVoice {
  id: string;
  uri: string;
  name: string;
  hint: string;
  lang: StoryLang;
  gender: StoryGender;
  neural: string;
}

export const STORY_VOICES: StoryVoice[] = [
  {
    id: "lin-hua",
    uri: `${STORY_PREFIX}lin-hua`,
    name: "林华",
    hint: "Female · Chinese novels",
    lang: "zh",
    gender: "female",
    neural: "zh-CN-XiaoxiaoNeural",
  },
  {
    id: "shen-yan",
    uri: `${STORY_PREFIX}shen-yan`,
    name: "沈言",
    hint: "Male · Chinese novels",
    lang: "zh",
    gender: "male",
    neural: "zh-CN-YunxiNeural",
  },
  {
    id: "clara",
    uri: `${STORY_PREFIX}clara`,
    name: "Clara",
    hint: "Female · English novels",
    lang: "en",
    gender: "female",
    neural: "en-US-AriaNeural",
  },
  {
    id: "rowan",
    uri: `${STORY_PREFIX}rowan`,
    name: "Rowan",
    hint: "Male · English novels",
    lang: "en",
    gender: "male",
    neural: "en-US-GuyNeural",
  },
];

const LEGACY_PIPER_ID: Record<string, string> = {
  huayan: "lin-hua",
  lessac: "clara",
  ryan: "rowan",
};

export function isStoryVoiceURI(uri: string | null | undefined): boolean {
  return !!uri?.startsWith(STORY_PREFIX);
}

export function getStoryVoice(uri: string | null | undefined): StoryVoice | null {
  if (!uri?.startsWith(STORY_PREFIX) || uri === STORY_AUTO) return null;
  const raw = uri.slice(STORY_PREFIX.length);
  const id = LEGACY_PIPER_ID[raw] ?? raw;
  return STORY_VOICES.find((v) => v.id === id) ?? null;
}

export function pickStoryVoice(uri: string | null | undefined, lang: StoryLang): StoryVoice {
  const explicit = getStoryVoice(uri);
  if (explicit) return explicit;
  if (lang === "en") return STORY_VOICES.find((v) => v.id === "clara") ?? STORY_VOICES[0]!;
  return STORY_VOICES.find((v) => v.id === "lin-hua") ?? STORY_VOICES[0]!;
}

export const PIPER_URI = "piper:offline";

export function piperVoiceId(uri: string | null | undefined, lang: StoryLang): string {
  const picked = uri && uri !== PIPER_URI && uri !== STORY_AUTO ? getStoryVoice(uri) : null;
  if (picked?.neural) return picked.neural;
  return lang === "en" ? "en_US-lessac-medium" : "zh_CN-huayan-medium";
}

const MODEL_URLS: Record<string, { model: string; config: string }> = {
  "zh_CN-huayan-medium": {
    model: `https://corsproxy.io/?url=${encodeURIComponent("https://github.com/geov-prog/linguareader-models/releases/download/v1/zh_CN-huayan-medium.ort")}`,
    config: `https://corsproxy.io/?url=${encodeURIComponent("https://github.com/geov-prog/linguareader-models/releases/download/v1/zh_CN-huayan-medium.onnx.json")}`,
  },
  "en_US-lessac-medium": {
    model: `https://corsproxy.io/?url=${encodeURIComponent("https://github.com/geov-prog/linguareader-models/releases/download/v1/en_US-lessac-medium.ort")}`,
    config: `https://corsproxy.io/?url=${encodeURIComponent("https://github.com/geov-prog/linguareader-models/releases/download/v1/en_US-lessac-medium.onnx.json")}`,
  },
  "en_US-ryan-medium": {
    model: `https://corsproxy.io/?url=${encodeURIComponent("https://github.com/geov-prog/linguareader-models/releases/download/v1/en_US-ryan-medium.ort")}`,
    config: `https://corsproxy.io/?url=${encodeURIComponent("https://github.com/geov-prog/linguareader-models/releases/download/v1/en_US-ryan-medium.onnx.json")}`,
  },
};

const DOWNLOAD_PROXIES = ["https://githubproxy.cc/", "https://ghfast.top/"];

function proxied(url: string): string[] {
  return DOWNLOAD_PROXIES.map((proxy) => `${proxy}${url}`);
}

async function fetchProxied(url: string): Promise<Response | null> {
  for (const proxiedUrl of proxied(url)) {
    try {
      const response = await fetch(proxiedUrl);
      if (response.ok) return response;
    } catch {
      /* try the backup proxy */
    }
  }
  return null;
}

const DOWNLOAD_ERROR = "Piper model download failed. Using system voice.";

async function piperFileReady(name: string): Promise<boolean> {
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle("piper");
    const handle = await dir.getFileHandle(name);
    const file = await handle.getFile();
    if (name.endsWith(".onnx")) {
      if (file.size < 1_000_000) return false;
      const head = new Uint8Array(await file.slice(4, 8).arrayBuffer());
      return head[0] === 0x4f && head[1] === 0x52 && head[2] === 0x54 && head[3] === 0x4d;
    }
    return file.size > 20;
  } catch {
    return false;
  }
}

async function savePiperFile(name: string, blob: Blob): Promise<void> {
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle("piper", { create: true });
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
}

export async function installLocalPiperModel(voiceId: string, onProgress?: (percent: number) => void): Promise<boolean> {
  const remote = MODEL_URLS[voiceId];
  if (!remote || typeof navigator === "undefined" || !navigator.storage?.getDirectory) return false;
  const onnxName = `${voiceId}.onnx`;
  const jsonName = `${voiceId}.onnx.json`;
  if ((await piperFileReady(onnxName)) && (await piperFileReady(jsonName))) {
    onProgress?.(100);
    return true;
  }
  const onnxRes = await fetchProxied(remote.model);
  onProgress?.(40);
  const jsonRes = await fetchProxied(remote.config);
  if (!onnxRes?.ok || !jsonRes?.ok) return false;
  const onnxBlob = await onnxRes.blob();
  const jsonBlob = await jsonRes.blob();
  const head = new TextDecoder().decode(await onnxBlob.slice(0, 20).arrayBuffer());
  if (onnxBlob.size < 1_000_000 || head.includes("<") || !head.includes("ORTM") || jsonBlob.size < 20 || jsonBlob.size > 100_000) return false;
  await savePiperFile(onnxName, onnxBlob);
  onProgress?.(80);
  await savePiperFile(jsonName, jsonBlob);
  onProgress?.(100);
  return true;
}

export async function downloadPiperVoice(voiceId: string, onProgress?: (percent: number) => void): Promise<void> {
  const ready = await installLocalPiperModel(voiceId, onProgress);
  if (!ready) throw new Error(DOWNLOAD_ERROR);
}

let piperWorker: Worker | null = null;
let piperJob = 0;
const piperPending = new Map<number, { resolve: (blob: Blob) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();

function piperError(message?: string): Error {
  if (message?.includes("download failed")) return new Error(DOWNLOAD_ERROR);
  if (message?.includes("Piper model error")) return new Error(message);
  return new Error(DOWNLOAD_ERROR);
}

function rejectPiperJob(id: number, error: Error): void {
  const job = piperPending.get(id);
  if (!job) return;
  clearTimeout(job.timer);
  piperPending.delete(id);
  job.reject(error);
}

function ensurePiperWorker(): Worker {
  if (piperWorker) return piperWorker;
  const worker = new Worker(new URL("../../workers/piper.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (event: MessageEvent<{ id?: number; ok?: boolean; wav?: Blob; error?: string }>) => {
    const id = event.data?.id;
    if (typeof id !== "number") return;
    const job = piperPending.get(id);
    if (!job) return;
    clearTimeout(job.timer);
    piperPending.delete(id);
    const wav = event.data?.wav;
    if (!event.data?.ok || !wav || wav.size < 800) job.reject(piperError(event.data?.error));
    else job.resolve(wav);
  };
  worker.onerror = () => {
    piperWorker = null;
    for (const id of [...piperPending.keys()]) rejectPiperJob(id, piperError());
  };
  piperWorker = worker;
  return worker;
}

async function speakPiper(text: string, voiceId: string): Promise<Blob> {
  if (typeof Worker === "undefined") throw new Error(DOWNLOAD_ERROR);
  const remote = MODEL_URLS[voiceId];
  if (!remote) throw new Error(DOWNLOAD_ERROR);
  const id = ++piperJob;
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = ensurePiperWorker();
    } catch {
      reject(new Error(DOWNLOAD_ERROR));
      return;
    }
    const timer = setTimeout(() => rejectPiperJob(id, new Error(DOWNLOAD_ERROR)), 240_000);
    piperPending.set(id, { resolve, reject, timer });
    try {
      worker.postMessage({
        id,
        text,
        voiceId,
        modelUrls: proxied(remote.model),
        configUrls: proxied(remote.config),
      });
    } catch {
      rejectPiperJob(id, new Error(DOWNLOAD_ERROR));
    }
  });
}

export async function loadStoryteller(): Promise<boolean> {
  return true;
}

export function storytellerReady(): boolean {
  return true;
}

function b64ToBlob(b64: string, mime: string): Blob {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime || "audio/mpeg" });
}

export function sanitizeNeural(
  neural: string | undefined,
  lang: StoryLang,
  gender: "female" | "male" | "unknown" = "female",
): string {
  const n = neural || "";
  const male = gender === "male";
  if (lang === "zh") {
    if (/^zh-CN-(Xiaoyi|Xiaoxiao|Yunxi|Yunyang|Yunjian)Neural$/.test(n)) return n;
    return male ? "zh-CN-YunxiNeural" : "zh-CN-XiaoyiNeural";
  }
  if (/^en-US-(Jenny|Aria|Guy|Andrew)Neural$/.test(n)) return n;
  return male ? "en-US-GuyNeural" : "en-US-JennyNeural";
}

function isProbablyMp3(blob: Blob): boolean {
  return blob.size > 1200 && /mpeg|mp3|audio/i.test(blob.type || "audio/mpeg");
}

async function clipId(neural: string, pitch: string, rate: number, text: string): Promise<string> {
  const raw = `v3|${neural}|${pitch}|${rate.toFixed(2)}|${text}`;
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  let h = 2166136261;
  for (let i = 0; i < raw.length; i++) h = Math.imul(h ^ raw.charCodeAt(i), 16777619);
  return `h${(h >>> 0).toString(16)}-${raw.length}`;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Storyteller timed out")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function rateToEdge(rate: number): string {
  const pct = Math.round((Math.max(0.6, Math.min(1.8, rate || 1)) - 1) * 100);
  return `${pct >= 0 ? "+" : ""}${pct}%`;
}

async function synthesizeInBrowser(text: string, neural: string, rate: number, pitch: string): Promise<Blob> {
  const bytes = await withTimeout(
    speakEdgeMp3(text, neural, rateToEdge(rate), pitch),
    isNativeApp() ? 8000 : 14000,
  );
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return new Blob([copy], { type: "audio/mpeg" });
}

function desktopSpeak(): LinguaDesktopApi["speak"] | null {
  if (typeof window === "undefined") return null;
  const speak = window.linguaDesktop?.speak;
  return typeof speak === "function" ? speak : null;
}

async function synthesizeOnDesktop(text: string, neural: string, rate: number, pitch: string): Promise<Blob> {
  const speak = desktopSpeak();
  if (!speak) throw new Error("no desktop voice");
  const result = await withTimeout(speak({ text, voice: neural, rate, pitch }), 18000);
  if (!result?.b64) throw new Error("empty desktop voice");
  return b64ToBlob(result.b64, result.mime || "audio/mpeg");
}

function isNativeApp(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  if (cap?.isNativePlatform?.()) return true;
  const href = window.location?.href || "";
  if (href.startsWith("capacitor:") || href.startsWith("file:")) return true;
  const host = window.location?.hostname || "";
  return host === "localhost" && /; wv\)/i.test(navigator.userAgent);
}

async function audioBytes(audio: Blob | ArrayBuffer | Uint8Array): Promise<Uint8Array> {
  if (audio instanceof ArrayBuffer) return new Uint8Array(audio.slice(0));
  if (ArrayBuffer.isView(audio)) {
    const view = new Uint8Array(audio.buffer, audio.byteOffset, audio.byteLength);
    const copy = new Uint8Array(view.byteLength);
    copy.set(view);
    return copy;
  }
  return new Uint8Array(await audio.arrayBuffer());
}

function isSpokenMp3(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 1200) return false;
  const marker = String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0, bytes[2] ?? 0, bytes[3] ?? 0);
  if (marker.startsWith("<") || marker.startsWith("{") || marker === "RIFF" || marker === "OggS") return false;
  let start = 0;
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33 && bytes.byteLength > 10) {
    const size = ((bytes[6]! & 0x7f) << 21) | ((bytes[7]! & 0x7f) << 14) | ((bytes[8]! & 0x7f) << 7) | (bytes[9]! & 0x7f);
    start = Math.min(bytes.byteLength - 2, 10 + size);
  }
  const end = Math.min(bytes.byteLength - 1, start + 8192);
  for (let i = start; i < end; i++) {
    if (bytes[i] === 0xff && ((bytes[i + 1] ?? 0) & 0xe0) === 0xe0) return true;
  }
  return false;
}

async function synthesizeOnAndroid(text: string, neural: string, rate: number, pitch: string): Promise<Blob> {
  const blob = await fetchAndroidStory(text, neural, rateToEdge(rate), pitch);
  const bytes = await audioBytes(blob);
  if (!isSpokenMp3(bytes)) throw new Error("android-voice-unusable");
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy], { type: "audio/mpeg" });
}

function canUseBrowserEdge(): boolean {
  return typeof navigator !== "undefined";
}

function voiceForPage(uri: string | null | undefined, lang: StoryLang): StoryVoice {
  const picked = pickStoryVoice(uri, lang);
  if (picked.lang === lang) return picked;
  if (lang === "zh") return pickStoryVoice(picked.gender === "male" ? `${STORY_PREFIX}shen-yan` : `${STORY_PREFIX}lin-hua`, "zh");
  return pickStoryVoice(picked.gender === "male" ? `${STORY_PREFIX}rowan` : `${STORY_PREFIX}clara`, "en");
}

function fallbackNeurals(voice: StoryVoice, lang: StoryLang): string[] {
  if (lang === "zh") {
    if (voice.gender === "male") {
      return ["zh-CN-YunxiNeural", "zh-CN-YunyangNeural", "zh-CN-XiaoyiNeural", "zh-CN-XiaoxiaoNeural"];
    }
    return ["zh-CN-XiaoyiNeural", "zh-CN-XiaoxiaoNeural", "zh-CN-YunxiNeural"];
  }
  if (voice.gender === "male") return ["en-US-GuyNeural", "en-US-AndrewNeural", "en-US-JennyNeural"];
  return ["en-US-JennyNeural", "en-US-AriaNeural", "en-US-GuyNeural"];
}

async function fetchFastestOnIphone(text: string, neural: string, rate: number, pitch: string): Promise<Blob> {
  const server = withTimeout(
    speakStoryChunk({ data: { text, voice: neural, rate, pitch } }),
    7000,
  ).then((result) => b64ToBlob(result.b64, result.mime));
  const local = synthesizeInBrowser(text, neural, rate, pitch);
  try {
    return await Promise.any([server, local]);
  } catch {
    return server;
  }
}

export class OfflineVoiceError extends Error {
  constructor() {
    super("offline");
    this.name = "OfflineVoiceError";
  }
}

async function fetchClip(text: string, neural: string, rate: number, pitch: string): Promise<Blob> {
  const id = await clipId(neural, pitch, rate, text);
  const cached = await getTtsClip(id);
  if (cached && isProbablyMp3(cached)) return cached;
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new OfflineVoiceError();
  }
  let blob: Blob | null = null;
  const desktop = desktopSpeak();
  if (desktop) {
    blob = await synthesizeOnDesktop(text, neural, rate, pitch);
  } else if (isNativeApp()) {
    blob = await synthesizeInBrowser(text, neural, rate, pitch);
  } else if (isIOS()) {
    blob = await fetchFastestOnIphone(text, neural, rate, pitch);
  } else if (isAndroidChrome()) {
    try {
      blob = await synthesizeInBrowser(text, neural, rate, pitch);
    } catch {
      const result = await withTimeout(
        speakStoryChunk({ data: { text, voice: neural, rate, pitch } }),
        8000,
      );
      blob = b64ToBlob(result.b64, result.mime);
    }
  } else {
    try {
      const result = await withTimeout(
        speakStoryChunk({
          data: { text, voice: neural, rate, pitch },
        }),
        8000,
      );
      blob = b64ToBlob(result.b64, result.mime);
    } catch {
      if (!canUseBrowserEdge()) throw new Error("Could not fetch that voice");
      blob = await synthesizeInBrowser(text, neural, rate, pitch);
    }
  }
  if (blob.size > 1200) await putTtsClip(id, blob);
  return blob;
}

export async function speakWithStoryteller(
  text: string,
  lang: StoryLang,
  uri: string | null | undefined,
  rate: number,
  _extras?: { neural?: string; pitch?: string },
): Promise<Blob> {
  const voice = voiceForPage(uri, lang);
  const neural = sanitizeNeural(voice.neural, voice.lang, voice.gender);
  try {
    return await fetchClip(text, neural, rate, "+0Hz");
  } catch (err) {
    if (err instanceof OfflineVoiceError) throw err;
    toast.error("Could not fetch that voice. Reading with the phone voice for now.");
    throw err instanceof Error ? err : new Error("Could not fetch that voice");
  }
}
