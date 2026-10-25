import { makeHoldPad } from "@/services/media/wav";
import { isAndroidAPK, isAndroidChrome, isInstalledAndroidApp, isIOS, isIOSChrome } from "@/utils/platform";

export type VoiceClip = {
  indices: number[];
  label: string;
};

type QueueItem = { blob: Blob; clip: VoiceClip };
type EndedHandler = () => void;
type ClipHandler = (clip: VoiceClip) => void;
type TimeHandler = (seconds: number) => void;
type NeedHandler = () => void;

function claimPlaybackSession(): void {
  const nav = navigator as Navigator & { audioSession?: { type: string } };
  try {
    if (nav.audioSession) nav.audioSession.type = "playback";
  } catch {
    /* ignore */
  }
}

function isPhoneChrome(): boolean {
  return isIOSChrome() || isAndroidChrome();
}

function pageHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

class NowPlayingPlayerImpl {
  private audio: HTMLAudioElement | null = null;
  private queue: QueueItem[] = [];
  private currentUrl: string | null = null;
  private currentItem: QueueItem | null = null;
  private endedCb: EndedHandler | null = null;
  private clipCb: ClipHandler | null = null;
  private timeCb: TimeHandler | null = null;
  private needCb: NeedHandler | null = null;
  private active = false;
  private advancing = false;
  private holding = false;
  private loading = false;
  private playingVoice = false;
  private wantPlaying = false;
  private recovering = false;
  private resumeTimer: number | null = null;
  private watchTimer: number | null = null;
  private holdBlob: Blob | null = null;
  private sessionPauseAt = 0;
  private lastRecoverAt = 0;
  private clipHeard = 0;
  private clipDur = 0;
  private clipFinished = false;
  private clipStartedAt = 0;
  private clipReplays = 0;
  private playGen = 0;
  private lastHeard = 0;
  private lastProgressAt = 0;
  private mediaStalls = 0;
  private faultCb: (() => void) | null = null;
  private iosCtx: AudioContext | null = null;
  private iosSource: AudioBufferSourceNode | null = null;
  private iosBuffer: AudioBuffer | null = null;
  private iosOffset = 0;
  private iosStarted = 0;
  private iosLive = false;
  private iosEndTimer: number | null = null;
  private clipEndedAt = 0;
  private chromeCtx: AudioContext | null = null;
  private chromeGain: GainNode | null = null;

  private clearIosEndTimer(): void {
    if (this.iosEndTimer != null) {
      window.clearTimeout(this.iosEndTimer);
      this.iosEndTimer = null;
    }
  }

  private setChromeLoudness(voice: boolean): void {
    if (!this.chromeGain) return;
    const boosted = isInstalledAndroidApp() ? 3.4 : 2.6;
    this.chromeGain.gain.value = voice ? boosted : 1;
  }

  private boostAndroidChrome(audio: HTMLAudioElement): void {
    if (!(isAndroidChrome() || isInstalledAndroidApp()) || this.chromeGain) return;
    const AC =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    try {
      const ctx = new AC();
      const source = ctx.createMediaElementSource(audio);
      const gain = ctx.createGain();
      gain.gain.value = 1;
      const limit = ctx.createDynamicsCompressor();
      limit.threshold.value = -4;
      limit.knee.value = 4;
      limit.ratio.value = 10;
      limit.attack.value = 0.003;
      limit.release.value = 0.1;
      source.connect(gain);
      gain.connect(limit);
      limit.connect(ctx.destination);
      this.chromeCtx = ctx;
      this.chromeGain = gain;
    } catch {
      this.chromeCtx = null;
      this.chromeGain = null;
    }
  }

  private ensureAudio(): HTMLAudioElement {
    if (this.audio) return this.audio;
    const audio = document.createElement("audio");
    audio.setAttribute("playsinline", "true");
    audio.setAttribute("webkit-playsinline", "true");
    audio.setAttribute("x-webkit-airplay", "allow");
    (audio as HTMLAudioElement & { playsInline?: boolean }).playsInline = true;
    audio.preload = "auto";
    audio.autoplay = false;
    audio.controls = false;
    audio.loop = false;
    audio.muted = false;
    audio.defaultMuted = false;
    audio.volume = 1;
    audio.setAttribute("aria-hidden", "true");
    Object.assign(audio.style, {
      position: "fixed",
      width: "1px",
      height: "1px",
      opacity: "0.01",
      pointerEvents: "none",
      bottom: "0",
      left: "0",
    });
    audio.addEventListener("ended", () => this.onEndedEvent());
    audio.addEventListener("pause", () => this.onPauseEvent());
    audio.addEventListener("stalled", () => {
      if (!isAndroidAPK() || this.isActivelyPlaying()) return;
      this.scheduleResume(400);
    });
    audio.addEventListener("waiting", () => {
      if (!isAndroidAPK() || this.isActivelyPlaying()) return;
      this.scheduleResume(800);
    });
    audio.addEventListener("error", () => this.onErrorEvent());
    audio.addEventListener("playing", () => {
      this.recovering = false;
      this.lastRecoverAt = Date.now();
      this.clipStartedAt = Date.now();
    });
    audio.addEventListener("loadedmetadata", () => {
      const d = this.audio?.duration;
      if (d && Number.isFinite(d) && d > 0) this.clipDur = d;
    });
    audio.addEventListener("timeupdate", () => {
      if (this.holding) return;
      const audioEl = this.audio;
      if (!audioEl) return;
      const t = audioEl.currentTime;
      if (Number.isFinite(t) && t > this.clipHeard) this.clipHeard = t;
      if (Number.isFinite(t) && t > this.lastHeard + 0.05) {
        this.lastHeard = t;
        this.lastProgressAt = Date.now();
        this.mediaStalls = 0;
      }
      const d = audioEl.duration;
      if (d && Number.isFinite(d) && d > 0) this.clipDur = d;
      this.timeCb?.(t);
    });
    document.body.appendChild(audio);
    this.audio = audio;
    this.boostAndroidChrome(audio);
    this.bindAudioSession();
    this.startWatch();
    return audio;
  }

  private bindAudioSession(): void {
    const nav = navigator as Navigator & {
      audioSession?: { type: string; state?: string; addEventListener?: (name: string, cb: () => void) => void };
    };
    if (!nav.audioSession?.addEventListener) return;
    nav.audioSession.addEventListener("statechange", () => {
      claimPlaybackSession();
      if (nav.audioSession?.state === "interrupted") return;
      if (this.wantPlaying && !this.isActivelyPlaying()) this.scheduleResume(120);
    });
  }

  private isActivelyPlaying(): boolean {
    if (isIOS() && this.iosLive) return true;
    const audio = this.audio;
    if (!audio || this.holding || !this.active) return false;
    if (audio.ended) return false;
    if (audio.paused) return false;
    return true;
  }

  private startWatch(): void {
    if (this.watchTimer != null) return;
    this.watchTimer = window.setInterval(() => {
      if (!this.wantPlaying || !this.active || this.advancing || this.loading) return;
      if (isIOS()) return;
      const audio = this.audio;
      if (!audio) return;
      if (this.isActivelyPlaying() && !this.holding) {
        if (isAndroidAPK()) {
          if (!this.lastProgressAt) this.lastProgressAt = Date.now();
          if (Date.now() - this.lastProgressAt > 15_000) {
            this.mediaStalls += 1;
            this.lastProgressAt = Date.now();
            if (this.mediaStalls >= 2) {
              this.wantPlaying = false;
              this.stop();
              this.faultCb?.();
              return;
            }
            this.advance();
          }
        }
        return;
      }
      if (this.isActivelyPlaying()) return;
      if (audio.ended) {
        this.onEndedEvent();
        return;
      }
      if (this.endedNaturally()) {
        this.onEndedEvent();
        return;
      }
      if (audio.paused) this.scheduleResume(0);
    }, 1400);
  }

  private fromLockScreenPause(): boolean {
    return Date.now() - this.sessionPauseAt < 400;
  }

  private elapsedSeconds(): number {
    if (!this.clipStartedAt) return 0;
    return (Date.now() - this.clipStartedAt) / 1000;
  }

  private endedNaturally(): boolean {
    if (this.holding) return false;
    const audio = this.audio;
    if (audio?.ended) return true;
    const dur = this.clipDur;
    const heard = this.clipHeard;
    const elapsed = this.elapsedSeconds();
    if (dur > 0.25 && heard >= dur * 0.97) return true;
    // Only use wall-clock when the element is no longer playing. Chrome
    // background tabs often skip timeupdate/ended; never cut a live clip.
    if (this.isActivelyPlaying()) return false;
    if (dur > 0.25 && elapsed >= dur + 0.35) return true;
    return false;
  }

  private shouldReplayEarlyEnd(): boolean {
    if (this.clipReplays >= 1) return false;
    if (pageHidden()) return false;
    if (this.endedNaturally()) return false;
    const dur = this.clipDur;
    const elapsed = this.elapsedSeconds();
    const heard = this.clipHeard;
    if (dur > 0.45 && (elapsed >= dur * 0.5 || heard >= dur * 0.5)) return false;
    return elapsed < 0.55 && heard < 0.35;
  }

  private onPauseEvent(): void {
    if (!this.wantPlaying || !this.active) return;
    if (this.fromLockScreenPause()) return;
    const audio = this.audio;
    if (audio?.ended || this.endedNaturally()) {
      this.clipFinished = true;
      this.advance();
      return;
    }
    this.scheduleResume(280);
  }

  private onEndedEvent(): void {
    if (this.holding) {
      if (this.wantPlaying) this.scheduleResume(80);
      return;
    }
    if (this.advancing) return;
    if (!isIOS() && this.shouldReplayEarlyEnd()) {
      this.clipReplays += 1;
      this.scheduleResume(80);
      return;
    }
    this.clipFinished = true;
    this.advance();
  }

  private onErrorEvent(): void {
    if (!this.active || !this.wantPlaying) return;
    if (this.endedNaturally() || this.clipReplays >= 1) {
      this.advance();
      return;
    }
    this.scheduleResume(200);
  }

  private scheduleResume(delay: number): void {
    if (!this.wantPlaying || !this.active) return;
    if (this.advancing) return;
    if (this.resumeTimer != null) return;
    this.resumeTimer = window.setTimeout(() => {
      this.resumeTimer = null;
      void this.recoverPlayback();
    }, delay);
  }

  private async recoverPlayback(): Promise<void> {
    if (!this.wantPlaying || !this.active || this.recovering) return;
    if (this.advancing) return;
    if (this.isActivelyPlaying()) return;
    if (isIOS()) {
      if (this.iosBuffer) {
        this.startIosSource();
        return;
      }
      if (this.currentItem) {
        await this.loadAndPlay(this.currentItem, true);
      }
      return;
    }
    if (!this.wantPlaying || !this.active || this.recovering) return;
    if (this.advancing) return;
    if (this.isActivelyPlaying()) return;
    if (Date.now() - this.lastRecoverAt < 200) return;
    this.recovering = true;
    this.lastRecoverAt = Date.now();
    claimPlaybackSession();
    const audio = this.ensureAudio();
    try {
      if (audio.ended || this.endedNaturally()) {
        this.advance();
        return;
      }
      if (!audio.paused && !audio.ended) return;
      if (!audio.src) {
        if (this.holding) {
          this.holdBlob ??= makeHoldPad(10);
          this.assign(this.holdBlob, true);
          await audio.play();
          if (!this.wantPlaying) audio.pause();
          return;
        }
        this.advance();
        return;
      }
      await audio.play();
      if (!this.wantPlaying) audio.pause();
    } catch {
      try {
        if (this.endedNaturally() || this.clipReplays >= 1) {
          this.advance();
          return;
        }
        if (this.currentItem && !pageHidden()) {
          await this.loadAndPlay(this.currentItem, true);
          return;
        }
        this.advance();
      } catch {
        this.needCb?.();
      }
    } finally {
      this.recovering = false;
    }
  }

  private revoke(): void {
    if (this.currentUrl) {
      URL.revokeObjectURL(this.currentUrl);
      this.currentUrl = null;
    }
  }

  private assign(blob: Blob, loop: boolean): void {
    const audio = this.ensureAudio();
    this.revoke();
    this.currentUrl = URL.createObjectURL(blob);
    audio.loop = loop;
    audio.muted = false;
    audio.defaultMuted = false;
    audio.volume = 1;
    this.setChromeLoudness(!loop);
    audio.src = this.currentUrl;
  }

  private armIosOutput(): void {
    if (!isIOS() || typeof window === "undefined") return;
    const AC =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    if (!this.iosCtx) this.iosCtx = new AC();
    if (this.iosCtx.state === "suspended") void this.iosCtx.resume();
    const buf = this.iosCtx.createBuffer(1, 1, 22050);
    const src = this.iosCtx.createBufferSource();
    src.buffer = buf;
    src.connect(this.iosCtx.destination);
    try {
      src.start();
    } catch {
      /* already started */
    }
  }

  private stopIosSource(keepOffset: boolean): void {
    this.clearIosEndTimer();
    const ctx = this.iosCtx;
    if (keepOffset && ctx && this.iosLive) {
      this.iosOffset += Math.max(0, ctx.currentTime - this.iosStarted);
    }
    const src = this.iosSource;
    this.iosSource = null;
    this.iosLive = false;
    if (!src) return;
    src.onended = null;
    try {
      src.stop();
    } catch {
      /* already stopped */
    }
  }

  private startIosSource(): void {
    const ctx = this.iosCtx;
    const buffer = this.iosBuffer;
    if (!ctx || !buffer) return;
    this.stopIosSource(false);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = 2.8;
    const limit = ctx.createDynamicsCompressor();
    limit.threshold.value = -3;
    limit.knee.value = 0;
    limit.ratio.value = 12;
    limit.attack.value = 0.002;
    limit.release.value = 0.08;
    src.connect(gain);
    gain.connect(limit);
    limit.connect(ctx.destination);
    const offset = Math.min(Math.max(0, this.iosOffset), Math.max(0, buffer.duration - 0.05));
    src.onended = () => {
      if (this.iosSource !== src || !this.wantPlaying) return;
      this.clearIosEndTimer();
      this.iosLive = false;
      this.iosSource = null;
      this.iosOffset = 0;
      this.clipFinished = true;
      this.advance();
    };
    this.iosSource = src;
    this.iosLive = true;
    this.iosStarted = ctx.currentTime;
    this.clipStartedAt = Date.now();
    this.clipDur = buffer.duration;
    this.playingVoice = true;
    this.holding = false;
    try {
      src.start(0, offset);
    } catch {
      this.iosLive = false;
      return;
    }
  }

  private async playIosClip(item: QueueItem, gen: number): Promise<void> {
    this.armIosOutput();
    const ctx = this.iosCtx;
    if (!ctx) throw new Error("no ios audio");
    if (ctx.state === "suspended") await ctx.resume();
    this.stopIosSource(false);
    const bytes = await item.blob.arrayBuffer();
    if (gen !== this.playGen) return;
    const decoded = await ctx.decodeAudioData(bytes.slice(0));
    if (gen !== this.playGen || !this.wantPlaying) return;
    if (!decoded || decoded.duration < 0.05) throw new Error("empty clip");
    this.iosBuffer = decoded;
    this.iosOffset = 0;
    this.startIosSource();
    if (!this.iosLive) throw new Error("ios voice did not start");
  }

  private async loadAndPlay(item: QueueItem, replay = false): Promise<void> {
    const gen = ++this.playGen;
    claimPlaybackSession();
    this.holding = false;
    this.loading = true;
    this.playingVoice = true;
    this.wantPlaying = true;
    this.currentItem = item;
    this.clipHeard = 0;
    this.clipDur = 0;
    this.clipFinished = false;
    this.clipStartedAt = 0;
    this.clipReplays = replay ? this.clipReplays + 1 : 0;
    if (isIOS()) {
      try {
        await this.playIosClip(item, gen);
        if (gen !== this.playGen) return;
        if (!replay) this.clipCb?.(item.clip);
      } catch {
        if (gen !== this.playGen) return;
        this.playingVoice = false;
        this.iosBuffer = null;
        this.iosOffset = 0;
        if (this.clipReplays < 1) this.scheduleResume(180);
        else this.advance();
      } finally {
        if (gen === this.playGen) this.loading = false;
      }
      return;
    }
    this.assign(item.blob, false);
    if (!replay) this.clipCb?.(item.clip);
    const audio = this.ensureAudio();
    try {
      if (this.chromeCtx?.state === "suspended") await this.chromeCtx.resume();
      await audio.play();
      if (gen !== this.playGen || !this.wantPlaying) {
        audio.pause();
        return;
      }
      if (!this.clipStartedAt) this.clipStartedAt = Date.now();
    } catch {
      if (gen !== this.playGen) return;
      try {
        await audio.play();
        if (gen !== this.playGen || !this.wantPlaying) {
          audio.pause();
          return;
        }
        if (!this.clipStartedAt) this.clipStartedAt = Date.now();
      } catch {
        this.scheduleResume(350);
      }
    } finally {
      if (gen === this.playGen) this.loading = false;
    }
  }

  private advance(): void {
    if (!this.wantPlaying) return;
    if (this.advancing) return;
    if (this.holding && !isIOS()) return;
    if (isIOS()) this.clipEndedAt = Date.now();
    this.advancing = true;
    this.clipFinished = false;
    this.clipHeard = 0;
    this.clipStartedAt = 0;
    this.clipReplays = 0;
    const next = this.queue.shift();
    if (next) {
      this.endedCb?.();
      void this.loadAndPlay(next).finally(() => {
        this.advancing = false;
      });
      return;
    }
    this.playingVoice = false;
    this.currentItem = null;
    this.endedCb?.();
    this.advancing = false;
    if (this.wantPlaying) this.fillHold();
    this.needCb?.();
  }

  fillHold(): void {
    if (isIOS()) {
      this.armIosOutput();
      this.holding = true;
      return;
    }
    if (!this.wantPlaying) return;
    if (this.playingVoice || this.loading) return;
    if (this.holding && this.isActivelyPlaying()) return;
    claimPlaybackSession();
    const audio = this.ensureAudio();
    this.holding = true;
    this.holdBlob ??= makeHoldPad(12);
    this.assign(this.holdBlob, true);
    this.active = true;
    const playResult = audio.play();
    if (playResult && typeof playResult.then === "function") {
      void playResult.then(() => {
        if (!this.wantPlaying) audio.pause();
      }).catch(() => this.scheduleResume(160));
    }
  }

  quietForPhoneVoice(): void {
    if (!isIOS()) return;
    this.playGen += 1;
    this.clearIosEndTimer();
    this.stopIosSource(false);
    this.iosBuffer = null;
    this.iosOffset = 0;
    this.queue = [];
    this.currentItem = null;
    this.holding = false;
    this.playingVoice = false;
    this.wantPlaying = false;
    this.loading = false;
    this.advancing = false;
    const ctx = this.iosCtx;
    if (ctx && ctx.state === "running") void ctx.suspend();
  }

  closeIosEngine(): void {
    if (!isIOS()) return;
    this.playGen += 1;
    this.stopIosSource(false);
    this.iosBuffer = null;
    this.iosOffset = 0;
    this.queue = [];
    this.currentItem = null;
    this.holding = false;
    this.playingVoice = false;
    this.wantPlaying = false;
    this.loading = false;
    const ctx = this.iosCtx;
    this.iosCtx = null;
    if (ctx && ctx.state !== "closed") void ctx.close();
  }

  releaseIosOutput(): void {
    if (!isIOS()) return;
    this.stopIosSource(false);
    this.iosBuffer = null;
    this.iosOffset = 0;
    this.holding = false;
    this.playingVoice = false;
    this.wantPlaying = false;
  }

  holdOpen(): void {
    claimPlaybackSession();
    if (isIOS()) {
      this.armIosOutput();
      this.wantPlaying = true;
      this.active = true;
      if (this.holding && !this.iosLive && !this.playingVoice && this.queue.length === 0) return;
      this.playGen += 1;
      this.stopIosSource(false);
      this.iosBuffer = null;
      this.iosOffset = 0;
      this.queue = [];
      this.currentItem = null;
      this.advancing = false;
      this.loading = false;
      this.playingVoice = false;
      this.holding = true;
      return;
    }
    const audio = this.ensureAudio();
    this.wantPlaying = true;
    if (this.holding && !audio.paused && !audio.ended) return;
    this.queue = [];
    this.currentItem = null;
    this.advancing = false;
    this.loading = false;
    this.playingVoice = false;
    this.clipFinished = false;
    this.clipHeard = 0;
    this.clipStartedAt = 0;
    this.clipReplays = 0;
    this.holding = true;
    this.holdBlob ??= makeHoldPad(10);
    this.assign(this.holdBlob, true);
    this.active = true;
    const playResult = audio.play();
    if (playResult && typeof playResult.then === "function") {
      void playResult.then(() => {
        if (!this.wantPlaying) audio.pause();
      }).catch(() => this.scheduleResume(200));
    }
  }

  playNow(blob: Blob, clip: VoiceClip = { indices: [], label: "" }): void {
    claimPlaybackSession();
    this.queue = [];
    this.advancing = false;
    this.holding = false;
    this.wantPlaying = true;
    this.clipReplays = 0;
    void this.loadAndPlay({ blob, clip });
    this.active = true;
  }

  enqueue(blob: Blob, clip: VoiceClip = { indices: [], label: "" }): boolean {
    if (isPhoneChrome() && !this.wantPlaying) return false;
    const item = { blob, clip };
    this.wantPlaying = true;
    if (isIOS() && !this.iosLive && !this.loading) {
      if (this.queue.length > 0) this.queue.push(item);
      const next = this.queue.length > 0 ? this.queue.shift() : item;
      if (next) void this.loadAndPlay(next);
      this.active = true;
      return true;
    }
    if (this.holding && !this.loading && !this.playingVoice && this.queue.length === 0) {
      void this.loadAndPlay(item);
      this.active = true;
      return true;
    }
    if (this.loading || this.playingVoice || this.queue.length > 0) {
      this.queue.push(item);
      return true;
    }
    const audio = this.audio;
    if (this.wantPlaying && this.currentItem && audio?.paused && !audio.ended) {
      this.queue.push(item);
      this.scheduleResume(0);
      return true;
    }
    const idle = !audio || audio.paused || audio.ended || !this.active;
    if (idle) {
      void this.loadAndPlay(item);
      this.active = true;
      return true;
    }
    this.queue.push(item);
    return true;
  }

  queued(): number {
    return this.queue.length;
  }

  isHolding(): boolean {
    return this.holding;
  }

  isPlayingVoice(): boolean {
    if (this.loading || this.playingVoice) return true;
    return this.isActivelyPlaying();
  }

  isAudible(): boolean {
    if (isIOS() && this.iosLive) return true;
    const audio = this.audio;
    if (!audio || this.holding || audio.paused || audio.ended) return false;
    return true;
  }

  /** True when a storyteller clip can carry on after Pause. */
  canContinue(): boolean {
    if (this.iosLive || this.loading) return true;
    if (isIOS() && this.iosBuffer && this.iosBuffer.duration > 0.05) return true;
    const audio = this.audio;
    return !!(audio && this.currentItem && audio.src && !audio.ended);
  }

  /** Chrome on a phone sends a Play signal of its own just after the user stops. */
  rejectAutoPlay(): boolean {
    if (!isPhoneChrome() || this.wantPlaying) return false;
    return Date.now() - this.sessionPauseAt < 3000;
  }

  shouldIgnoreAutoPause(): boolean {
    if (!isIOS() || !this.wantPlaying) return false;
    if (this.iosLive) return false;
    if (this.loading || this.advancing) return true;
    return Date.now() - this.clipEndedAt < 800;
  }

  noteUserPause(): void {
    this.sessionPauseAt = Date.now();
    this.wantPlaying = false;
  }

  pause(): void {
    this.wantPlaying = false;
    if (isPhoneChrome()) this.playGen += 1;
    if (this.resumeTimer != null) {
      window.clearTimeout(this.resumeTimer);
      this.resumeTimer = null;
    }
    if (isIOS()) {
      this.stopIosSource(true);
      if (this.iosCtx && this.iosCtx.state === "running") void this.iosCtx.suspend();
    }
    this.audio?.pause();
  }

  async resume(): Promise<void> {
    this.wantPlaying = true;
    this.active = true;
    claimPlaybackSession();
    if (isIOS() && this.iosBuffer) {
      this.armIosOutput();
      if (!this.iosLive) this.startIosSource();
      return;
    }
    if (this.isActivelyPlaying()) return;
    const audio = this.audio;
    if (audio?.ended || this.endedNaturally()) {
      this.advance();
      return;
    }
    await this.recoverPlayback();
  }

  stop(): void {
    this.active = false;
    this.wantPlaying = false;
    this.holding = false;
    this.loading = false;
    this.playingVoice = false;
    this.advancing = false;
    this.clipFinished = false;
    this.clipHeard = 0;
    this.clipStartedAt = 0;
    this.clipReplays = 0;
    this.lastHeard = 0;
    this.lastProgressAt = 0;
    this.playGen += 1;
    this.currentItem = null;
    this.queue = [];
    if (isIOS()) {
      this.stopIosSource(false);
      this.iosBuffer = null;
      this.iosOffset = 0;
      if (this.iosCtx && this.iosCtx.state === "running") void this.iosCtx.suspend();
    }
    if (this.resumeTimer != null) {
      window.clearTimeout(this.resumeTimer);
      this.resumeTimer = null;
    }
    const audio = this.audio;
    if (audio) {
      audio.loop = false;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    if ((isAndroidChrome() || isInstalledAndroidApp()) && this.chromeCtx && this.chromeCtx.state === "running") {
      void this.chromeCtx.suspend();
    }
    this.revoke();
  }

  onEnded(cb: EndedHandler | null): void {
    this.endedCb = cb;
  }

  onClipStart(cb: ClipHandler | null): void {
    this.clipCb = cb;
  }

  onTimeUpdate(cb: TimeHandler | null): void {
    this.timeCb = cb;
  }

  onNeedData(cb: NeedHandler | null): void {
    this.needCb = cb;
  }

  onFault(cb: (() => void) | null): void {
    this.faultCb = cb;
  }

  duration(): number {
    const d = this.audio?.duration;
    return d && Number.isFinite(d) ? d : this.clipDur;
  }

  currentTime(): number {
    return Math.max(this.clipHeard, this.audio?.currentTime ?? 0);
  }

  currentClip(): VoiceClip | null {
    return this.currentItem?.clip ?? null;
  }

  clock(): { currentTime: number; duration: number } {
    if (isIOS() && this.iosBuffer) {
      const ctx = this.iosCtx;
      const played = this.iosLive && ctx ? Math.max(0, ctx.currentTime - this.iosStarted) : 0;
      return { currentTime: this.iosOffset + played, duration: this.iosBuffer.duration };
    }
    const audio = this.audio;
    const duration = audio && Number.isFinite(audio.duration) ? audio.duration : this.clipDur;
    return { currentTime: audio?.currentTime ?? this.clipHeard, duration: duration || 0 };
  }

  resyncFromClock(): void {
    const clock = this.clock();
    if (clock.duration > 0.3 && clock.currentTime >= clock.duration - 0.05) this.onEndedEvent();
  }
}

export const NowPlayingPlayer = new NowPlayingPlayerImpl();
