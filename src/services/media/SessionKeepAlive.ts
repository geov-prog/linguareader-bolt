import { makeHoldPad } from "@/services/media/wav";
import { isIOS } from "@/utils/platform";

/**
 * Keeps Blink (Android Chrome / desktop Chrome) treating LinguaReader as
 * playing media. iOS WebKit uses a gesture-unlocked AudioContext only —
 * the silent oscillator loop fights MediaSession there.
 */
let ctx: AudioContext | null = null;
let osc: OscillatorNode | null = null;
let gain: GainNode | null = null;
let el: HTMLAudioElement | null = null;
let url: string | null = null;
let ping: number | null = null;
let running = false;

function webkitAudioContext(): typeof AudioContext | undefined {
  return (
    window.AudioContext ||
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  );
}

/** Call this synchronously inside the Play tap, before any await. */
export function unlockIosAudio(): void {
  if (!isIOS() || typeof window === "undefined") return;
  const AC = webkitAudioContext();
  if (!AC) return;
  if (!ctx) ctx = new AC();
  if (ctx.state === "suspended") {
    void ctx.resume();
  }
}

function claimSession(): void {
  const nav = navigator as Navigator & { audioSession?: { type: string } };
  try {
    if (nav.audioSession) nav.audioSession.type = "playback";
  } catch {
    /* ignore */
  }
}

function ensureElement(): HTMLAudioElement {
  if (el) return el;
  const audio = document.createElement("audio");
  audio.setAttribute("playsinline", "true");
  audio.setAttribute("webkit-playsinline", "true");
  (audio as HTMLAudioElement & { playsInline?: boolean }).playsInline = true;
  audio.preload = "auto";
  audio.loop = true;
  audio.muted = false;
  audio.defaultMuted = false;
  audio.volume = 0.06;
  audio.setAttribute("aria-hidden", "true");
  Object.assign(audio.style, {
    position: "fixed",
    width: "1px",
    height: "1px",
    opacity: "0.01",
    pointerEvents: "none",
    left: "0",
    bottom: "0",
  });
  document.body.appendChild(audio);
  el = audio;
  return audio;
}

function ensurePad(): void {
  const audio = ensureElement();
  if (url && audio.src) return;
  if (url) URL.revokeObjectURL(url);
  const blob = makeHoldPad(12);
  url = URL.createObjectURL(blob);
  audio.src = url;
  audio.loop = true;
}

function startContext(): void {
  const AC = webkitAudioContext();
  if (!AC) return;
  ctx ??= new AC();
  void ctx.resume();
  if (osc) return;
  gain = ctx.createGain();
  gain.gain.value = 0.0015;
  osc = ctx.createOscillator();
  osc.frequency.value = 48;
  osc.type = "sine";
  osc.connect(gain);
  gain.connect(ctx.destination);
  try {
    osc.start();
  } catch {
    osc = null;
  }
}

function nudge(): void {
  if (!running) return;
  claimSession();
  if (ctx?.state === "suspended") void ctx.resume();
  const audio = el;
  if (audio && (audio.paused || audio.ended)) {
    void audio.play().catch(() => undefined);
  }
}

function onVis(): void {
  if (!running) return;
  nudge();
}

export const SessionKeepAlive = {
  start(useWebAudio = true): void {
    if (typeof window === "undefined") return;
    if (isIOS()) {
      claimSession();
      if (useWebAudio) unlockIosAudio();
      return;
    }
    claimSession();
    running = true;
    ensurePad();
    startContext();
    const audio = ensureElement();
    void audio.play().catch(() => undefined);
    if (ping == null) ping = window.setInterval(nudge, 12_000);
    document.removeEventListener("visibilitychange", onVis);
    document.addEventListener("visibilitychange", onVis);
    window.removeEventListener("pageshow", onVis);
    window.addEventListener("pageshow", onVis);
  },

  holdSpeech(): void {
    this.start(false);
  },

  stop(): void {
    running = false;
    if (ping != null) {
      window.clearInterval(ping);
      ping = null;
    }
    document.removeEventListener("visibilitychange", onVis);
    window.removeEventListener("pageshow", onVis);
    if (el) {
      el.pause();
    }
    if (ctx && ctx.state !== "closed") {
      void ctx.suspend();
    }
  },
};
