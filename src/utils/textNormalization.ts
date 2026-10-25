/**
 * Client-side encoding detection for local documents.
 * Inspects BOMs, then tries UTF-8 (fatal), then Simplified Chinese
 * encodings (gb18030 / gbk) so GBK-era .txt files don't become mojibake.
 */

export type DetectedEncoding =
  | "utf-8"
  | "utf-8-bom"
  | "utf-16le"
  | "utf-16be"
  | "gb18030"
  | "gbk"
  | "gb2312"
  | "big5"
  | "utf-8-lossy";

export type ManualEncoding = "auto" | "utf-8" | "gb18030" | "gbk" | "gb2312" | "big5" | "utf-16le" | "utf-16be";

export const MANUAL_ENCODINGS: { id: ManualEncoding; label: string }[] = [
  { id: "auto", label: "Auto detect" },
  { id: "utf-8", label: "UTF-8" },
  { id: "gb18030", label: "GB18030 (Chinese)" },
  { id: "gbk", label: "GBK (legacy Chinese)" },
  { id: "gb2312", label: "GB2312" },
  { id: "big5", label: "Big5 (Traditional)" },
  { id: "utf-16le", label: "UTF-16 LE" },
  { id: "utf-16be", label: "UTF-16 BE" },
];

export interface NormalizationResult {
  text: string;
  encoding: DetectedEncoding;
  bom: boolean;
  replacementCount: number;
}

const UTF8_BOM = [0xef, 0xbb, 0xbf] as const;
const UTF16LE_BOM = [0xff, 0xfe] as const;
const UTF16BE_BOM = [0xfe, 0xff] as const;

const CHARSET_ALIAS: Record<string, ManualEncoding> = {
  utf8: "utf-8",
  "utf-8": "utf-8",
  gb18030: "gb18030",
  gbk: "gbk",
  gb2312: "gb2312",
  "gb-2312": "gb2312",
  csgb2312: "gb2312",
  "windows-936": "gbk",
  cp936: "gbk",
  ms936: "gbk",
  chinese: "gb2312",
  csiso58gb231280: "gb2312",
  "gb_2312-80": "gb2312",
  "hz-gb-2312": "gb2312",
  gbk2312: "gbk",
  big5: "big5",
  "big-5": "big5",
  "utf-16": "utf-16le",
  "utf-16le": "utf-16le",
  "utf-16be": "utf-16be",
};

function startsWith(bytes: Uint8Array, sig: readonly number[]): boolean {
  if (bytes.length < sig.length) return false;
  return sig.every((b, i) => bytes[i] === b);
}

function countReplacement(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 0xfffd) n += 1;
  }
  return n;
}

function tryDecode(
  bytes: Uint8Array,
  encoding: string,
  fatal: boolean,
): string | null {
  const labels = encoding === "gbk" ? ["gbk", "gb18030", "gb2312"] : encoding === "gb18030" ? ["gb18030", "gbk"] : [encoding];
  for (const label of labels) {
    try {
      return new TextDecoder(label, { fatal, ignoreBOM: false }).decode(bytes);
    } catch {
      continue;
    }
  }
  return null;
}

function cjkCount(text: string): number {
  return (text.match(/\p{Script=Han}/gu) ?? []).length;
}

function controlNoise(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 9 || c === 10 || c === 13) continue;
    if (c < 32 || (c >= 0x7f && c < 0xa0)) n += 1;
  }
  return n;
}

function looksLikeUtf16Le(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  const sample = Math.min(bytes.length, 64);
  let zerosOnOdd = 0;
  for (let i = 1; i < sample; i += 2) {
    if (bytes[i] === 0) zerosOnOdd += 1;
  }
  return zerosOnOdd / Math.floor(sample / 2) > 0.6;
}

function looksLikeUtf16Be(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  const sample = Math.min(bytes.length, 64);
  let zerosOnEven = 0;
  for (let i = 0; i < sample; i += 2) {
    if (bytes[i] === 0) zerosOnEven += 1;
  }
  return zerosOnEven / Math.floor(sample / 2) > 0.6;
}

function scoreDecoded(text: string, preferCjk: boolean): number {
  const replacements = countReplacement(text);
  const noise = controlNoise(text);
  const cjk = cjkCount(text);
  let score = replacements * 8 + noise * 4;
  if (preferCjk) score -= Math.min(cjk, 400) * 0.15;
  return score;
}

function labelChinese(label: string): DetectedEncoding {
  const lower = label.toLowerCase();
  if (lower.includes("gb18030")) return "gb18030";
  if (lower.includes("2312")) return "gb2312";
  if (lower.includes("big5")) return "big5";
  return "gbk";
}

export function decodeAs(buffer: ArrayBuffer, encoding: ManualEncoding): NormalizationResult {
  if (encoding === "auto") return normalizeText(buffer);
  const bytes = new Uint8Array(buffer);
  const text = tryDecode(bytes, encoding, false) ?? "";
  return {
    text,
    encoding: encoding as DetectedEncoding,
    bom: encoding === "utf-8" && startsWith(bytes, UTF8_BOM),
    replacementCount: countReplacement(text),
  };
}

export function sniffHtmlCharset(buffer: ArrayBuffer): ManualEncoding | null {
  const head = new TextDecoder("latin1").decode(new Uint8Array(buffer).slice(0, 4096));
  const named = head.match(/charset\s*=\s*['"]?([a-z0-9_-]+)/i)?.[1];
  if (!named) return null;
  return CHARSET_ALIAS[named.toLowerCase()] ?? null;
}

export function normalizeText(buffer: ArrayBuffer): NormalizationResult {
  const bytes = new Uint8Array(buffer);

  if (bytes.length === 0) {
    return { text: "", encoding: "utf-8", bom: false, replacementCount: 0 };
  }

  const hinted = sniffHtmlCharset(buffer);

  if (startsWith(bytes, UTF8_BOM)) {
    const text = tryDecode(bytes, "utf-8", false) ?? "";
    return {
      text,
      encoding: "utf-8-bom",
      bom: true,
      replacementCount: countReplacement(text),
    };
  }

  if (startsWith(bytes, UTF16LE_BOM)) {
    const text = tryDecode(bytes, "utf-16le", false) ?? "";
    return {
      text,
      encoding: "utf-16le",
      bom: true,
      replacementCount: countReplacement(text),
    };
  }

  if (startsWith(bytes, UTF16BE_BOM)) {
    const text = tryDecode(bytes, "utf-16be", false) ?? "";
    return {
      text,
      encoding: "utf-16be",
      bom: true,
      replacementCount: countReplacement(text),
    };
  }

  if (looksLikeUtf16Le(bytes)) {
    const text = tryDecode(bytes, "utf-16le", false);
    if (text && countReplacement(text) < text.length * 0.05) {
      return {
        text,
        encoding: "utf-16le",
        bom: false,
        replacementCount: countReplacement(text),
      };
    }
  }

  if (looksLikeUtf16Be(bytes)) {
    const text = tryDecode(bytes, "utf-16be", false);
    if (text && countReplacement(text) < text.length * 0.05) {
      return {
        text,
        encoding: "utf-16be",
        bom: false,
        replacementCount: countReplacement(text),
      };
    }
  }

  if (hinted && hinted !== "auto" && hinted !== "utf-8") {
    const hintedText = tryDecode(bytes, hinted, false);
    if (hintedText && countReplacement(hintedText) < hintedText.length * 0.08) {
      return {
        text: hintedText,
        encoding: hinted as DetectedEncoding,
        bom: false,
        replacementCount: countReplacement(hintedText),
      };
    }
  }

  const utf8Fatal = tryDecode(bytes, "utf-8", true);
  if (utf8Fatal !== null) {
    return {
      text: utf8Fatal,
      encoding: "utf-8",
      bom: false,
      replacementCount: 0,
    };
  }

  const highBytes = bytes.reduce((n, b) => n + (b >= 0x80 ? 1 : 0), 0);
  const preferCjk = highBytes / bytes.length > 0.08;

  const candidates: Array<{ encoding: DetectedEncoding; text: string }> = [];

  for (const label of ["gb18030", "gbk", "gb2312", "big5"] as const) {
    const text = tryDecode(bytes, label, false);
    if (text == null) continue;
    candidates.push({ encoding: labelChinese(label), text });
  }

  const utf8Lossy = tryDecode(bytes, "utf-8", false);
  if (utf8Lossy != null) {
    candidates.push({ encoding: "utf-8-lossy", text: utf8Lossy });
  }

  if (candidates.length === 0) {
    return {
      text: "",
      encoding: "utf-8-lossy",
      bom: false,
      replacementCount: 0,
    };
  }

  let best = candidates[0]!;
  let bestScore = scoreDecoded(best.text, preferCjk);
  for (let i = 1; i < candidates.length; i++) {
    const next = candidates[i]!;
    const s = scoreDecoded(next.text, preferCjk);
    if (s < bestScore) {
      best = next;
      bestScore = s;
    }
  }

  return {
    text: best.text,
    encoding: best.encoding,
    bom: false,
    replacementCount: countReplacement(best.text),
  };
}

export function detectLanguage(text: string): "zh" | "en" {
  const sample = text.slice(0, 4000);
  const cjk = cjkCount(sample);
  return cjk > Math.max(8, sample.length * 0.06) ? "zh" : "en";
}

export function isChineseVoice(voice: { lang: string; name: string }): boolean {
  const hay = `${voice.lang} ${voice.name}`.toLowerCase();
  return /zh|cmn|yue|chinese|中文|putonghua|mandarin|cantonese|huihui|yaoyao|kangkang|xiaoxiao|xiaoyi|yunxi/.test(
    hay,
  );
}

/** Simplified Chinese / Mandarin. Cantonese and Traditional are not this. */
export function isMandarinVoice(voice: { lang: string; name: string; voiceURI?: string }): boolean {
  const blob = `${voice.lang} ${voice.name} ${voice.voiceURI ?? ""}`.replace(/_/g, "-").toLowerCase();
  if (/yue|zh-hk|zh-tw|cantonese|粵|粤|hant|hong kong|hongkong/.test(blob)) return false;
  const lang = voice.lang.replace(/_/g, "-").toLowerCase();
  if (lang === "zh" || lang === "cmn" || lang.startsWith("zh-cn") || lang.startsWith("cmn")) return true;
  return /mandarin|putonghua|普通话|简体|chinese \(china\)|中文（中国）/.test(blob);
}

export const TextNormalizationService = {
  decode: normalizeText,
  decodeAs,
  detectLanguage,
  sniffHtmlCharset,
};
