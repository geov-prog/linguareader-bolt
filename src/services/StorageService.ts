import { htmlToText } from "@/services/documents/html";
import { rtfToText } from "@/services/documents/rtf";
import { cleanExtractedText } from "@/services/documents/clean";
import {
  SAMPLE_CHINESE_ID,
  SAMPLE_CHINESE_TEXT,
  SAMPLE_CHINESE_TITLE,
  SAMPLE_WELCOME_ID,
  SAMPLE_WELCOME_TEXT,
  SAMPLE_WELCOME_TITLE,
} from "@/lib/samples";
import { currentVisualSurface, type VisualSurface } from "@/lib/browser";
import { chaptersAt, scanChapters, type ChapterMark } from "@/utils/chapters";
import { splitSentences } from "@/utils/sentences";
import { parseBackupBuffer, parseBackupJson } from "@/services/backupParse";
import {
  decodeAs,
  type ManualEncoding,
} from "@/utils/textNormalization";

const DB_NAME = "linguareader";
const DB_VERSION = 12;
const RESUME_KEY = "linguareader.resume.v1";

export interface DocumentRecord {
  id: string;
  title: string;
  rawText: string;
  encoding: string;
  sourceName: string;
  createdAt: number;
  updatedAt: number;
  sentenceOffset: number;
  sentenceCount: number;
  charCount: number;
  sourceBytes?: ArrayBuffer;
  chapters?: ChapterMark[];
  /** Picture lists and prefaces from an EPUB. Not read aloud. */
  frontPages?: { title: string; html: string }[];
  /** When the reader last opened this book. Not the same as a progress save. */
  lastOpenedAt?: number;
  /** Latest resume or progress time. 0 means this book has not been read. */
  lastReadAt?: number;
}

export interface StoredVoice {
  id: string;
  name: string;
  mime: string;
  blob: Blob;
  createdAt: number;
  /** Phone voice that reads books offline. Empty means play the recording itself. */
  offlineReadURI?: string;
}

export type ReadingTheme = "paper" | "night";
export type FontFamilyId = "serif" | "sans" | "kai" | "song";
export type AccentId = "pine" | "clay" | "indigo" | "plum";
export type WallpaperId = "none" | "linen" | "moss" | "dusk" | "ink" | "custom";
export type ControlSizeId = "compact" | "comfortable" | "large";
export type HandId = "right" | "left";

export type AiProvider = "google" | "groq" | "grok" | "none";

export interface AppSettings {
  theme: ReadingTheme;
  fontSize: number;
  rate: number;
  pitch: number;
  voiceURI: string | null;
  lastActiveId: string | null;
  rolesEnabled: boolean;
  fontFamily: FontFamilyId;
  accent: AccentId;
  wallpaper: WallpaperId;
  controlSize: ControlSizeId;
  focusMode: boolean;
  hideChromeWhileReading: boolean;
  autoFollowHighlight: boolean;
  hand: HandId;
  aiProvider: AiProvider;
  aiApiKey: string;
  aiSelectedModel: string;
}

interface MetaRecord {
  key: string;
  value: unknown;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "paper",
  fontSize: 22,
  rate: 1,
  pitch: 1,
  voiceURI: null,
  lastActiveId: null,
  rolesEnabled: false,
  fontFamily: "serif",
  accent: "pine",
  wallpaper: "none",
  controlSize: "comfortable",
  focusMode: false,
  hideChromeWhileReading: false,
  autoFollowHighlight: true,
  hand: "right",
  aiProvider: "none",
  aiApiKey: "",
  aiSelectedModel: "",
};

export interface ProgressRecord {
  documentId: string;
  sentenceOffset: number;
  sentenceCount: number;
  title: string;
  updatedAt: number;
}

export interface ResumeSnapshot {
  documentId: string;
  title: string;
  sentenceOffset: number;
  sentenceCount: number;
  savedAt: number;
}

export interface PackedBlob {
  mime: string;
  b64: string;
  bytes: number;
}

export interface PackedTtsClip {
  id: string;
  mime: string;
  b64: string;
  bytes: number;
  touchedAt: number;
}

export interface PackedVoice {
  id: string;
  name: string;
  mime: string;
  b64: string;
  createdAt: number;
  bytes: number;
  offlineReadURI?: string;
}

export interface LibraryBackup {
  app: "LinguaReader";
  version: 1 | 2 | 3;
  kind?: "linguareader.full-backup";
  exportedAt: number;
  documents: DocumentRecord[];
  settings: AppSettings;
  settingsDesktop?: AppSettings;
  settingsMobile?: AppSettings;
  digest: string;
  progress?: ProgressRecord[];
  resume?: ResumeSnapshot | null;
  casts?: unknown[];
  voiceBank?: VoiceBankRecord[];
  voices?: PackedVoice[];
  wallpaper?: PackedBlob | null;
  ttsClips?: PackedTtsClip[];
}

function requireIndexedDb(): IDBFactory {
  if (typeof indexedDB === "undefined") {
    throw new Error("IndexedDB is not available in this browser.");
  }
  return indexedDB;
}

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;

function ensureStores(db: IDBDatabase): void {
  if (!db.objectStoreNames.contains("documents")) {
    const store = db.createObjectStore("documents", { keyPath: "id" });
    store.createIndex("updatedAt", "updatedAt");
  }
  if (!db.objectStoreNames.contains("meta")) {
    db.createObjectStore("meta", { keyPath: "key" });
  }
  if (!db.objectStoreNames.contains("voices")) {
    db.createObjectStore("voices", { keyPath: "id" });
  }
  if (!db.objectStoreNames.contains("progress")) {
    db.createObjectStore("progress", { keyPath: "documentId" });
  }
  if (!db.objectStoreNames.contains("ttsCache")) {
    const tts = db.createObjectStore("ttsCache", { keyPath: "id" });
    tts.createIndex("touchedAt", "touchedAt");
  }
  if (db.objectStoreNames.contains("casts")) db.deleteObjectStore("casts");
  if (db.objectStoreNames.contains("mixPresets")) db.deleteObjectStore("mixPresets");
}

function openAt(version?: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = version == null ? requireIndexedDb().open(DB_NAME) : requireIndexedDb().open(DB_NAME, version);
    req.onupgradeneeded = () => {
      try {
        ensureStores(req.result);
      } catch (err) {
        reject(err instanceof Error ? err : new Error("Could not upgrade the local library."));
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Failed to open LinguaReader database"));
    req.onblocked = () => {
      /* another tab holds the old connection — wait for onsuccess */
    };
  });
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) {
    return dbPromise.then((db) => {
      if (db.version >= DB_VERSION) return db;
      try {
        db.close();
      } catch {
        /* ignore */
      }
      dbPromise = null;
      return openDb();
    });
  }
  dbPromise = (async () => {
    let db: IDBDatabase;
    try {
      db = await openAt(DB_VERSION);
    } catch (err) {
      const name = err instanceof DOMException ? err.name : err instanceof Error ? err.name : "";
      if (name !== "VersionError") throw err;
      db = await openAt();
    }
    return db;
  })().catch((err) => {
    dbPromise = null;
    throw err;
  });
  return dbPromise;
}

async function getMeta<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  const value = await requestToPromise(
    db.transaction("meta").objectStore("meta").get(key),
  );
  return (value as MetaRecord | undefined)?.value as T | undefined;
}

async function setMeta(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  const tx = db.transaction("meta", "readwrite");
  tx.objectStore("meta").put({ key, value } satisfies MetaRecord);
  await txDone(tx);
}

export function readLocalResume(): ResumeSnapshot | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(RESUME_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ResumeSnapshot;
    if (!parsed?.documentId || typeof parsed.sentenceOffset !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeLocalResume(snap: ResumeSnapshot): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(RESUME_KEY, JSON.stringify(snap));
  } catch {
    // Private mode or quota — IndexedDB still tries.
  }
}

export function clearLocalResume(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(RESUME_KEY);
  } catch {
    /* ignore */
  }
}

async function allProgress(): Promise<Map<string, ProgressRecord>> {
  const db = await openDb();
  if (!db.objectStoreNames.contains("progress")) return new Map();
  const rows = await requestToPromise(
    db.transaction("progress").objectStore("progress").getAll(),
  );
  const map = new Map<string, ProgressRecord>();
  for (const row of rows as ProgressRecord[]) {
    if (row?.documentId) map.set(row.documentId, row);
  }
  return map;
}

export async function getProgressOffset(id: string): Promise<number> {
  const marks = await allProgress();
  return marks.get(id)?.sentenceOffset ?? 0;
}

function withProgress(doc: DocumentRecord, mark: ProgressRecord | undefined): DocumentRecord {
  if (!mark) return doc;
  return {
    ...doc,
    sentenceOffset: Math.min(Math.max(0, mark.sentenceOffset), Math.max(0, doc.sentenceCount - 1)),
  };
}

export function encodeUtf8Bytes(text: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(text);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function extractBookName(text: string): string | null {
  const named = text.match(/书名\s*[:：]\s*([^\n]{1,60})/);
  if (!named?.[1]) return null;
  const name = named[1]
    .replace(/作者\s*[:：].*$/, "")
    .replace(/[《》「」『』【】\[\]]/g, "")
    .trim();
  return name.length >= 1 && name.length <= 40 ? name : null;
}

function isUsefulTitle(title: string): boolean {
  const t = title.trim();
  if (t.length < 2 || t.length > 80) return false;
  if (/^https?:\/\//i.test(t)) return false;
  const letters = (t.match(/[\p{L}\p{N}]/gu) ?? []).length;
  if (letters < 2) return false;
  if (/^[=#*\-_~—–.]{4,}/.test(t)) return false;
  return true;
}

export function polishTitle(title: string | undefined, rawText: string, fallback: string): string {
  const named = extractBookName(title || "") || extractBookName(rawText.slice(0, 12_000));
  if (named) return named;
  if (title && isUsefulTitle(title)) {
    return title.trim().length > 72 ? `${title.trim().slice(0, 69).trimEnd()}…` : title.trim();
  }
  return deriveTitle(rawText, fallback);
}

export function deriveTitle(rawText: string, fallback: string): string {
  const named = extractBookName(rawText.slice(0, 12_000));
  if (named) return named;
  const lines = rawText.split(/\r?\n/);
  for (let i = 0; i < Math.min(lines.length, 80); i++) {
    const line = lines[i]!.replace(/^#+\s*/, "").trim();
    if (!isUsefulTitle(line)) continue;
    return line.length > 72 ? `${line.slice(0, 69).trimEnd()}…` : line;
  }
  const stem = fallback.replace(/\.[^.]+$/, "").trim();
  return stem || "Untitled";
}

export function buildDocument(input: {
  id?: string;
  title?: string;
  rawText: string;
  encoding: string;
  sourceName: string;
  createdAt?: number;
  sentenceOffset?: number;
  sourceBytes?: ArrayBuffer;
  chapters?: { title: string; charOffset: number }[];
  frontPages?: { title: string; html: string }[];
}): DocumentRecord {
  const now = Date.now();
  const sentences = splitSentences(input.rawText);
  return {
    id: input.id ?? crypto.randomUUID(),
    title: polishTitle(input.title, input.rawText, input.sourceName),
    rawText: input.rawText,
    encoding: input.encoding,
    sourceName: input.sourceName,
    createdAt: input.createdAt ?? now,
    updatedAt: now,
    sentenceOffset: Math.min(input.sentenceOffset ?? 0, Math.max(0, sentences.length - 1)),
    sentenceCount: sentences.length,
    charCount: input.rawText.length,
    chapters: input.chapters ? chaptersAt(input.chapters, sentences, input.rawText) : scanChapters(input.rawText, sentences),
    frontPages: input.frontPages,
    sourceBytes: input.sourceBytes,
  };
}

async function blobToPacked(blob: Blob): Promise<PackedBlob> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return {
    mime: blob.type || "application/octet-stream",
    b64: btoa(binary),
    bytes: bytes.length,
  };
}

function packedToBlob(packed: PackedBlob): Blob {
  const binary = atob(packed.b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: packed.mime || "application/octet-stream" });
}

async function listCasts(): Promise<unknown[]> {
  const db = await openDb();
  if (!db.objectStoreNames.contains("casts")) return [];
  return requestToPromise(db.transaction("casts").objectStore("casts").getAll()) as Promise<unknown[]>;
}

function canonicalBackupV2(parts: {
  documents: DocumentRecord[];
  settings: AppSettings;
  progress: ProgressRecord[];
  resume: ResumeSnapshot | null;
  casts: unknown[];
  voiceBank: VoiceBankRecord[];
  voiceIds: string[];
  wallpaperBytes: number;
}): string {
  return JSON.stringify({
    documents: canonicalDocuments(parts.documents),
    settings: parts.settings,
    progress: [...parts.progress].sort((a, b) => a.documentId.localeCompare(b.documentId)),
    resume: parts.resume,
    casts: parts.casts,
    voiceBank: parts.voiceBank,
    voiceIds: [...parts.voiceIds].sort(),
    wallpaperBytes: parts.wallpaperBytes,
  });
}

function canonicalBackupV3(parts: {
  documents: DocumentRecord[];
  settings: AppSettings;
  settingsDesktop: AppSettings;
  settingsMobile: AppSettings;
  progress: ProgressRecord[];
  resume: ResumeSnapshot | null;
  casts: unknown[];
  voiceBank: VoiceBankRecord[];
  voiceIds: string[];
  wallpaperBytes: number;
  ttsClipIds?: string[];
}): string {
  const body: Record<string, unknown> = {
    documents: canonicalDocuments(parts.documents),
    settings: parts.settings,
    settingsDesktop: parts.settingsDesktop,
    settingsMobile: parts.settingsMobile,
    progress: [...parts.progress].sort((a, b) => a.documentId.localeCompare(b.documentId)),
    resume: parts.resume,
    casts: parts.casts,
    voiceBank: parts.voiceBank,
    voiceIds: [...parts.voiceIds].sort(),
    wallpaperBytes: parts.wallpaperBytes,
  };
  if (parts.ttsClipIds) body.ttsClipIds = [...parts.ttsClipIds].sort();
  return JSON.stringify(body);
}

async function sha256Hex(text: string): Promise<string> {
  const encoded = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function canonicalDocuments(documents: DocumentRecord[]): string {
  const rows = [...documents]
    .map((d) => ({
      id: d.id,
      title: d.title,
      rawText: d.rawText,
      encoding: d.encoding,
      sourceName: d.sourceName,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      sentenceOffset: d.sentenceOffset,
      sentenceCount: d.sentenceCount,
      charCount: d.charCount,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify(rows);
}

export async function listDocuments(): Promise<DocumentRecord[]> {
  const db = await openDb();
  const rows = await requestToPromise(
    db.transaction("documents").objectStore("documents").getAll(),
  );
  const marks = await allProgress();
  const local = readLocalResume();
  return (rows as DocumentRecord[])
    .map((doc) => {
      const mark = marks.get(doc.id);
      const fromLocal =
        local?.documentId === doc.id
          ? { sentenceOffset: local.sentenceOffset, sentenceCount: local.sentenceCount, documentId: doc.id, title: local.title, updatedAt: local.savedAt }
          : undefined;
      const newer =
        fromLocal && (!mark || fromLocal.updatedAt >= mark.updatedAt) ? fromLocal : mark;
      const withMark = withProgress(doc, newer);
      const titled = polishTitle(withMark.title, withMark.rawText, withMark.sourceName);
      const chapters = withMark.chapters ?? scanChapters(withMark.rawText);
      const next = { ...withMark, title: titled, chapters };
      if (titled !== withMark.title || !withMark.chapters) void putDocument(next);
      const lastReadAt = Math.max(
        local?.documentId === doc.id && typeof local.savedAt === "number" ? local.savedAt : 0,
        typeof mark?.updatedAt === "number" ? mark.updatedAt : 0,
      );
      return { ...next, lastReadAt };
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export type LibrarySortMode = "recent" | "title" | "progress" | "lastRead";

function readPercent(doc: DocumentRecord): number {
  if (!doc.sentenceCount) return 0;
  return doc.sentenceOffset / doc.sentenceCount;
}

/** Library order only. Does not write books or move the reading place. */
export function sortLibraryDocuments(docs: DocumentRecord[], mode: LibrarySortMode): DocumentRecord[] {
  const next = docs.slice();
  if (mode === "title") {
    next.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base", numeric: true }));
    return next;
  }
  if (mode === "progress") {
    next.sort((a, b) => readPercent(b) - readPercent(a) || a.title.localeCompare(b.title, undefined, { sensitivity: "base", numeric: true }));
    return next;
  }
  if (mode === "lastRead") {
    next.sort((a, b) => (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0) || a.title.localeCompare(b.title, undefined, { sensitivity: "base", numeric: true }));
    return next;
  }
  next.sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt);
  return next;
}

export async function getDocument(id: string): Promise<DocumentRecord | undefined> {
  const db = await openDb();
  const row = await requestToPromise(db.transaction("documents").objectStore("documents").get(id));
  if (!row) return undefined;
  const marks = await allProgress();
  const local = readLocalResume();
  const mark = marks.get(id);
  const fromLocal =
    local?.documentId === id
      ? {
          sentenceOffset: local.sentenceOffset,
          sentenceCount: local.sentenceCount,
          documentId: id,
          title: local.title,
          updatedAt: local.savedAt,
        }
      : undefined;
  const newer = fromLocal && (!mark || fromLocal.updatedAt >= mark.updatedAt) ? fromLocal : mark;
  const doc = withProgress(row as DocumentRecord, newer);
  if (doc.chapters) return doc;
  const next = { ...doc, chapters: scanChapters(doc.rawText) };
  void putDocument(next);
  return next;
}

export async function putDocument(doc: DocumentRecord): Promise<void> {
  const db = await openDb();
  const tx = db.transaction("documents", "readwrite");
  tx.objectStore("documents").put(doc);
  await txDone(tx);
}

/** Same clock as the startup resume prompt. Does not move the saved page. */
export async function markBookOpened(id: string): Promise<void> {
  const existing = await getDocument(id);
  if (!existing) return;
  await updateProgress(existing.id, existing.sentenceOffset, {
    title: existing.title,
    sentenceCount: existing.sentenceCount,
  });
}

export async function deleteDocument(id: string): Promise<void> {
  const db = await openDb();
  const stores = ["documents"];
  if (db.objectStoreNames.contains("progress")) stores.push("progress");
  const tx = db.transaction(stores, "readwrite");
  tx.objectStore("documents").delete(id);
  if (stores.includes("progress")) tx.objectStore("progress").delete(id);
  await txDone(tx);
  const local = readLocalResume();
  if (local?.documentId === id) clearLocalResume();
}

export async function renameDocument(id: string, title: string): Promise<DocumentRecord | undefined> {
  const existing = await getDocument(id);
  if (!existing) return;
  const next: DocumentRecord = {
    ...existing,
    title: title.trim() || existing.title,
    updatedAt: Date.now(),
  };
  await putDocument(next);
  return next;
}

export async function redecodeDocument(id: string, encoding: ManualEncoding): Promise<DocumentRecord> {
  const existing = await getDocument(id);
  if (!existing?.sourceBytes) {
    throw new Error("This file was converted from a binary format, so its encoding cannot be switched.");
  }
  const decoded = decodeAs(existing.sourceBytes, encoding);
  let text = decoded.text;
  if (/\.rtf$/i.test(existing.sourceName) || text.trimStart().startsWith("{\\rtf")) {
    text = rtfToText(text);
  } else if (/\.html?$/i.test(existing.sourceName) || /<html[\s>]/i.test(text.slice(0, 512))) {
    text = htmlToText(text);
  }
  text = cleanExtractedText(text);
  if (!text) throw new Error("That encoding produced no readable text. Try UTF-8 or GB18030.");
  const next = buildDocument({
    id: existing.id,
    title: existing.title,
    rawText: text,
    encoding: decoded.encoding,
    sourceName: existing.sourceName,
    createdAt: existing.createdAt,
    sentenceOffset: existing.sentenceOffset,
    sourceBytes: existing.sourceBytes,
  });
  await putDocument(next);
  return next;
}

export async function updateDocumentText(id: string, rawText: string): Promise<DocumentRecord> {
  const existing = await getDocument(id);
  if (!existing) throw new Error("That page is no longer in the library.");
  const text = rawText.replace(/\r\n/g, "\n");
  if (!text.trim()) throw new Error("The page is empty. Write something, or delete the file instead.");
  const next = buildDocument({
    id: existing.id,
    title: existing.title,
    rawText: text,
    encoding: "utf-8",
    sourceName: existing.sourceName,
    createdAt: existing.createdAt,
    sentenceOffset: existing.sentenceOffset,
    sourceBytes: encodeUtf8Bytes(text),
  });
  await putDocument(next);
  return next;
}

export async function listVoicesStored(): Promise<StoredVoice[]> {
  const db = await openDb();
  const rows = await requestToPromise(db.transaction("voices").objectStore("voices").getAll());
  return (rows as StoredVoice[]).sort((a, b) => b.createdAt - a.createdAt);
}

export async function putVoice(voice: StoredVoice): Promise<void> {
  const db = await openDb();
  const tx = db.transaction("voices", "readwrite");
  tx.objectStore("voices").put(voice);
  await txDone(tx);
}

export async function getVoice(id: string): Promise<StoredVoice | undefined> {
  const db = await openDb();
  return requestToPromise(db.transaction("voices").objectStore("voices").get(id));
}

export async function deleteVoice(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction("voices", "readwrite");
  tx.objectStore("voices").delete(id);
  await txDone(tx);
}

export interface TtsClipRecord {
  id: string;
  blob: Blob;
  mime: string;
  bytes: number;
  touchedAt: number;
}

export async function getTtsClip(id: string): Promise<Blob | null> {
  const db = await openDb();
  if (!db.objectStoreNames.contains("ttsCache")) return null;
  const row = (await requestToPromise(
    db.transaction("ttsCache").objectStore("ttsCache").get(id),
  )) as TtsClipRecord | undefined;
  if (!row?.blob) return null;
  void touchTtsClip(id);
  return row.blob;
}

export async function clearStaleTtsCache(): Promise<void> {
  return;
}

export async function clearTtsCache(): Promise<void> {
  const db = await openDb();
  if (!db.objectStoreNames.contains("ttsCache")) return;
  const tx = db.transaction("ttsCache", "readwrite");
  tx.objectStore("ttsCache").clear();
  await txDone(tx);
}

async function touchTtsClip(id: string): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction("ttsCache", "readwrite");
    const store = tx.objectStore("ttsCache");
    const row = (await requestToPromise(store.get(id))) as TtsClipRecord | undefined;
    if (!row) return;
    store.put({ ...row, touchedAt: Date.now() });
    await txDone(tx);
  } catch {
    /* ignore */
  }
}

export async function putTtsClip(id: string, blob: Blob): Promise<void> {
  const db = await openDb();
  if (!db.objectStoreNames.contains("ttsCache")) return;
  try {
    const tx = db.transaction("ttsCache", "readwrite");
    tx.objectStore("ttsCache").put({
      id,
      blob,
      mime: blob.type || "audio/mpeg",
      bytes: blob.size,
      touchedAt: Date.now(),
    } satisfies TtsClipRecord);
    await txDone(tx);
  } catch {
    /* keep the clip that is already playing; do not drop saved lines */
  }
}

export async function listTtsClipsPacked(): Promise<PackedTtsClip[]> {
  const db = await openDb();
  if (!db.objectStoreNames.contains("ttsCache")) return [];
  const rows = (await requestToPromise(db.transaction("ttsCache").objectStore("ttsCache").getAll())) as TtsClipRecord[];
  const packed: PackedTtsClip[] = [];
  for (const row of rows) {
    if (!row?.id || !row.blob) continue;
    const clip = await blobToPacked(row.blob);
    packed.push({
      id: row.id,
      mime: clip.mime || row.mime || "audio/mpeg",
      b64: clip.b64,
      bytes: clip.bytes,
      touchedAt: row.touchedAt || Date.now(),
    });
  }
  return packed;
}

export async function restoreTtsClips(clips: PackedTtsClip[]): Promise<number> {
  let count = 0;
  for (const clip of clips) {
    if (!clip?.id || !clip.b64) continue;
    await putTtsClip(clip.id, packedToBlob({ mime: clip.mime, b64: clip.b64, bytes: clip.bytes }));
    count += 1;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return count;
}

export async function getCast<T = unknown>(documentId: string): Promise<T | undefined> {
  const db = await openDb();
  if (!db.objectStoreNames.contains("casts")) return undefined;
  return requestToPromise(db.transaction("casts").objectStore("casts").get(documentId)) as Promise<T | undefined>;
}

export async function putCast(cast: { documentId: string }): Promise<void> {
  const db = await openDb();
  if (!db.objectStoreNames.contains("casts")) return;
  const tx = db.transaction("casts", "readwrite");
  tx.objectStore("casts").put(cast);
  await txDone(tx);
}

export interface MixPresetRecord {
  id: string;
  documentId: string;
  narratorUri: string;
  narratorLabel: string;
  language: "zh" | "en";
  roles: unknown[];
  updatedAt: number;
}

export function mixPresetId(documentId: string, narratorUri: string): string {
  return `${documentId}::${narratorUri}`;
}

export const STORYTELLER_CATALOG = [
  { id: "lin-hua", uri: "story:lin-hua", name: "林华", lang: "zh", gender: "female", hint: "Female · Chinese novels" },
  { id: "shen-yan", uri: "story:shen-yan", name: "沈言", lang: "zh", gender: "male", hint: "Male · Chinese novels" },
  { id: "clara", uri: "story:clara", name: "Clara", lang: "en", gender: "female", hint: "Female · English novels" },
  { id: "rowan", uri: "story:rowan", name: "Rowan", lang: "en", gender: "male", hint: "Male · English novels" },
] as const;

export async function getMixPreset(documentId: string, narratorUri: string): Promise<MixPresetRecord | undefined> {
  const db = await openDb();
  if (!db.objectStoreNames.contains("mixPresets")) return undefined;
  return requestToPromise(
    db.transaction("mixPresets").objectStore("mixPresets").get(mixPresetId(documentId, narratorUri)),
  ) as Promise<MixPresetRecord | undefined>;
}

export async function putMixPreset(preset: MixPresetRecord): Promise<void> {
  const db = await openDb();
  if (!db.objectStoreNames.contains("mixPresets")) return;
  const tx = db.transaction("mixPresets", "readwrite");
  tx.objectStore("mixPresets").put(preset);
  await txDone(tx);
}

export async function listMixPresets(documentId?: string): Promise<MixPresetRecord[]> {
  const db = await openDb();
  if (!db.objectStoreNames.contains("mixPresets")) return [];
  const store = db.transaction("mixPresets").objectStore("mixPresets");
  if (documentId && store.indexNames.contains("documentId")) {
    return requestToPromise(store.index("documentId").getAll(documentId)) as Promise<MixPresetRecord[]>;
  }
  const all = (await requestToPromise(store.getAll())) as MixPresetRecord[];
  return documentId ? all.filter((row) => row.documentId === documentId) : all;
}

export async function deleteMixPresets(documentId?: string): Promise<number> {
  const db = await openDb();
  if (!db.objectStoreNames.contains("mixPresets")) return 0;
  const rows = await listMixPresets(documentId);
  if (!rows.length) return 0;
  const tx = db.transaction("mixPresets", "readwrite");
  const store = tx.objectStore("mixPresets");
  for (const row of rows) store.delete(row.id);
  await txDone(tx);
  return rows.length;
}

export async function exportMixPack(documentId?: string): Promise<Blob> {
  const presets = await listMixPresets(documentId);
  const payload = {
    app: "LinguaReader",
    kind: "linguareader.mix-pack",
    version: 2,
    savedAt: new Date().toISOString(),
    exportedAt: Date.now(),
    storytellers: STORYTELLER_CATALOG,
    presets,
  };
  return new Blob([JSON.stringify(payload)], { type: "application/json" });
}

export async function importMixPack(raw: string): Promise<{ count: number }> {
  let parsed: unknown;
  try {
    parsed = await parseBackupJson(raw);
  } catch {
    throw new Error("That file is not a mix pack.");
  }
  const data = parsed as { kind?: string; presets?: MixPresetRecord[] };
  const incoming = Array.isArray(data.presets) ? data.presets : [];
  if (!incoming.length) throw new Error("That file has no saved mixes.");
  const db = await openDb();
  if (!db.objectStoreNames.contains("mixPresets")) throw new Error("This copy of the app cannot store mix packs yet.");
  const tx = db.transaction("mixPresets", "readwrite");
  const store = tx.objectStore("mixPresets");
  let count = 0;
  for (const row of incoming) {
    if (!row?.documentId || !row?.narratorUri || !Array.isArray(row.roles)) continue;
    store.put({
      id: row.id || mixPresetId(row.documentId, row.narratorUri),
      documentId: row.documentId,
      narratorUri: row.narratorUri,
      narratorLabel: row.narratorLabel || "Narrator",
      language: row.language === "en" ? "en" : "zh",
      roles: row.roles,
      updatedAt: Date.now(),
    } satisfies MixPresetRecord);
    count += 1;
  }
  await txDone(tx);
  return { count };
}

export type TypedBackupKind = "settings" | "library" | "voices" | "mix-pack" | "full";

export interface MixPackOption {
  id: string;
  documentId: string;
  bookTitle: string;
  narratorUri: string;
  narratorLabel: string;
  roleCount: number;
  updatedAt: number;
}

export async function listMixPackOptions(documentId?: string): Promise<MixPackOption[]> {
  const presets = await listMixPresets(documentId);
  const docs = await listDocuments();
  const titles = new Map(docs.map((doc) => [doc.id, doc.title]));
  return presets
    .filter((row) => Array.isArray(row.roles) && row.roles.length > 0)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((row) => ({
      id: row.id,
      documentId: row.documentId,
      bookTitle: titles.get(row.documentId) || "Book",
      narratorUri: row.narratorUri,
      narratorLabel: row.narratorLabel || "Narrator",
      roleCount: Array.isArray(row.roles) ? row.roles.length : 0,
      updatedAt: row.updatedAt,
    }));
}

export interface TypedBackupMeta {
  name: string;
  savedAt: number;
  bytes: number;
}

export type TypedBackupSlots = Partial<Record<"settings" | "library" | "voices" | "mix-pack", TypedBackupMeta>>;

function backupBlobKey(kind: "settings" | "library" | "voices" | "mix-pack"): string {
  return `lastBackupBlob:${kind}`;
}

function backupMetaKey(kind: "settings" | "library" | "voices" | "mix-pack"): string {
  return `lastBackupMeta:${kind}`;
}

export async function rememberTypedBackup(
  kind: "settings" | "library" | "voices" | "mix-pack",
  blob: Blob,
  name: string,
): Promise<void> {
  try {
    await setMeta(backupMetaKey(kind), { name, savedAt: Date.now(), bytes: blob.size } satisfies TypedBackupMeta);
    const db = await openDb();
    if (!db.objectStoreNames.contains("meta")) return;
    const tx = db.transaction("meta", "readwrite");
    tx.objectStore("meta").put({ key: backupBlobKey(kind), value: blob } satisfies MetaRecord);
    await txDone(tx);
  } catch {
    /* quota */
  }
}

export async function getTypedBackupSlots(): Promise<TypedBackupSlots> {
  const [settings, library, voices, mix] = await Promise.all([
    getMeta<TypedBackupMeta>(backupMetaKey("settings")),
    getMeta<TypedBackupMeta>(backupMetaKey("library")),
    getMeta<TypedBackupMeta>(backupMetaKey("voices")),
    getMeta<TypedBackupMeta>(backupMetaKey("mix-pack")),
  ]);
  const slots: TypedBackupSlots = {};
  if (settings?.savedAt) slots.settings = settings;
  if (library?.savedAt) slots.library = library;
  if (voices?.savedAt) slots.voices = voices;
  if (mix?.savedAt) slots["mix-pack"] = mix;
  const legacy = await getLastBackupMeta();
  if (legacy && !slots.library) slots.library = legacy;
  return slots;
}

export async function restoreTypedBackup(kind: "settings" | "library" | "voices" | "mix-pack"): Promise<{ kind: TypedBackupKind; count: number; label: string } | null> {
  const db = await openDb();
  const row = await requestToPromise(db.transaction("meta").objectStore("meta").get(backupBlobKey(kind)));
  let blob = (row as MetaRecord | undefined)?.value;
  if (!(blob instanceof Blob) && kind === "library") {
    const legacy = await requestToPromise(db.transaction("meta").objectStore("meta").get("lastBackupBlob"));
    blob = (legacy as MetaRecord | undefined)?.value;
  }
  if (!(blob instanceof Blob)) return null;
  return importTypedBackupBuffer(await blob.arrayBuffer());
}

export async function clearTypedBackups(): Promise<void> {
  const db = await openDb();
  if (!db.objectStoreNames.contains("meta")) return;
  const tx = db.transaction("meta", "readwrite");
  const store = tx.objectStore("meta");
  for (const kind of ["settings", "library", "voices", "mix-pack"] as const) {
    store.delete(backupBlobKey(kind));
    store.delete(backupMetaKey(kind));
  }
  store.delete("lastBackupBlob");
  store.delete("lastBackupMeta");
  await txDone(tx);
}

export async function exportSettingsBackup(): Promise<Blob> {
  const settings = await getSettings();
  const surfaces = await getBothSurfaceSettings();
  const wallpaperBlob = await getWallpaper();
  const wallpaper = wallpaperBlob ? await blobToPacked(wallpaperBlob) : null;
  const payload = {
    app: "LinguaReader",
    kind: "linguareader.settings",
    version: 3,
    exportedAt: Date.now(),
    settings,
    settingsDesktop: surfaces.desktop,
    settingsMobile: surfaces.mobile,
    wallpaper,
    storytellers: STORYTELLER_CATALOG,
  };
  return new Blob([JSON.stringify(payload)], { type: "application/json" });
}

export async function exportLibraryBackup(): Promise<{ blob: Blob; digest: string }> {
  const documents = await listDocuments();
  const serializable = documents.map(({ sourceBytes: _bytes, ...rest }) => rest);
  const progress = [...(await allProgress()).values()];
  const resume = readLocalResume();
  const digest = await sha256Hex(
    JSON.stringify({
      documents: canonicalDocuments(serializable),
      progress: [...progress].sort((a, b) => a.documentId.localeCompare(b.documentId)),
      resume,
    }),
  );
  const payload = {
    app: "LinguaReader",
    kind: "linguareader.library",
    version: 1,
    exportedAt: Date.now(),
    documents: serializable,
    progress,
    resume,
    digest,
  };
  return { blob: new Blob([JSON.stringify(payload)], { type: "application/json" }), digest };
}

export async function exportVoicesBackup(): Promise<Blob> {
  const ttsClips = await listTtsClipsPacked();
  const payload = {
    app: "LinguaReader",
    kind: "linguareader.voices",
    version: 1,
    exportedAt: Date.now(),
    storytellers: ["林华", "沈言", "Clara", "Rowan"],
    ttsClips,
  };
  return new Blob([JSON.stringify(payload)], { type: "application/json" });
}

export async function importVoicesBackup(raw: string | unknown): Promise<{ count: number }> {
  let parsed: unknown;
  try {
    parsed = typeof raw === "string" ? await parseBackupJson(raw) : raw;
  } catch {
    throw new Error("That file is not a voice backup.");
  }
  const data = parsed as { kind?: string; ttsClips?: PackedTtsClip[] };
  if (data.kind && data.kind !== "linguareader.voices" && data.kind !== "linguareader.full-backup") {
    throw new Error("That file is not a voice backup.");
  }
  const clips = Array.isArray(data.ttsClips) ? data.ttsClips : [];
  const count = await restoreTtsClips(clips);
  return { count };
}

export async function inspectBackup(raw: string): Promise<{ kind: TypedBackupKind; label: string } | null> {
  try {
    return classifyParsed(await parseBackupJson(raw));
  } catch {
    return null;
  }
}

function classifyParsed(parsed: unknown): { kind: TypedBackupKind; label: string } | null {
  if (!parsed || typeof parsed !== "object") return null;
  const data = parsed as { app?: string; kind?: string; documents?: unknown; settings?: unknown; presets?: unknown };
  if (data.app && data.app !== "LinguaReader") return null;
  if (data.kind === "linguareader.settings") return { kind: "settings", label: "App settings" };
  if (data.kind === "linguareader.library") return { kind: "library", label: "Library of books" };
  if (data.kind === "linguareader.voices") return { kind: "voices", label: "Storyteller voices" };
  if (data.kind === "linguareader.mix-pack" || Array.isArray(data.presets)) return { kind: "mix-pack", label: "Old mix packs" };
  if (data.kind === "linguareader.full-backup") return { kind: "full", label: "Older full backup" };
  if (Array.isArray(data.documents) && data.app === "LinguaReader") return { kind: "full", label: "Older full backup" };
  if (data.settings && typeof data.settings === "object" && data.app === "LinguaReader") {
    return { kind: "settings", label: "App settings" };
  }
  return null;
}

export async function importSettingsBackup(raw: string | unknown): Promise<{ count: number }> {
  let parsed: unknown;
  try {
    parsed = typeof raw === "string" ? await parseBackupJson(raw) : raw;
  } catch {
    throw new Error("That file is not app settings.");
  }
  const data = parsed as {
    kind?: string;
    settings?: Partial<AppSettings>;
    settingsDesktop?: Partial<AppSettings>;
    settingsMobile?: Partial<AppSettings>;
    wallpaper?: PackedBlob | null;
  };
  if (data.kind && data.kind !== "linguareader.settings") {
    throw new Error("That file is not app settings.");
  }
  if (!data.settings || typeof data.settings !== "object") {
    throw new Error("That file has no settings.");
  }
  const desktop = { ...DEFAULT_SETTINGS, ...(data.settingsDesktop || data.settings) };
  const mobile = { ...DEFAULT_SETTINGS, ...(data.settingsMobile || data.settings) };
  await setMeta("settingsDesktop", desktop);
  await setMeta("settingsMobile", mobile);
  const active = currentVisualSurface() === "desktop" ? desktop : mobile;
  await setMeta("settings", active);
  if (data.wallpaper?.b64) {
    await putWallpaper(packedToBlob(data.wallpaper));
  }
  return { count: 1 };
}

async function yieldTick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function putRestoredDocuments(docs: DocumentRecord[]): Promise<number> {
  const db = await openDb();
  const clearTx = db.transaction("documents", "readwrite");
  clearTx.objectStore("documents").clear();
  await txDone(clearTx);
  let count = 0;
  for (const doc of docs) {
    if (!doc?.id || typeof doc.rawText !== "string") continue;
    const built = {
      ...buildDocument({
        id: doc.id,
        title: doc.title,
        rawText: doc.rawText,
        encoding: doc.encoding || "utf-8",
        sourceName: doc.sourceName || "backup.json",
        createdAt: doc.createdAt,
        sentenceOffset: doc.sentenceOffset,
      }),
      updatedAt: doc.updatedAt || Date.now(),
    };
    const tx = db.transaction("documents", "readwrite");
    tx.objectStore("documents").put(built);
    await txDone(tx);
    count += 1;
    await yieldTick();
  }
  return count;
}

async function replaceLibrary(
  docs: DocumentRecord[],
  progress: ProgressRecord[],
  resume: ResumeSnapshot | null | undefined,
): Promise<number> {
  const count = await putRestoredDocuments(docs);
  const db = await openDb();
  if (db.objectStoreNames.contains("progress")) {
    const clearTx = db.transaction("progress", "readwrite");
    clearTx.objectStore("progress").clear();
    await txDone(clearTx);
    for (let i = 0; i < progress.length; i += 1) {
      const row = progress[i];
      if (!row?.documentId) continue;
      const tx = db.transaction("progress", "readwrite");
      tx.objectStore("progress").put(row);
      await txDone(tx);
      if (i % 20 === 19) await yieldTick();
    }
  }
  if (resume?.documentId) writeLocalResume(resume);
  return count;
}

export async function importLibraryBackup(raw: string | unknown): Promise<{ count: number }> {
  let parsed: unknown;
  try {
    parsed = typeof raw === "string" ? await parseBackupJson(raw) : raw;
  } catch {
    throw new Error("That file is not a book library.");
  }
  const data = parsed as { kind?: string; documents?: DocumentRecord[]; progress?: ProgressRecord[]; resume?: ResumeSnapshot | null };
  if (data.kind && data.kind !== "linguareader.library" && data.kind !== "linguareader.full-backup") {
    throw new Error("That file is not a book library.");
  }
  if (!Array.isArray(data.documents)) throw new Error("That file has no books.");
  const count = await replaceLibrary(
    data.documents as DocumentRecord[],
    Array.isArray(data.progress) ? data.progress : [],
    data.resume ?? null,
  );
  return { count };
}

export async function importTypedBackup(raw: string): Promise<{ kind: TypedBackupKind; count: number; label: string }> {
  return applyParsedBackup(await parseBackupJson(raw));
}

export async function importTypedBackupBuffer(buffer: ArrayBuffer): Promise<{ kind: TypedBackupKind; count: number; label: string }> {
  return applyParsedBackup(await parseBackupBuffer(buffer));
}

async function applyParsedBackup(parsed: unknown): Promise<{ kind: TypedBackupKind; count: number; label: string }> {
  const info = classifyParsed(parsed);
  if (!info) throw new Error("That file is not a LinguaReader backup.");
  if (info.kind === "settings") {
    const result = await importSettingsBackup(parsed);
    return { kind: "settings", count: result.count, label: info.label };
  }
  if (info.kind === "library") {
    const result = await importLibraryBackup(parsed);
    return { kind: "library", count: result.count, label: info.label };
  }
  if (info.kind === "voices") {
    const result = await importVoicesBackup(parsed);
    return { kind: "voices", count: result.count, label: info.label };
  }
  if (info.kind === "mix-pack") {
    return { kind: "mix-pack", count: 0, label: "Mix packs are no longer used" };
  }
  const result = await importBackupParsed(parsed);
  return { kind: "full", count: result.count, label: info.label };
}

export interface VoiceBankRecord {
  name: string;
  neural: string;
  pitch: string;
  rate: number;
  gender: "female" | "male" | "unknown";
  lang: "zh" | "en";
  voiceLabel: string;
  updatedAt: number;
}

export async function getVoiceBank(): Promise<VoiceBankRecord[]> {
  const rows = await getMeta<VoiceBankRecord[]>("voiceBank");
  return Array.isArray(rows) ? rows : [];
}

export async function mergeVoiceBank(entries: VoiceBankRecord[]): Promise<VoiceBankRecord[]> {
  const current = await getVoiceBank();
  const map = new Map(current.map((row) => [row.name, row]));
  for (const entry of entries) {
    if (!entry?.name) continue;
    map.set(entry.name, { ...map.get(entry.name), ...entry, updatedAt: Date.now() });
  }
  const next = [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "zh"));
  await setMeta("voiceBank", next);
  return next;
}

export async function replaceVoiceBank(entries: VoiceBankRecord[]): Promise<VoiceBankRecord[]> {
  const next = entries.filter((row) => row?.name);
  await setMeta("voiceBank", next);
  return next;
}

export async function updateProgress(
  id: string,
  sentenceOffset: number,
  extras?: { title?: string; sentenceCount?: number },
): Promise<void> {
  const snap: ResumeSnapshot = {
    documentId: id,
    title: extras?.title ?? "",
    sentenceOffset,
    sentenceCount: extras?.sentenceCount ?? 0,
    savedAt: Date.now(),
  };
  writeLocalResume(snap);
  const current = await getSettings();
  const db = await openDb();
  if (!db.objectStoreNames.contains("progress")) return;
  const tx = db.transaction(["progress", "meta"], "readwrite");
  tx.objectStore("progress").put({
    documentId: id,
    sentenceOffset,
    sentenceCount: snap.sentenceCount,
    title: snap.title,
    updatedAt: snap.savedAt,
  } satisfies ProgressRecord);
  tx.objectStore("meta").put({
    key: "settings",
    value: { ...current, lastActiveId: id },
  } satisfies MetaRecord);
  await txDone(tx);
}

export async function getResumeSnapshot(): Promise<ResumeSnapshot | null> {
  const local = readLocalResume();
  const settings = await getSettings();
  const marks = await allProgress();
  const id = local?.documentId || settings.lastActiveId;
  if (!id) return null;
  const mark = marks.get(id);
  const offset = local?.documentId === id ? local.sentenceOffset : (mark?.sentenceOffset ?? 0);
  const count = local?.documentId === id ? local.sentenceCount : (mark?.sentenceCount ?? 0);
  const title = local?.documentId === id ? local.title : (mark?.title ?? "");
  const savedAt = local?.documentId === id ? local.savedAt : (mark?.updatedAt ?? 0);
  return {
    documentId: id,
    title,
    sentenceOffset: offset,
    sentenceCount: count,
    savedAt,
  };
}

function surfaceMetaKey(surface: VisualSurface): "settingsDesktop" | "settingsMobile" {
  return surface === "desktop" ? "settingsDesktop" : "settingsMobile";
}

export async function getSurfaceSettings(surface: VisualSurface): Promise<AppSettings> {
  const stored = await getMeta<AppSettings>(surfaceMetaKey(surface));
  if (stored && typeof stored === "object") return { ...DEFAULT_SETTINGS, ...stored };
  const legacy = await getMeta<AppSettings>("settings");
  return { ...DEFAULT_SETTINGS, ...legacy };
}

export async function getSettings(): Promise<AppSettings> {
  return getSurfaceSettings(currentVisualSurface());
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const surface = currentVisualSurface();
  const current = await getSurfaceSettings(surface);
  const next = { ...current, ...patch };
  await setMeta(surfaceMetaKey(surface), next);
  await setMeta("settings", next);
  return next;
}

export async function getBothSurfaceSettings(): Promise<{ desktop: AppSettings; mobile: AppSettings }> {
  return {
    desktop: await getSurfaceSettings("desktop"),
    mobile: await getSurfaceSettings("mobile"),
  };
}

function sampleDoc(
  id: string,
  title: string,
  rawText: string,
  sourceName: string,
): DocumentRecord {
  return buildDocument({
    id,
    title,
    rawText,
    encoding: "utf-8",
    sourceName,
    createdAt: Date.now(),
    sourceBytes: encodeUtf8Bytes(rawText),
  });
}

export async function seedIfEmpty(): Promise<void> {
  const seedVersion = await getMeta<number>("seedVersion");
  const seeded = await getMeta<boolean>("seeded");

  const refreshSample = async (
    id: string,
    title: string,
    rawText: string,
    sourceName: string,
  ) => {
    const existing = await getDocument(id);
    const next = sampleDoc(id, title, rawText, sourceName);
    if (existing) {
      next.createdAt = existing.createdAt;
      next.sentenceOffset = Math.min(existing.sentenceOffset, Math.max(0, next.sentenceCount - 1));
    }
    await putDocument(next);
  };

  if (!seeded) {
    await refreshSample(SAMPLE_WELCOME_ID, SAMPLE_WELCOME_TITLE, SAMPLE_WELCOME_TEXT, "welcome.txt");
    await refreshSample(SAMPLE_CHINESE_ID, SAMPLE_CHINESE_TITLE, SAMPLE_CHINESE_TEXT, "jingyesi.txt");
    await saveSettings({ lastActiveId: SAMPLE_WELCOME_ID });
    await setMeta("seeded", true);
    await setMeta("seedVersion", 4);
    return;
  }

  if (seedVersion === 4) return;

  if (await getDocument(SAMPLE_WELCOME_ID)) {
    await refreshSample(SAMPLE_WELCOME_ID, SAMPLE_WELCOME_TITLE, SAMPLE_WELCOME_TEXT, "welcome.txt");
  }
  if (await getDocument(SAMPLE_CHINESE_ID)) {
    await refreshSample(SAMPLE_CHINESE_ID, SAMPLE_CHINESE_TITLE, SAMPLE_CHINESE_TEXT, "jingyesi.txt");
  }
  await setMeta("seedVersion", 4);
}

export async function exportBackup(): Promise<{ blob: Blob; digest: string }> {
  const documents = await listDocuments();
  const settings = await getSettings();
  const serializable = documents.map(({ sourceBytes: _bytes, ...rest }) => rest);
  const progress = [...(await allProgress()).values()];
  const resume = readLocalResume();
  const storedVoices = await listVoicesStored();
  const voices: PackedVoice[] = [];
  for (const voice of storedVoices) {
    const packed = await blobToPacked(voice.blob);
    voices.push({
      id: voice.id,
      name: voice.name,
      mime: packed.mime || voice.mime,
      b64: packed.b64,
      createdAt: voice.createdAt,
      bytes: packed.bytes,
      ...(voice.offlineReadURI ? { offlineReadURI: voice.offlineReadURI } : {}),
    });
  }
  const wallpaperBlob = await getWallpaper();
  const wallpaper = wallpaperBlob ? await blobToPacked(wallpaperBlob) : null;
  const surfaces = await getBothSurfaceSettings();
  const ttsClips = await listTtsClipsPacked();
  const digest = await sha256Hex(
    canonicalBackupV3({
      documents: serializable,
      settings,
      settingsDesktop: surfaces.desktop,
      settingsMobile: surfaces.mobile,
      progress,
      resume,
      casts: [],
      voiceBank: [],
      voiceIds: voices.map((v) => v.id),
      wallpaperBytes: wallpaper?.bytes ?? 0,
      ttsClipIds: ttsClips.map((clip) => clip.id),
    }),
  );
  const backup: LibraryBackup = {
    app: "LinguaReader",
    version: 3,
    kind: "linguareader.full-backup",
    exportedAt: Date.now(),
    documents: serializable,
    settings,
    settingsDesktop: surfaces.desktop,
    settingsMobile: surfaces.mobile,
    digest,
    progress,
    resume,
    voices,
    wallpaper,
    ttsClips,
  };
  const blob = new Blob([JSON.stringify(backup)], { type: "application/json" });
  await rememberBackupBlob(blob, `LinguaReader-full-${new Date().toISOString().slice(0, 10)}.json`);
  return { blob, digest };
}

export async function rememberBackupBlob(blob: Blob, name: string): Promise<void> {
  try {
    await setMeta("lastBackupMeta", { name, savedAt: Date.now(), bytes: blob.size });
    const db = await openDb();
    if (!db.objectStoreNames.contains("meta")) return;
    const tx = db.transaction("meta", "readwrite");
    tx.objectStore("meta").put({ key: "lastBackupBlob", value: blob } satisfies MetaRecord);
    await txDone(tx);
  } catch {
    /* quota — live library is still in IndexedDB */
  }
}

export async function getLastBackupMeta(): Promise<{ name: string; savedAt: number; bytes: number } | null> {
  const meta = await getMeta<{ name: string; savedAt: number; bytes: number }>("lastBackupMeta");
  return meta ?? null;
}

export async function clearRememberedBackup(): Promise<void> {
  const db = await openDb();
  if (!db.objectStoreNames.contains("meta")) return;
  const tx = db.transaction("meta", "readwrite");
  const store = tx.objectStore("meta");
  store.delete("lastBackupBlob");
  store.delete("lastBackupMeta");
  await txDone(tx);
}

export async function putWallpaper(blob: Blob): Promise<void> {
  await setMeta("wallpaperBlob", blob);
}

export async function getWallpaper(): Promise<Blob | null> {
  const value = await getMeta<Blob>("wallpaperBlob");
  return value instanceof Blob ? value : null;
}

export async function restoreRememberedBackup(): Promise<{ count: number; full: boolean } | null> {
  const db = await openDb();
  const row = await requestToPromise(db.transaction("meta").objectStore("meta").get("lastBackupBlob"));
  const blob = (row as MetaRecord | undefined)?.value;
  if (!(blob instanceof Blob)) return null;
  const raw = await blob.arrayBuffer();
  const parsed = await parseBackupBuffer(raw);
  return importBackupParsed(parsed);
}

export async function importBackup(raw: string): Promise<{ count: number; full: boolean }> {
  try {
    return await importBackupParsed(await parseBackupJson(raw));
  } catch (err) {
    if (err instanceof SyntaxError) throw new Error("That file is not valid JSON.");
    throw err;
  }
}

async function importBackupParsed(parsed: unknown): Promise<{ count: number; full: boolean }> {
  await yieldTick();
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Backup file is empty.");
  }
  const data = parsed as Partial<LibraryBackup>;
  if (data.app !== "LinguaReader" || !Array.isArray(data.documents)) {
    throw new Error("This JSON is not a LinguaReader library backup.");
  }
  const version = data.version === 3 ? 3 : data.version === 2 ? 2 : data.version === 1 ? 1 : 0;
  if (!version) {
    throw new Error("This JSON is not a LinguaReader library backup.");
  }
  if (typeof data.digest !== "string" || data.digest.length < 32) {
    throw new Error("Backup is missing its SHA-256 digest.");
  }
  const docs = data.documents as DocumentRecord[];
  const settings = (data.settings && typeof data.settings === "object" ? data.settings : DEFAULT_SETTINGS) as AppSettings;
  const settingsDesktop = (
    data.settingsDesktop && typeof data.settingsDesktop === "object" ? data.settingsDesktop : settings
  ) as AppSettings;
  const settingsMobile = (
    data.settingsMobile && typeof data.settingsMobile === "object" ? data.settingsMobile : settings
  ) as AppSettings;
  if (version === 1) {
    const actual = await sha256Hex(canonicalDocuments(docs));
    if (actual !== data.digest) {
      throw new Error("Backup failed integrity check. The SHA-256 digest does not match.");
    }
  } else if (version === 2) {
    const actual = await sha256Hex(
      canonicalBackupV2({
        documents: docs,
        settings,
        progress: Array.isArray(data.progress) ? data.progress : [],
        resume: data.resume ?? null,
        casts: Array.isArray(data.casts) ? data.casts : [],
        voiceBank: Array.isArray(data.voiceBank) ? data.voiceBank : [],
        voiceIds: Array.isArray(data.voices) ? data.voices.map((v) => v.id) : [],
        wallpaperBytes: data.wallpaper?.bytes ?? 0,
      }),
    );
    if (actual !== data.digest) {
      throw new Error("Backup failed integrity check. The SHA-256 digest does not match.");
    }
  } else {
    const actual = await sha256Hex(
      canonicalBackupV3({
        documents: docs,
        settings,
        settingsDesktop,
        settingsMobile,
        progress: Array.isArray(data.progress) ? data.progress : [],
        resume: data.resume ?? null,
        casts: Array.isArray(data.casts) ? data.casts : [],
        voiceBank: Array.isArray(data.voiceBank) ? data.voiceBank : [],
        voiceIds: Array.isArray(data.voices) ? data.voices.map((v) => v.id) : [],
        wallpaperBytes: data.wallpaper?.bytes ?? 0,
        ttsClipIds: Array.isArray(data.ttsClips) ? data.ttsClips.map((clip) => clip.id) : undefined,
      }),
    );
    if (actual !== data.digest) {
      throw new Error("Backup failed integrity check. The SHA-256 digest does not match.");
    }
  }

  const count = await putRestoredDocuments(docs);
  const db = await openDb();
  if (db.objectStoreNames.contains("progress")) {
    const clearTx = db.transaction("progress", "readwrite");
    clearTx.objectStore("progress").clear();
    await txDone(clearTx);
    const rows = version >= 2 && Array.isArray(data.progress) ? data.progress : [];
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      if (!row?.documentId) continue;
      const tx = db.transaction("progress", "readwrite");
      tx.objectStore("progress").put(row);
      await txDone(tx);
      if (i % 20 === 19) await yieldTick();
    }
  }
  if (db.objectStoreNames.contains("casts") && version >= 2) {
    const clearTx = db.transaction("casts", "readwrite");
    clearTx.objectStore("casts").clear();
    await txDone(clearTx);
    const casts = data.casts ?? [];
    for (let i = 0; i < casts.length; i += 1) {
      const cast = casts[i];
      if (!(cast && typeof cast === "object" && "documentId" in (cast as { documentId?: string }))) continue;
      const tx = db.transaction("casts", "readwrite");
      tx.objectStore("casts").put(cast);
      await txDone(tx);
      if (i % 20 === 19) await yieldTick();
    }
  }
  if (db.objectStoreNames.contains("voices") && version >= 2) {
    const clearTx = db.transaction("voices", "readwrite");
    clearTx.objectStore("voices").clear();
    await txDone(clearTx);
    const voices = data.voices ?? [];
    for (let i = 0; i < voices.length; i += 1) {
      const voice = voices[i];
      if (!voice?.id || !voice.b64) continue;
      const tx = db.transaction("voices", "readwrite");
      tx.objectStore("voices").put({
        id: voice.id,
        name: voice.name || "Voice",
        mime: voice.mime || "audio/mpeg",
        blob: packedToBlob({ mime: voice.mime, b64: voice.b64, bytes: voice.bytes }),
        createdAt: voice.createdAt || Date.now(),
        ...(voice.offlineReadURI ? { offlineReadURI: voice.offlineReadURI } : {}),
      } satisfies StoredVoice);
      await txDone(tx);
      await yieldTick();
    }
  }

  await setMeta("settingsDesktop", { ...DEFAULT_SETTINGS, ...settingsDesktop });
  await setMeta("settingsMobile", { ...DEFAULT_SETTINGS, ...settingsMobile });
  const active =
    currentVisualSurface() === "desktop"
      ? { ...DEFAULT_SETTINGS, ...settingsDesktop }
      : { ...DEFAULT_SETTINGS, ...settingsMobile };
  await setMeta("settings", active);
  if (version >= 2) {
    if (data.resume?.documentId) writeLocalResume(data.resume);
    if (data.wallpaper?.b64) {
      await putWallpaper(packedToBlob(data.wallpaper));
    }
  }
  if (Array.isArray(data.ttsClips) && data.ttsClips.length) {
    await restoreTtsClips(data.ttsClips);
  }

  return { count, full: version >= 2 };
}

export const StorageService = {
  listDocuments,
  markBookOpened,
  getDocument,
  getProgressOffset,
  putDocument,
  deleteDocument,
  renameDocument,
  redecodeDocument,
  updateDocumentText,
  updateProgress,
  getResumeSnapshot,
  readLocalResume,
  writeLocalResume,
  getSettings,
  saveSettings,
  getSurfaceSettings,
  getBothSurfaceSettings,
  seedIfEmpty,
  exportBackup,
  importBackup,
  importTypedBackupBuffer,
  exportSettingsBackup,
  exportLibraryBackup,
  exportVoicesBackup,
  inspectBackup,
  importTypedBackup,
  rememberTypedBackup,
  getTypedBackupSlots,
  restoreTypedBackup,
  clearTypedBackups,
  rememberBackupBlob,
  getLastBackupMeta,
  clearRememberedBackup,
  restoreRememberedBackup,
  putWallpaper,
  getWallpaper,
  buildDocument,
  listVoicesStored,
  putVoice,
  getVoice,
  deleteVoice,
  getTtsClip,
  putTtsClip,
  clearStaleTtsCache,
  clearTtsCache,
  getCast,
  putCast,
  getMixPreset,
  putMixPreset,
  listMixPresets,
  listMixPackOptions,
  deleteMixPresets,
  exportMixPack,
  importMixPack,
  getVoiceBank,
  mergeVoiceBank,
  replaceVoiceBank,
};
