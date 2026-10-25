import {
  getDocument,
  getVoice,
  saveSettings,
  updateProgress,
  writeLocalResume,
  type DocumentRecord,
} from "@/services/StorageService";
import { broadcast } from "@/services/SyncService";
import { detectLanguage, isChineseVoice, isMandarinVoice } from "@/utils/textNormalization";
import { splitSentences } from "@/utils/sentences";
import { NowPlayingPlayer, type VoiceClip } from "@/services/media/NowPlayingPlayer";
import { isApkVoiceURI, speakAndroidVoice, stopAndroidVoice } from "@/services/media/AndroidVoices";
import { NativeReading } from "@/services/media/NativeReading";
import { SessionKeepAlive, unlockIosAudio } from "@/services/media/SessionKeepAlive";
import { isAndroid, isAndroidAPK, isAndroidChrome, isInstalledAndroidApp, isIOS, isIOSChrome } from "@/utils/platform";
import { toast } from "sonner";
import { speakWithStoryteller, STORY_AUTO, PIPER_URI, isStoryVoiceURI, getStoryVoice, OfflineVoiceError } from "@/services/media/storyteller";

export { splitSentences };
export { STORY_VOICES, STORY_AUTO, STORY_PREFIX, PIPER_URI, isStoryVoiceURI } from "@/services/media/storyteller";

export type PlaybackStatus = "idle" | "playing" | "paused";

export interface SpeechState {
  status: PlaybackStatus;
  documentId: string | null;
  title: string;
  sentenceIndex: number;
  sentences: string[];
  rate: number;
  pitch: number;
  voiceURI: string | null;
  voiceStatus: "idle" | "loading" | "ready" | "error";
  voiceMessage: string;
  currentRole: string;
  narratorVoice: string;
  castCount: number;
  castVersion: number;
  rolesEnabled: boolean;
}

type Listener = (state: SpeechState) => void;

const listeners = new Set<Listener>();

let state: SpeechState = {
  status: "idle",
  documentId: null,
  title: "",
  sentenceIndex: 0,
  sentences: [],
  rate: 1,
  pitch: 1,
  voiceURI: null,
  voiceStatus: "idle",
  voiceMessage: "",
  currentRole: "",
  narratorVoice: "",
  castCount: 0,
  castVersion: 0,
  rolesEnabled: false,
};

let currentUtterance: SpeechSynthesisUtterance | null = null;
let utteranceGen = 0;
let utteranceTimer: number | null = null;
let speakTimer: number | null = null;
let utteranceStalls = 0;
let shouldAdvance = false;
let keepAliveTimer: number | null = null;
let voicesCache: SpeechSynthesisVoice[] = [];
let voicesLoaded = false;
let externalSync = false;
let audioEl: HTMLAudioElement | null = null;
let audioUrl: string | null = null;
let guardsInstalled = false;
let iosToken = 0;
let iosActive = false;
let iosMediaRetries = 0;
let mediaCursor = 0;
let mediaBusy = false;
let mediaAgain = false;
let mediaFirst = true;
let mediaFetchMisses = 0;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function synthesizeChunk(text: string): Promise<Blob> {
  const tries = isInstalledAndroidApp() ? 3 : 1;
  let last: unknown;
  for (let attempt = 0; attempt < tries; attempt += 1) {
    try {
      return await synthesizeMediaBlob(text);
    } catch (err) {
      last = err;
      if (attempt < tries - 1) await wait(450 * (attempt + 1));
    }
  }
  throw last instanceof Error ? last : new Error("voice-chunk-failed");
}
let offlineReadURI: string | null = null;
let speakerTags: string[] = [];
let hydrateSeq = 0;
let castHydration: Promise<void> = Promise.resolve();

const MEDIA_CHUNK_SENTENCES = 1;

export const CUSTOM_VOICE_PREFIX = "custom:";

export function isCustomVoiceURI(uri: string | null | undefined): boolean {
  return !!uri?.startsWith(CUSTOM_VOICE_PREFIX);
}

import { isDesktopShell, isIOSDevice } from "@/lib/browser";
export { isIOSDevice };

function claimAudioSession(): void {
  const nav = navigator as Navigator & { audioSession?: { type: string } };
  try {
    if (nav.audioSession) nav.audioSession.type = "playback";
  } catch {
    /* ignore */
  }
}

export function primeFromGesture(): void {
  installPlaybackGuards();
  if (isIOS() && !usesMediaPlayback()) return;
  claimAudioSession();
  if (!usesMediaPlayback()) return;
  unlockIosAudio();
  if (state.status === "paused" && iosActive) return;
  if (!isDesktopShell()) NowPlayingPlayer.holdOpen();
}

function usesMediaPlayback(): boolean {
  if (isCustomVoiceURI(state.voiceURI)) return false;
  const uri = state.voiceURI;
  return !uri || uri === STORY_AUTO || uri === PIPER_URI || isStoryVoiceURI(uri);
}

export function usesSystemVoice(): boolean {
  return !usesMediaPlayback() && !isCustomVoiceURI(state.voiceURI);
}

function emit(): void {
  const snapshot = { ...state, sentences: state.sentences };
  for (const listener of listeners) listener(snapshot);
}

function synth(): SpeechSynthesis | null {
  if (typeof window === "undefined") return null;
  return window.speechSynthesis ?? null;
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  listener({ ...state, sentences: state.sentences });
  return () => {
    listeners.delete(listener);
  };
}

export function getState(): SpeechState {
  return { ...state, sentences: state.sentences };
}

function voiceRank(voice: SpeechSynthesisVoice): number {
  const uri = voice.voiceURI.toLowerCase();
  let rank = 0;
  if (voice.localService) rank += 2;
  if (uri.includes("premium") || uri.includes("enhanced") || uri.includes("eloquence")) rank += 4;
  if (uri.includes("compact")) rank -= 1;
  return rank;
}

export function listVoices(): SpeechSynthesisVoice[] {
  const s = synth();
  if (!s) return voicesCache;
  const current = s.getVoices();
  if (current.length) {
    const unique = new Map<string, SpeechSynthesisVoice>();
    for (const voice of current) {
      const key = voice.name.trim().toLowerCase();
      const prev = unique.get(key);
      if (!prev || voiceRank(voice) > voiceRank(prev)) unique.set(key, voice);
    }
    voicesCache = [...unique.values()];
    voicesLoaded = true;
    dropRemovedCantonese();
  }
  return voicesCache;
}

export function waitForVoices(): Promise<SpeechSynthesisVoice[]> {
  const existing = listVoices();
  if (existing.length || typeof window === "undefined") {
    return Promise.resolve(existing);
  }
  return new Promise((resolve) => {
    const s = synth();
    if (!s) {
      resolve([]);
      return;
    }
    const done = () => {
      const voices = listVoices();
      if (voices.length || voicesLoaded) {
        s.removeEventListener("voiceschanged", done);
        window.clearTimeout(timeout);
        resolve(voices);
      }
    };
    const timeout = window.setTimeout(done, 1500);
    s.addEventListener("voiceschanged", done);
  });
}

export function pickVoice(
  voices: SpeechSynthesisVoice[],
  lang: "zh" | "en",
  preferredURI: string | null,
): SpeechSynthesisVoice | null {
  if (preferredURI && !isCustomVoiceURI(preferredURI) && !preferredURI.startsWith("story:")) {
    const preferred = voices.find((v) => v.voiceURI === preferredURI);
    if (preferred && (lang !== "zh" || isChineseVoice(preferred))) return preferred;
  }
  if (lang === "zh") {
    const chinese = voices.filter((voice) => {
      if (!isChineseVoice(voice)) return false;
      if (!isAndroidChrome()) return true;
      return isMandarinVoice(voice);
    });
    return chinese.find((v) => v.localService) ?? chinese[0] ?? null;
  }
  const byLang = voices.filter((v) => v.lang.toLowerCase().startsWith("en"));
  return byLang.find((v) => v.localService) ?? byLang[0] ?? voices.find((v) => v.default) ?? voices[0] ?? null;
}

function stopAudio(): void {
  if (audioEl) {
    audioEl.onended = null;
    audioEl.onerror = null;
    audioEl.pause();
    audioEl.removeAttribute("src");
    audioEl.load();
    audioEl = null;
  }
  if (audioUrl) {
    URL.revokeObjectURL(audioUrl);
    audioUrl = null;
  }
}

function stopKeepAlive(): void {
  if (keepAliveTimer != null) {
    window.clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
  SessionKeepAlive.stop();
  void NativeReading.stop();
}

function startKeepAlive(): void {
  if (keepAliveTimer != null) {
    window.clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
  SessionKeepAlive.start(usesMediaPlayback());
  void NativeReading.start();
}

function bindMediaSession(): void {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
  const session = navigator.mediaSession;
  try {
    session.metadata = new MediaMetadata({
      title: state.title || "LinguaReader",
      artist: "LinguaReader",
      album: "Local library",
    });
    session.playbackState =
      state.status === "playing" ? "playing" : state.status === "paused" ? "paused" : "none";
    if (state.sentences.length && "setPositionState" in session) {
      try {
        session.setPositionState({
          duration: Math.max(1, state.sentences.length),
          playbackRate: state.rate,
          position: Math.min(state.sentenceIndex, state.sentences.length - 1),
        });
      } catch {
        /* ignore */
      }
    }
    session.setActionHandler("play", () => {
      if (usesMediaPlayback() && NowPlayingPlayer.rejectAutoPlay()) return;
      void resume();
    });
    session.setActionHandler("pause", () => {
      if (isIOSChrome() && NowPlayingPlayer.isAudible()) {
        NowPlayingPlayer.noteUserPause();
        pause();
        return;
      }
      if (NowPlayingPlayer.shouldIgnoreAutoPause()) return;
      NowPlayingPlayer.noteUserPause();
      if (isAndroidChrome() && document.visibilityState === "hidden") {
        stop();
        return;
      }
      pause();
    });
    session.setActionHandler("stop", () => {
      NowPlayingPlayer.noteUserPause();
      if (isIOSChrome()) {
        pause();
        return;
      }
      stop();
    });
    session.setActionHandler("previoustrack", () => {
      void skip(-1);
    });
    session.setActionHandler("nexttrack", () => {
      void skip(1);
    });
    session.setActionHandler("seekbackward", () => {
      void skip(-1);
    });
    session.setActionHandler("seekforward", () => {
      void skip(1);
    });
  } catch {
    /* ignore */
  }
}

async function persistOffset(): Promise<void> {
  if (!state.documentId) return;
  const offset = state.sentenceIndex;
  const id = state.documentId;
  writeLocalResume({
    documentId: id,
    title: state.title,
    sentenceOffset: offset,
    sentenceCount: state.sentences.length,
    savedAt: Date.now(),
  });
  try {
    await updateProgress(id, offset, {
      title: state.title,
      sentenceCount: state.sentences.length,
    });
    broadcast({ type: "progress", documentId: id, sentenceOffset: offset });
  } catch {
    /* ignore */
  }
}

function persistOffsetSoon(): void {
  void persistOffset();
}

function installPlaybackGuards(): void {
  if (guardsInstalled || typeof window === "undefined") return;
  guardsInstalled = true;
  const flush = () => persistOffsetSoon();
  window.addEventListener("pagehide", flush);
  window.addEventListener("beforeunload", flush);
  window.addEventListener("pageshow", () => {
    if (state.status !== "playing") return;
    claimAudioSession();
    if (usesMediaPlayback()) {
      if (NowPlayingPlayer.rejectAutoPlay()) return;
      void NowPlayingPlayer.resume().catch(() => undefined);
      return;
    }
    const s = synth();
    if (s?.paused) {
      try {
        s.resume();
      } catch {
        /* ignore */
      }
    }
  });
  document.addEventListener("visibilitychange", () => {
    flush();
    claimAudioSession();
    if (state.status !== "playing") return;
    if (usesMediaPlayback()) {
      if (document.visibilityState === "hidden") return;
      if (NowPlayingPlayer.rejectAutoPlay()) return;
      void NowPlayingPlayer.resume().catch(() => undefined);
      return;
    }
    const s = synth();
    if (document.visibilityState === "hidden") {
      try {
        s?.resume();
      } catch {
        /* ignore */
      }
      return;
    }
    if (s?.paused) {
      try {
        s.resume();
      } catch {
        /* ignore */
      }
    }
  });
  document.addEventListener("freeze", flush);
  const nav = navigator as Navigator & {
    audioSession?: { type: string; state?: string; addEventListener?: (name: string, cb: () => void) => void };
  };
  if (nav.audioSession?.addEventListener) {
    nav.audioSession.addEventListener("statechange", () => {
      claimAudioSession();
      if (state.status !== "playing") return;
      if (nav.audioSession?.state === "interrupted") return;
      if (!usesMediaPlayback()) return;
      if (NowPlayingPlayer.rejectAutoPlay()) return;
      void NowPlayingPlayer.resume().catch(() => {
        if (iosActive && usesMediaPlayback()) kickoffMediaPlayback();
      });
    });
  }
  window.setInterval(() => {
    if (state.status !== "playing" || !iosActive || !usesMediaPlayback()) return;
    claimAudioSession();
    if (NowPlayingPlayer.rejectAutoPlay()) return;
    if (NowPlayingPlayer.isPlayingVoice()) return;
    void NowPlayingPlayer.resume().catch(() => undefined);
  }, 2500);
}

function clearSpeechTimers(): void {
  if (utteranceTimer != null) {
    window.clearTimeout(utteranceTimer);
    window.clearInterval(utteranceTimer);
    utteranceTimer = null;
  }
  if (speakTimer != null) {
    window.clearTimeout(speakTimer);
    speakTimer = null;
  }
}

function silenceSynth(): void {
  const s = synth();
  try {
    s?.cancel();
  } catch {
    /* ignore */
  }
}

function cancelSpeech(): void {
  utteranceGen += 1;
  shouldAdvance = false;
  clearSpeechTimers();
  currentUtterance = null;
  silenceSynth();
}

function utteranceBudget(text: string): number {
  const rate = Math.max(0.5, state.rate || 1);
  const cjk = /[\u4e00-\u9fff]/.test(text);
  const perSec = cjk ? 4.2 : 13;
  return Math.min(20_000, Math.max(8_000, (text.length / (perSec * rate)) * 1000 + 4_000));
}

function speechPieces(text: string): string[] {
  const cjk = /[\u4e00-\u9fff]/.test(text);
  let limit = cjk ? 48 : 120;
  if (isIOS()) limit = Math.min(limit, 99);
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  if (clean.length <= limit) return [clean];
  const parts: string[] = [];
  let rest = clean;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf(" ", limit);
    if (cut < Math.floor(limit * 0.45)) cut = limit;
    const piece = rest.slice(0, cut).trim();
    if (piece) parts.push(piece);
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

function releasePlayback(next: "idle" | "paused"): void {
  utteranceGen += 1;
  shouldAdvance = false;
  utteranceStalls = 0;
  clearSpeechTimers();
  currentUtterance = null;
  silenceSynth();
  stopAudio();
  if (next === "idle") {
    if (iosActive) stopMediaSession();
    else NowPlayingPlayer.stop();
  } else {
    NowPlayingPlayer.noteUserPause();
    NowPlayingPlayer.pause();
  }
  stopKeepAlive();
  state = { ...state, status: next };
  emit();
  bindMediaSession();
  void persistOffset();
}

function isSkippable(sentence: string): boolean {
  const trimmed = sentence.trim();
  if (!trimmed) return true;
  return /^[\s\p{P}\p{S}]+$/u.test(trimmed);
}

function nextSpeakable(from: number, direction = 1): number {
  const n = state.sentences.length;
  let i = from;
  while (i >= 0 && i < n && isSkippable(state.sentences[i]!)) {
    i += direction;
  }
  return i;
}

function buildUtterance(text: string, lang: "zh" | "en"): SpeechSynthesisUtterance {
  const utterance = new SpeechSynthesisUtterance(text);
  const voice = pickVoice(listVoices(), lang, offlineReadURI || state.voiceURI);
  if (voice) {
    utterance.voice = voice;
    utterance.lang = isAndroidChrome() && lang === "zh" ? "zh-CN" : voice.lang || (lang === "zh" ? "zh-CN" : "en-US");
  } else {
    utterance.lang = lang === "zh" ? "zh-CN" : "en-US";
  }
  utterance.rate = state.rate;
  utterance.pitch = state.pitch;
  utterance.volume = 1;
  return utterance;
}

function joinForSpeech(texts: string[]): string {
  const probe = texts.join("");
  const lang = detectLanguage(probe);
  return lang === "zh" ? texts.join("") : texts.join(" ");
}

function collectMediaChunk(from: number, limit: number): {
  start: number;
  to: number;
  texts: string[];
  indices: number[];
  speaker: string;
} {
  let i = nextSpeakable(from, 1);
  const start = i;
  const speaker = speakerTags[i] || "narrator";
  const texts: string[] = [];
  const indices: number[] = [];
  while (i < state.sentences.length && texts.length < limit) {
    if ((speakerTags[i] || "narrator") !== speaker) break;
    const sentence = state.sentences[i]!;
    if (!isSkippable(sentence)) {
      texts.push(sentence);
      indices.push(i);
    }
    i += 1;
  }
  return { start, to: i, texts, indices, speaker };
}

async function synthesizeMediaBlob(text: string): Promise<Blob> {
  const lang = detectLanguage(text);
  return speakWithStoryteller(text, lang, state.voiceURI || STORY_AUTO, state.rate);
}

function stopMediaSession(): void {
  iosToken += 1;
  iosActive = false;
  mediaBusy = false;
  mediaFirst = true;
  stopIndexSync();
  NowPlayingPlayer.onEnded(null);
  NowPlayingPlayer.onClipStart(null);
  NowPlayingPlayer.onTimeUpdate(null);
  NowPlayingPlayer.onFault(null);
  NowPlayingPlayer.stop();
  stopKeepAlive();
}

function highlightSentence(index: number, roleLabel: string): void {
  if (index === state.sentenceIndex && roleLabel === state.currentRole) return;
  state = { ...state, sentenceIndex: index, currentRole: roleLabel };
  emit();
  persistOffsetSoon();
  bindMediaSession();
}

let indexSyncTimer: number | null = null;
let renderedRange = { start: 0, end: Number.POSITIVE_INFINITY };
let scrollToActiveNonce = 0;
let silentSyncUntil = 0;
let backgroundSync = false;
let scrollLockUntil = 0;
const scrollToActiveListeners = new Set<(nonce: number) => void>();

export function isSilentSync(): boolean {
  return Date.now() < silentSyncUntil;
}

export function peekBackgroundSync(): boolean {
  return backgroundSync;
}

export function clearBackgroundSync(): void {
  backgroundSync = false;
}

function markBackgroundSync(): void {
  if (!isAndroid()) return;
  backgroundSync = true;
}

export function isScrollLocked(): boolean {
  return Date.now() < scrollLockUntil;
}

export function lockAndroidScroll(): void {
  if (!isAndroid()) return;
  scrollLockUntil = Date.now() + 500;
}

export function setRenderedRange(start: number, end: number): void {
  renderedRange = { start, end };
}

export function triggerScrollToActive(): void {
  scrollToActiveNonce += 1;
  for (const listener of scrollToActiveListeners) listener(scrollToActiveNonce);
}

export function subscribeScrollToActive(listener: (nonce: number) => void): () => void {
  scrollToActiveListeners.add(listener);
  return () => scrollToActiveListeners.delete(listener);
}

function stopIndexSync(): void {
  if (indexSyncTimer != null) window.clearInterval(indexSyncTimer);
  indexSyncTimer = null;
}

function startIndexSync(): void {
  stopIndexSync();
  indexSyncTimer = window.setInterval(() => {
    if (state.status !== "playing" || !iosActive) return;
    const clip = NowPlayingPlayer.currentClip();
    const index = clip?.indices[0];
    const clock = NowPlayingPlayer.clock();
    const onPage = index != null && index >= renderedRange.start && index < renderedRange.end;
    if (isAndroid()) {
      if (index != null && index !== state.sentenceIndex && onPage) {
        markBackgroundSync();
        highlightSentence(index, clip?.label || state.currentRole);
      }
      const overrun = clock.duration > 0.3 ? clock.currentTime - clock.duration : 0;
      if (!onPage || overrun <= 0.15) return;
      // A small overrun is the clip finishing on its own. Do not force the next clip.
      if (overrun <= 2) return;
      markBackgroundSync();
      NowPlayingPlayer.resyncFromClock();
      return;
    }
    if (index != null && index !== state.sentenceIndex) {
      if (!onPage) return;
      silentSyncUntil = Date.now() + 500;
      highlightSentence(index, clip?.label || state.currentRole);
    }
    if (onPage && clock.duration > 0.3 && clock.currentTime > clock.duration + 0.15) NowPlayingPlayer.resyncFromClock();
  }, 5_000);
}

function roleLabelFor(): string {
  const voice = getStoryVoice(state.voiceURI);
  if (voice) return voice.name;
  if (state.voiceURI === STORY_AUTO) return "Match the page";
  return "";
}

function clipForChunk(indices: number[], speaker: string): VoiceClip {
  return { indices, label: roleLabelFor() };
}

async function enqueueMediaFrom(token: number, from: number, limit: number): Promise<number> {
  if (token !== iosToken) return from;
  const collected = collectMediaChunk(from, limit);
  if (!collected.texts.length) return -1;
  let blob: Blob;
  try {
    blob = await synthesizeChunk(joinForSpeech(collected.texts));
  } catch {
    throw new Error("voice-chunk-failed");
  }
  if (token !== iosToken) return from;
  if (!NowPlayingPlayer.enqueue(blob, clipForChunk(collected.indices, collected.speaker))) return from;
  if (state.voiceStatus !== "ready") {
    state = { ...state, voiceStatus: "ready", voiceMessage: "" };
    emit();
  }
  return collected.to;
}

async function fillMediaQueue(token: number): Promise<void> {
  if (token !== iosToken) return;
  if (mediaBusy) {
    mediaAgain = true;
    return;
  }
  mediaBusy = true;
  mediaAgain = false;
  try {
    if (state.voiceStatus !== "ready" && !NowPlayingPlayer.isAudible()) {
      state = {
        ...state,
        voiceStatus: "loading",
        voiceMessage: "Fetching once, then saved on this phone…",
      };
      emit();
    }
    const specs = [];
    const ahead = isAndroidChrome() ? 2 : isInstalledAndroidApp() ? 2 : 3;
    let cursor = mediaCursor;
    for (let n = 0; n < ahead && cursor >= 0 && cursor < state.sentences.length; n += 1) {
      const collected = collectMediaChunk(cursor, MEDIA_CHUNK_SENTENCES);
      if (!collected.texts.length || collected.to === cursor) break;
      specs.push(collected);
      cursor = collected.to;
    }
    if (!specs.length) return;
    if (isInstalledAndroidApp()) {
      for (let i = 0; i < specs.length; i += 1) {
        const collected = specs[i]!;
        let blob: Blob;
        try {
          blob = await synthesizeChunk(joinForSpeech(collected.texts));
        } catch (err) {
          if (i === 0) throw err;
          break;
        }
        if (token !== iosToken || !iosActive) return;
        if (!NowPlayingPlayer.enqueue(blob, clipForChunk(collected.indices, collected.speaker))) return;
        mediaCursor = collected.to;
        mediaFetchMisses = 0;
        if (i === 0) {
          state = { ...state, voiceStatus: "ready", voiceMessage: "" };
          emit();
          mediaFirst = false;
        }
      }
      return;
    }
    const jobs = specs.map((collected) =>
      synthesizeMediaBlob(joinForSpeech(collected.texts)).then((blob) => ({ collected, blob })),
    );
    const first = await jobs[0];
    if (token !== iosToken) return;
    if (!NowPlayingPlayer.enqueue(first.blob, clipForChunk(first.collected.indices, first.collected.speaker))) return;
    state = { ...state, voiceStatus: "ready", voiceMessage: "" };
    emit();
    mediaCursor = first.collected.to;
    mediaFirst = false;
    for (let i = 1; i < jobs.length; i += 1) {
      try {
        const item = await jobs[i];
        if (token !== iosToken || !iosActive) return;
        if (!NowPlayingPlayer.enqueue(item.blob, clipForChunk(item.collected.indices, item.collected.speaker))) return;
        mediaCursor = item.collected.to;
      } catch (err) {
        if (err instanceof OfflineVoiceError) throw err;
        break;
      }
    }
  } catch (err) {
    if (token !== iosToken) return;
    if (err instanceof OfflineVoiceError) {
      toast("Using offline system voice");
      state = { ...state, status: "playing", voiceStatus: "ready", voiceMessage: "" };
      emit();
      speakWithSystem();
      return;
    }
    if (err instanceof Error && /Piper (not supported|model not found|model error|model download failed)/.test(err.message)) {
      stopMediaSession();
      state = { ...state, status: "playing", voiceStatus: "ready", voiceMessage: "" };
      emit();
      speakWithSystem();
      return;
    }
    if (isAndroidChrome()) {
      const message = err instanceof Error ? err.message : "unknown";
      toast.error(`Fetch Failed: ${message}`);
      stopMediaSession();
      state = { ...state, status: "playing", voiceStatus: "error", voiceMessage: `Fetch Failed: ${message}` };
      emit();
      speakWithSystem();
      return;
    }
    if (isInstalledAndroidApp() && state.status === "playing") {
      mediaFetchMisses += 1;
      if (mediaFetchMisses < 6) {
        state = { ...state, voiceStatus: "loading", voiceMessage: "Fetching the next line…" };
        emit();
        window.setTimeout(() => {
          if (token === iosToken && state.status === "playing") void fillMediaQueue(token);
        }, 600 * mediaFetchMisses);
        return;
      }
    }
    if (NowPlayingPlayer.queued() > 0) return;
    if (isIOS() && NowPlayingPlayer.isAudible()) return;
    stopMediaSession();
    if (isAndroidChrome() && !listVoices().some(isMandarinVoice)) {
      stopMediaSession();
      state = {
        ...state,
        status: "idle",
        voiceStatus: "error",
        voiceMessage: "Could not fetch that voice. Tap Get Mandarin and download Chinese (China) in Google’s voice.",
      };
      emit();
      return;
    }
    state = {
      ...state,
      voiceStatus: "error",
      voiceMessage: "Could not fetch that voice. Reading with the phone voice for now.",
    };
    emit();
    speakWithSystem();
  } finally {
    if (token === iosToken) mediaBusy = false;
    if (mediaAgain && token === iosToken && state.status === "playing") {
      mediaAgain = false;
      void fillMediaQueue(token);
    }
  }
}

function onMediaEnded(token: number): void {
  if (token !== iosToken) return;
  lockAndroidScroll();
  if (mediaCursor >= state.sentences.length && NowPlayingPlayer.queued() === 0 && !NowPlayingPlayer.isPlayingVoice()) {
    stopMediaSession();
    state = { ...state, status: "idle", sentenceIndex: Math.max(0, state.sentences.length - 1) };
    emit();
    bindMediaSession();
    void persistOffset();
    return;
  }
  void fillMediaQueue(token);
}

function onClipStart(token: number, clip: VoiceClip): void {
  if (token !== iosToken) return;
  const idx = clip.indices[0];
  if (idx == null) return;
  lockAndroidScroll();
  highlightSentence(idx, clip.label);
}

function kickoffMediaPlayback(): void {
  if (!usesMediaPlayback()) return;
  if (!state.sentences.length) return;
  mediaBusy = false;
  mediaAgain = false;
  const token = ++iosToken;
  iosActive = true;
  iosMediaRetries = 0;
  mediaFirst = true;
  mediaFetchMisses = 0;
  claimAudioSession();
  cancelSpeech();
  stopKeepAlive();
  stopAudio();

  const from = nextSpeakable(state.sentenceIndex, 1);
  if (from < 0 || from >= state.sentences.length) {
    stopMediaSession();
    return;
  }
  mediaCursor = from;
  state = {
    ...state,
    status: "playing",
    sentenceIndex: from,
    voiceStatus: "loading",
    voiceMessage: "Fetching once, then saved on this phone…",
    voiceURI: state.voiceURI || STORY_AUTO,
    castCount: 0,
    narratorVoice: getStoryVoice(state.voiceURI)?.name || "",
  };
  emit();
  bindMediaSession();
  startKeepAlive();
  NowPlayingPlayer.onEnded(() => onMediaEnded(token));
  NowPlayingPlayer.onClipStart((clip) => onClipStart(token, clip));
  startIndexSync();
  if (isAndroidAPK()) {
    NowPlayingPlayer.onFault(() => {
      if (token !== iosToken || !isAndroidAPK()) return;
      stopMediaSession();
      state = {
        ...state,
        status: "idle",
        voiceStatus: "error",
        voiceMessage: "Playback stalled. Tap play to continue.",
      };
      emit();
      bindMediaSession();
    });
  } else {
    NowPlayingPlayer.onFault(null);
  }
  NowPlayingPlayer.onNeedData(() => {
    if (token !== iosToken) return;
    if (state.status !== "playing") return;
    void fillMediaQueue(token);
  });
  if (!isDesktopShell()) NowPlayingPlayer.holdOpen();
  void fillMediaQueue(token);
}

function isRemovedAndroidCantonese(uri: string | null): boolean {
  if (!isAndroidChrome() || !uri || uri.startsWith("story:") || isCustomVoiceURI(uri)) return false;
  const voice = (synth()?.getVoices() ?? []).find((item) => item.voiceURI === uri);
  const blob = `${voice?.name ?? ""} ${voice?.lang ?? ""} ${uri}`.toLowerCase();
  if (/tingting|sinji|sin-ji|hokkien|minnan|闽南|台语/.test(blob)) return false;
  return /yue|zh-hk|cantonese|粵語|粤语/.test(blob);
}

let apkToken = 0;

async function speakApkSentence(index: number): Promise<void> {
  const token = ++apkToken;
  const id = (state.voiceURI || "").slice(4);
  const text = state.sentences[index] ?? "";
  try {
    await speakAndroidVoice(id, text, state.rate);
  } catch {
    if (token !== apkToken || state.status !== "playing") return;
    state = {
      ...state,
      status: "paused",
      voiceStatus: "error",
      voiceMessage: "That phone voice did not speak.",
    };
    emit();
    return;
  }
  if (token !== apkToken || state.status !== "playing") return;
  const following = nextSpeakable(index + 1, 1);
  if (following >= state.sentences.length) {
    releasePlayback("idle");
    return;
  }
  state = { ...state, sentenceIndex: following, status: "playing" };
  emit();
  void persistOffset();
  void speakApkSentence(following);
}

function dropRemovedCantonese(): void {
  if (!isRemovedAndroidCantonese(state.voiceURI)) return;
  state = { ...state, voiceURI: STORY_AUTO, voiceMessage: "" };
  emit();
  void saveSettings({ voiceURI: STORY_AUTO, rolesEnabled: false });
}

function speakWithSystem(chained = false): void {
  stopAudio();
  if (isApkVoiceURI(state.voiceURI)) {
    const index = nextSpeakable(state.sentenceIndex, 1);
    if (index < 0 || index >= state.sentences.length) {
      releasePlayback("idle");
      return;
    }
    state = { ...state, sentenceIndex: index, status: "playing", voiceMessage: "" };
    emit();
    void speakApkSentence(index);
    return;
  }
  if (isIOS()) {
    iosToken += 1;
    iosActive = false;
    mediaBusy = false;
    NowPlayingPlayer.onEnded(null);
    NowPlayingPlayer.onClipStart(null);
    NowPlayingPlayer.onTimeUpdate(null);
    NowPlayingPlayer.onFault(null);
  } else if (iosActive) stopMediaSession();
  const s = synth();
  const index = nextSpeakable(state.sentenceIndex, 1);
  if (!s || index < 0 || index >= state.sentences.length) {
    releasePlayback("idle");
    return;
  }
  if (index !== state.sentenceIndex) {
    state = { ...state, sentenceIndex: index };
  }
  const sentence = state.sentences[index]!;
  const lang = detectLanguage(sentence.length >= 12 ? sentence : sentence + (state.sentences[index + 1] ?? ""));
  const pieces = speechPieces(sentence);
  if (!pieces.length) {
    const following = nextSpeakable(index + 1, 1);
    state = { ...state, sentenceIndex: following, status: "playing" };
    emit();
    speakWithSystem(true);
    return;
  }
  state = { ...state, status: "playing" };
  emit();
  if (isIOS()) {
    speakIosOne(index);
    return;
  }
  if (isAndroidChrome()) {
    NowPlayingPlayer.stop();
    stopKeepAlive();
  }
  bindMediaSession();
  if (!isAndroidChrome()) startKeepAlive();
  speakPiece(pieces, 0, lang, chained);
}

function speakIosOne(index: number): void {
  const s = synth();
  if (!s || state.status !== "playing") return;
  const idx = nextSpeakable(index, 1);
  if (idx < 0 || idx >= state.sentences.length) {
    releasePlayback("idle");
    return;
  }
  const parts: { idx: number; text: string }[] = [];
  let total = 0;
  let cursor = idx;
  while (cursor < state.sentences.length && parts.length < 3 && total < 80) {
    const at = nextSpeakable(cursor, 1);
    if (at < 0 || at >= state.sentences.length) break;
    const text = state.sentences[at]!.trim();
    if (!text) {
      cursor = at + 1;
      continue;
    }
    if (total > 0 && total + text.length > 80) break;
    parts.push({ idx: at, text });
    total += text.length;
    cursor = at + 1;
    if (text.length >= 40) break;
  }
  if (!parts.length) {
    releasePlayback("idle");
    return;
  }
  const spoken = parts.map((part) => part.text).join("");
  const lastIdx = parts[parts.length - 1]!.idx;
  const lang = detectLanguage(spoken);
  const gen = ++utteranceGen;
  shouldAdvance = true;
  clearSpeechTimers();
  state = { ...state, status: "playing", sentenceIndex: parts[0]!.idx };
  emit();
  const utterance = buildUtterance(spoken, lang);
  currentUtterance = utterance;
  const started = Date.now();
  const expectMs = Math.max(700, Math.round((spoken.length * 240) / Math.max(0.7, state.rate)));
  let moved = false;
  const goNext = () => {
    if (moved || gen !== utteranceGen || state.status !== "playing") return;
    moved = true;
    clearSpeechTimers();
    currentUtterance = null;
    const following = nextSpeakable(lastIdx + 1, 1);
    if (following >= state.sentences.length) {
      releasePlayback("idle");
      return;
    }
    state = { ...state, sentenceIndex: following, status: "playing" };
    emit();
    persistOffsetSoon();
    speakIosOne(following);
  };
  utterance.onend = () => {
    if (Date.now() - started < 280) return;
    goNext();
  };
  utterance.onerror = (ev) => {
    if (ev.error === "interrupted" || ev.error === "canceled") return;
    if (Date.now() - started < 280) return;
    goNext();
  };
  try {
    if (s.paused) s.resume();
    s.speak(utterance);
  } catch {
    goNext();
  }
  utteranceTimer = window.setTimeout(() => {
    if (gen !== utteranceGen || state.status !== "playing" || moved) return;
    if (s.speaking || s.pending) return;
    goNext();
  }, expectMs + 800);
}

function speakPiece(pieces: string[], part: number, lang: "zh" | "en", chained = false): void {
  const s = synth();
  if (!s || state.status !== "playing") return;
  if (part >= pieces.length) {
    utteranceStalls = 0;
    const following = nextSpeakable(state.sentenceIndex + 1, 1);
    if (following >= state.sentences.length) {
      releasePlayback("idle");
      return;
    }
    state = { ...state, sentenceIndex: following, status: "playing" };
    emit();
    void persistOffset();
    speakWithSystem(true);
    return;
  }

  const gen = ++utteranceGen;
  shouldAdvance = true;
  clearSpeechTimers();
  if (!isIOS()) {
    const live = synth();
    if (live && (live.speaking || live.pending)) silenceSynth();
  }
  const piece = pieces[part]!;
  const utterance = buildUtterance(piece, lang);
  currentUtterance = utterance;

  const finish = (advance: boolean) => {
    if (gen !== utteranceGen || !shouldAdvance || state.status !== "playing") return;
    clearSpeechTimers();
    utteranceGen += 1;
    currentUtterance = null;
    if (!advance) {
      releasePlayback("idle");
      return;
    }
    speakPiece(pieces, part + 1, lang, true);
  };

  utterance.onend = () => {
    utteranceStalls = 0;
    finish(true);
  };
  utterance.onerror = (ev) => {
    if (ev.error === "interrupted" || ev.error === "canceled") return;
    finish(true);
  };

  if (!isIOS()) {
    utteranceTimer = window.setTimeout(() => {
      if (gen !== utteranceGen || state.status !== "playing") return;
      utteranceStalls += 1;
      silenceSynth();
      if (utteranceStalls >= 3) {
        utteranceStalls = 0;
        releasePlayback("idle");
        return;
      }
      finish(true);
    }, utteranceBudget(piece));
  }

  const startPiece = () => {
    if (gen !== utteranceGen || !shouldAdvance || state.status !== "playing") return;
    try {
      if (isAndroidChrome()) {
        utterance.rate = state.rate;
        utterance.pitch = state.pitch;
        if (s.speaking || s.pending) s.cancel();
      }
      if (isIOS() && s.paused) s.resume();
      s.speak(utterance);
    } catch {
      finish(true);
    }
  };
  if (isIOS()) startPiece();
  else speakTimer = window.setTimeout(startPiece, 40);
}

function speakCurrent(): void {
  if (usesMediaPlayback()) {
    if (iosActive && state.status === "playing") {
      void fillMediaQueue(iosToken);
      return;
    }
    kickoffMediaPlayback();
    return;
  }
  speakWithSystem();
}

async function beginCustomVoice(): Promise<void> {
  const id = state.voiceURI?.slice(CUSTOM_VOICE_PREFIX.length) || "";
  const rec = id ? await getVoice(id) : undefined;
  if (rec?.offlineReadURI) {
    offlineReadURI = rec.offlineReadURI;
    state = {
      ...state,
      voiceStatus: "ready",
      voiceMessage: "Reading with the voice saved on this phone. No internet needed.",
    };
    emit();
    speakWithSystem();
    return;
  }
  offlineReadURI = null;
  await playCustomAudio();
}

async function playCustomAudio(): Promise<void> {
  const gen = ++utteranceGen;
  shouldAdvance = false;
  utteranceStalls = 0;
  clearSpeechTimers();
  if (iosActive) stopMediaSession();
  silenceSynth();
  stopAudio();
  stopKeepAlive();
  const id = state.voiceURI?.slice(CUSTOM_VOICE_PREFIX.length);
  if (!id) {
    speakCurrent();
    return;
  }
  state = { ...state, status: "playing", voiceStatus: "loading", voiceMessage: "" };
  emit();
  bindMediaSession();
  const rec = await getVoice(id);
  if (gen !== utteranceGen) return;
  if (!rec?.blob) {
    state = { ...state, status: "idle", voiceStatus: "error", voiceMessage: "That saved voice is missing." };
    emit();
    bindMediaSession();
    return;
  }
  audioUrl = URL.createObjectURL(rec.blob);
  const el = new Audio(audioUrl);
  audioEl = el;
  el.setAttribute("playsinline", "true");
  el.preload = "auto";
  let lastMove = Date.now();
  let lastTime = 0;
  const giveUp = () => {
    if (gen !== utteranceGen) return;
    clearSpeechTimers();
    stopAudio();
    state = { ...state, status: "idle", voiceStatus: "ready", voiceMessage: "" };
    stopKeepAlive();
    emit();
    bindMediaSession();
  };
  el.onended = () => giveUp();
  el.onerror = () => giveUp();
  el.ontimeupdate = () => {
    if (el.currentTime > lastTime + 0.05) {
      lastTime = el.currentTime;
      lastMove = Date.now();
    }
  };
  utteranceTimer = window.setInterval(() => {
    if (gen !== utteranceGen) return;
    if (state.status !== "playing") return;
    if (el.ended) {
      giveUp();
      return;
    }
    const dur = el.duration;
    const tooLong = Number.isFinite(dur) && dur > 0 && el.currentTime >= dur + 1;
    const stalled = Date.now() - lastMove > 12_000 && !el.paused;
    const neverStarted = el.paused && el.currentTime === 0 && Date.now() - lastMove > 6_000;
    if (tooLong || stalled || neverStarted) giveUp();
  }, 1000);
  try {
    await el.play();
    if (gen !== utteranceGen) {
      el.pause();
      return;
    }
    lastMove = Date.now();
    state = { ...state, status: "playing", voiceStatus: "ready", voiceMessage: "" };
    emit();
    bindMediaSession();
    startKeepAlive();
  } catch {
    if (gen === utteranceGen) giveUp();
  }
}

export async function loadDocument(
  doc: DocumentRecord,
  opts?: { rate?: number; pitch?: number; voiceURI?: string | null; rolesEnabled?: boolean },
): Promise<void> {
  installPlaybackGuards();
  const sentences = splitSentences(doc.rawText);
  const max = Math.max(0, sentences.length - 1);
  speakerTags = [];
  state = {
    ...state,
    documentId: doc.id,
    title: doc.title,
    sentences,
    sentenceIndex: Math.min(Math.max(0, doc.sentenceOffset), max),
    rate: opts?.rate ?? state.rate,
    pitch: opts?.pitch ?? state.pitch,
    voiceURI: opts?.voiceURI === undefined ? state.voiceURI : opts.voiceURI,
    rolesEnabled: false,
    status: state.documentId === doc.id ? state.status : "idle",
    castCount: 0,
    currentRole: "",
    narratorVoice: getStoryVoice(opts?.voiceURI === undefined ? state.voiceURI : opts.voiceURI)?.name || "",
  };
  emit();
  speakerTags = [];
}

function restartIfPlaying(): void {
  if (state.status !== "playing") return;
  if (isCustomVoiceURI(state.voiceURI)) void beginCustomVoice();
  else if (usesMediaPlayback()) kickoffMediaPlayback();
  else speakCurrent();
}

export function setVoice(voiceURI: string | null): void {
  const wasPlaying = state.status === "playing";
  const name = getStoryVoice(voiceURI)?.name || "";
  if (!isCustomVoiceURI(voiceURI)) offlineReadURI = null;
  state = { ...state, voiceURI, currentRole: name, rolesEnabled: false, narratorVoice: name };
  emit();
  void saveSettings({ voiceURI, rolesEnabled: false });
  broadcast({ type: "settings" });
  if (isIOS() && !usesMediaPlayback()) {
    NowPlayingPlayer.closeIosEngine();
    iosToken += 1;
    iosActive = false;
    mediaBusy = false;
    utteranceGen += 1;
    shouldAdvance = false;
    clearSpeechTimers();
    currentUtterance = null;
    if (wasPlaying) {
      state = { ...state, status: "paused" };
      emit();
    }
    return;
  }
  if (isIOS() && wasPlaying) {
    utteranceGen += 1;
    shouldAdvance = false;
    clearSpeechTimers();
    currentUtterance = null;
    silenceSynth();
  }
  restartIfPlaying();
}

export async function requestVoiceChange(uri: string | null): Promise<null> {
  setVoice(uri);
  return null;
}

export function getActiveCast(): null {
  return null;
}

export async function reshuffleActiveCast(): Promise<null> {
  return null;
}

export async function confirmSavedMix(): Promise<void> {}
export async function confirmNewMix(): Promise<void> {}
export async function confirmNewMixKeepVoice(): Promise<void> {}
export async function exportVoiceBankBlob(): Promise<Blob> {
  return new Blob(["{}"], { type: "application/json" });
}
export async function importVoiceBankRaw(): Promise<{ count: number }> {
  return { count: 0 };
}

export async function play(doc?: DocumentRecord): Promise<void> {
  primeFromGesture();
  if (!usesMediaPlayback() && !isIOS()) await waitForVoices();
  else if (!usesMediaPlayback()) listVoices();
  const alreadyOpen = !!doc && state.documentId === doc.id && state.sentences.length > 0;
  if (doc && !alreadyOpen) await loadDocument(doc);
  if (isCustomVoiceURI(state.voiceURI)) {
    await beginCustomVoice();
    return;
  }
  if (!state.sentences.length) return;
  if (state.status === "paused" && !doc) {
    if (iosActive || synth()?.paused) {
      resume();
      return;
    }
  }
  speakCurrent();
}

export function pause(): void {
  if (state.status !== "playing") return;
  const keepCustomWatch = isCustomVoiceURI(state.voiceURI) && !!audioEl;
  if (!keepCustomWatch) {
    utteranceGen += 1;
    apkToken += 1;
    shouldAdvance = false;
    clearSpeechTimers();
    currentUtterance = null;
    silenceSynth();
    void stopAndroidVoice();
  }
  if (audioEl) audioEl.pause();
  NowPlayingPlayer.noteUserPause();
  NowPlayingPlayer.pause();
  state = { ...state, status: "paused" };
  stopKeepAlive();
  emit();
  bindMediaSession();
  void persistOffset();
}

export function resume(): void {
  primeFromGesture();
  if (iosActive && usesMediaPlayback() && state.status === "paused") {
    startKeepAlive();
    void NowPlayingPlayer.resume()
      .then(() => {
        if ((isIOSChrome() || isAndroidChrome()) && !NowPlayingPlayer.canContinue()) {
          kickoffMediaPlayback();
          return;
        }
        state = { ...state, status: "playing" };
        emit();
        bindMediaSession();
      })
      .catch(() => {
        kickoffMediaPlayback();
      });
    return;
  }
  if (isCustomVoiceURI(state.voiceURI) && audioEl && state.status === "paused") {
    startKeepAlive();
    void audioEl.play()
      .then(() => {
        state = { ...state, status: "playing" };
        emit();
        bindMediaSession();
      })
      .catch(() => {
        releasePlayback("idle");
      });
    return;
  }
  if (isCustomVoiceURI(state.voiceURI)) {
    void beginCustomVoice();
    return;
  }
  if (usesMediaPlayback() && state.sentences.length) {
    speakCurrent();
    return;
  }
  if (state.sentences.length) speakWithSystem();
}

export function stop(): void {
  NowPlayingPlayer.noteUserPause();
  releasePlayback("idle");
}

export async function skip(delta: number): Promise<void> {
  if (audioEl) {
    audioEl.currentTime = Math.max(0, audioEl.currentTime + delta * 15);
    return;
  }
  if (!state.sentences.length) return;
  const next = Math.min(
    Math.max(0, state.sentenceIndex + delta),
    Math.max(0, state.sentences.length - 1),
  );
  state = { ...state, sentenceIndex: next };
  emit();
  void persistOffset();
  if (state.status === "playing") {
    if (isCustomVoiceURI(state.voiceURI)) void beginCustomVoice();
    else if (usesMediaPlayback()) kickoffMediaPlayback();
    else speakCurrent();
  } else if (iosActive) {
    stopMediaSession();
  }
}

export async function jumpTo(index: number, andPlay = false): Promise<void> {
  if (!state.sentences.length) return;
  const next = Math.min(Math.max(0, index), Math.max(0, state.sentences.length - 1));
  const wasPlaying = andPlay || state.status === "playing";
  if (!wasPlaying && iosActive) stopMediaSession();
  state = {
    ...state,
    sentenceIndex: next,
    status: wasPlaying ? "playing" : state.status,
    currentRole: "",
  };
  emit();
  void persistOffset();
  if (wasPlaying) {
    if (isCustomVoiceURI(state.voiceURI)) void beginCustomVoice();
    else if (usesMediaPlayback()) kickoffMediaPlayback();
    else speakCurrent();
  }
}

export async function speakSnippet(text: string): Promise<void> {
  const clean = text.replace(/\s+/g, " ").trim().slice(0, 500);
  if (!clean) return;
  if (state.status === "playing") pause();
  const langHint = detectLanguage(clean);
  if (usesMediaPlayback() && (langHint === "zh" || langHint === "en" || /[\u4e00-\u9fff]/.test(clean))) {
    const blob = await speakWithStoryteller(clean, langHint === "en" ? "en" : "zh", state.voiceURI || STORY_AUTO, state.rate);
    stopAudio();
    const url = URL.createObjectURL(blob);
    audioUrl = url;
    const audio = new Audio();
    audioEl = audio;
    audio.src = url;
    audio.setAttribute("playsinline", "true");
    await audio.play();
    return;
  }
  const s = synth();
  if (!s) return;
  cancelSpeech();
  const utterance = new SpeechSynthesisUtterance(clean);
  utterance.rate = state.rate;
  if (/[\u4e00-\u9fff]/.test(clean)) utterance.lang = "zh-CN";
  else if (/[\u3040-\u30ff]/.test(clean)) utterance.lang = "ja-JP";
  else if (/[\uac00-\ud7af]/.test(clean)) utterance.lang = "ko-KR";
  else if (/[\u0e00-\u0e7f]/.test(clean)) utterance.lang = "th-TH";
  else if (/[\u1780-\u17ff]/.test(clean)) utterance.lang = "km-KH";
  else if (/[\u0e80-\u0eff]/.test(clean)) utterance.lang = "lo-LA";
  else utterance.lang = langHint === "zh" ? "zh-CN" : "en-US";
  s.speak(utterance);
}

export function setRate(rate: number): void {
  state = { ...state, rate };
  emit();
  void saveSettings({ rate });
  broadcast({ type: "settings" });
  if (state.status !== "playing") return;
  if (isAndroidChrome() && !usesMediaPlayback()) {
    silenceSynth();
    currentUtterance = null;
    speakWithSystem();
    return;
  }
  speakCurrent();
}

export function setPitch(pitch: number): void {
  state = { ...state, pitch };
  emit();
  void saveSettings({ pitch });
  broadcast({ type: "settings" });
  if (state.status === "playing" && !isIOSDevice()) speakCurrent();
}


export function setRolesEnabled(_on: boolean): void {
  state = { ...state, rolesEnabled: false, currentRole: "" };
  emit();
}

export async function enableRolesWithChoice(_presetId: string | null): Promise<void> {
  setRolesEnabled(false);
}

export function applySettings(opts: { rate?: number; pitch?: number; voiceURI?: string | null; rolesEnabled?: boolean }): void {
  state = {
    ...state,
    rate: opts.rate ?? state.rate,
    pitch: opts.pitch ?? state.pitch,
    voiceURI: opts.voiceURI === undefined ? state.voiceURI : opts.voiceURI,
    rolesEnabled: opts.rolesEnabled ?? state.rolesEnabled,
  };
  emit();
}

export function syncExternalOffset(documentId: string, sentenceOffset: number): void {
  if (externalSync) return;
  if (state.documentId !== documentId) return;
  if (state.status === "playing") return;
  if (state.sentenceIndex === sentenceOffset) return;
  externalSync = true;
  state = { ...state, sentenceIndex: sentenceOffset };
  emit();
  externalSync = false;
}

export async function hydrateFromId(id: string): Promise<void> {
  const doc = await getDocument(id);
  if (doc) await loadDocument(doc);
}

export const SpeechManager = {
  subscribe,
  getState,
  listVoices,
  waitForVoices,
  pickVoice,
  loadDocument,
  play,
  pause,
  resume,
  stop,
  skip,
  jumpTo,
  setRate,
  setPitch,
  setVoice,
  requestVoiceChange,
  confirmSavedMix,
  confirmNewMix,
  confirmNewMixKeepVoice,
  setRolesEnabled,
  enableRolesWithChoice,
  speakSnippet,
  applySettings,
  syncExternalOffset,
  hydrateFromId,
  splitSentences,
  isCustomVoiceURI,
  isIOSDevice,
  primeFromGesture,
  usesSystemVoice,
  getActiveCast,
  reshuffleActiveCast,
  exportVoiceBankBlob,
  importVoiceBankRaw,
  triggerScrollToActive,
  subscribeScrollToActive,
  setRenderedRange,
};
