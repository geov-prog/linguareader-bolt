import { concatFloat32 } from "@/services/media/wav";

const SAMPLE_RATE = 22050 as const;

function isCjkCode(code: number): boolean {
  return (
    (code >= 0x3400 && code <= 0x9fff) ||
    (code >= 0x3040 && code <= 0x30ff) ||
    (code >= 0xac00 && code <= 0xd7af) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0x20000 && code <= 0x2fa1f)
  );
}

function isLatinLetter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isPauseChar(ch: string): boolean {
  return /^[\s\p{P}\p{S}]$/u.test(ch);
}

function freqForChar(code: number): number {
  return 180 + (code % 241);
}

function fillTone(buf: Float32Array, f0: number, noiseAmp: number): void {
  let phase = 0;
  let phase2 = 0;
  const n = buf.length;
  for (let i = 0; i < n; i++) {
    const t = n <= 1 ? 0 : i / (n - 1);
    const glide = f0 * (1 + 0.07 * Math.sin(Math.PI * t) - 0.05 * t);
    phase += (2 * Math.PI * glide) / SAMPLE_RATE;
    phase2 += (2 * Math.PI * glide * 2.05) / SAMPLE_RATE;
    const env = Math.sin(Math.PI * t);
    const noise = (Math.random() - 0.5) * noiseAmp;
    buf[i] = env * (0.22 * Math.sin(phase) + 0.07 * Math.sin(phase2)) + noise;
  }
}

function fillNoise(buf: Float32Array, amp: number): void {
  for (let i = 0; i < buf.length; i++) {
    buf[i] = (Math.random() - 0.5) * amp;
  }
}

export function synthesizeFormant(
  text: string,
  rate: number,
): { samples: Float32Array; sampleRate: 22050 } {
  const safeRate = Math.max(0.4, Math.min(3, rate || 1));
  const voicedDur = 0.12 / safeRate;
  const pauseDur = 0.055 / safeRate;
  const chunks: Float32Array[] = [];
  const source = text.length ? text : " ";

  for (const ch of source) {
    const code = ch.codePointAt(0) ?? 0;
    if (isPauseChar(ch) && !isCjkCode(code) && !isLatinLetter(code)) {
      const n = Math.max(1, Math.floor(pauseDur * SAMPLE_RATE));
      const buf = new Float32Array(n);
      fillNoise(buf, 0.006);
      chunks.push(buf);
      continue;
    }
    const n = Math.max(8, Math.floor(voicedDur * SAMPLE_RATE));
    const buf = new Float32Array(n);
    fillTone(buf, freqForChar(code), 0.012);
    chunks.push(buf);
  }

  const tail = new Float32Array(Math.floor(SAMPLE_RATE * 0.08));
  fillNoise(tail, 0.005);
  chunks.push(tail);

  return { samples: concatFloat32(chunks), sampleRate: SAMPLE_RATE };
}
