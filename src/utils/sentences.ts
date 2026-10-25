const ABBREVIATIONS = new Set([
  "mr",
  "mrs",
  "ms",
  "dr",
  "prof",
  "sr",
  "jr",
  "st",
  "vs",
  "etc",
  "e.g",
  "i.e",
  "no",
  "vol",
  "ch",
]);

const MAX_UTTERANCE = 360;

export interface ReadingUnit {
  text: string;
  para: boolean;
}

let splitMemo: { sig: string; units: ReadingUnit[] } | null = null;

function splitSignature(text: string): string {
  const n = text.length;
  if (n === 0) return "0";
  return `${n}:${text.charCodeAt(0)}:${text.charCodeAt(n >> 1)}:${text.charCodeAt(n - 1)}`;
}

export function splitForReading(text: string): ReadingUnit[] {
  const sig = splitSignature(text);
  if (splitMemo && splitMemo.sig === sig) return splitMemo.units;

  const cleaned = text.replace(/\r\n/g, "\n").replace(/\u00a0/g, " ").trim();
  if (!cleaned) {
    splitMemo = { sig, units: [] };
    return splitMemo.units;
  }

  const units: ReadingUnit[] = [];
  const parts = cleaned.split(/\n{2,}/);

  for (const part of parts) {
    const block = part.replace(/\n+/g, " ").replace(/[ \t]+/g, " ").trim();
    if (!block) continue;
    const uttered: string[] = [];
    for (const sentence of splitBlock(block)) {
      const trimmed = sentence.trim();
      if (!trimmed) continue;
      if (trimmed.length <= MAX_UTTERANCE) uttered.push(trimmed);
      else uttered.push(...splitLong(trimmed));
    }
    uttered.filter(Boolean).forEach((item, index) => {
      units.push({ text: item, para: index === 0 });
    });
  }

  const result =
    units.length === 0
      ? splitLong(cleaned).map((item, index) => ({ text: item, para: index === 0 }))
      : units;
  splitMemo = { sig, units: result };
  return result;
}

export function splitSentences(text: string): string[] {
  return splitForReading(text).map((unit) => unit.text);
}

/** Sentence index whose text begins at or just after this character in the same book string. */
export function sentenceIndexAt(text: string, charOffset: number): number {
  const starts = sentenceStartOffsets(text);
  if (!starts.length) return 0;
  const target = Math.max(0, Math.min(charOffset, Math.max(0, text.length - 1)));
  let lo = 0;
  let hi = starts.length - 1;
  let index = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((starts[mid] ?? 0) <= target) {
      index = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return index;
}

let offsetMemo: { sig: string; starts: number[] } | null = null;

function sentenceStartOffsets(text: string): number[] {
  const sig = splitSignature(text);
  if (offsetMemo && offsetMemo.sig === sig) return offsetMemo.starts;
  const starts = computeSentenceStartOffsets(text);
  offsetMemo = { sig, starts };
  return starts;
}

function computeSentenceStartOffsets(text: string): number[] {
  const { body, map } = cleanedBody(text);
  if (!body) return [];
  const starts: number[] = [];
  const ranges: Array<[number, number]> = [];
  const breaks = /\n{2,}/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = breaks.exec(body))) {
    ranges.push([last, match.index]);
    last = match.index + match[0].length;
  }
  ranges.push([last, body.length]);
  for (const [from, to] of ranges) {
    if (from >= to) continue;
    const mapped = blockWithMap(body.slice(from, to), map.slice(from, to));
    if (!mapped.text) continue;
    let cursor = 0;
    for (const sentence of splitBlock(mapped.text)) {
      const at = mapped.text.indexOf(sentence, cursor);
      const blockAt = at >= 0 ? at : cursor;
      const pieces = sentence.length <= MAX_UTTERANCE ? [sentence] : splitLong(sentence);
      let local = 0;
      for (const piece of pieces) {
        const pieceAt = sentence.indexOf(piece, local);
        const originAt = blockAt + (pieceAt >= 0 ? pieceAt : local);
        starts.push(mapped.map[Math.min(originAt, Math.max(0, mapped.map.length - 1))] ?? 0);
        local = (pieceAt >= 0 ? pieceAt : local) + Math.max(1, piece.length);
      }
      cursor = blockAt + sentence.length;
    }
  }
  if (starts.length) return starts;
  const whole = splitLong(body.trim());
  return whole.length ? whole.map(() => map[0] ?? 0) : [0];
}

function cleanedBody(text: string): { body: string; map: number[] } {
  const chars: string[] = [];
  const map: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (ch === "\r") {
      if (text[i + 1] === "\n") continue;
      chars.push("\n");
      map.push(i);
      continue;
    }
    chars.push(ch === "\u00a0" ? " " : ch);
    map.push(i);
  }
  let lead = 0;
  while (lead < chars.length && /\s/.test(chars[lead]!)) lead += 1;
  let end = chars.length;
  while (end > lead && /\s/.test(chars[end - 1]!)) end -= 1;
  return { body: chars.slice(lead, end).join(""), map: map.slice(lead, end) };
}

function blockWithMap(slice: string, baseMap: number[]): { text: string; map: number[] } {
  let text = "";
  const map: number[] = [];
  let i = 0;
  while (i < slice.length) {
    const ch = slice[i]!;
    if (ch === "\n") {
      while (i < slice.length && slice[i] === "\n") i += 1;
      if (text.length && !text.endsWith(" ")) {
        text += " ";
        map.push(baseMap[Math.max(0, i - 1)] ?? 0);
      }
      continue;
    }
    if (ch === " " || ch === "\t") {
      const start = i;
      while (i < slice.length && (slice[i] === " " || slice[i] === "\t")) i += 1;
      if (text.length && !text.endsWith(" ")) {
        text += " ";
        map.push(baseMap[start] ?? 0);
      }
      continue;
    }
    text += ch;
    map.push(baseMap[i] ?? 0);
    i += 1;
  }
  let left = 0;
  while (left < text.length && text[left] === " ") left += 1;
  let right = text.length;
  while (right > left && text[right - 1] === " ") right -= 1;
  return { text: text.slice(left, right), map: map.slice(left, right) };
}

function isSentenceEnd(code: number): boolean {
  return (
    code === 12290 || // 。
    code === 65281 || // ！
    code === 65311 || // ？
    code === 8230 || // …
    code === 46 || // .
    code === 33 || // !
    code === 63 // ?
  );
}

function isCloser(code: number): boolean {
  return (
    code === 34 ||
    code === 39 ||
    code === 8221 || // ”
    code === 8217 || // ’
    code === 12301 || // 」
    code === 12303 || // 』
    code === 65289 || // ）
    code === 41 ||
    code === 93
  );
}

function splitBlock(block: string): string[] {
  const result: string[] = [];
  const n = block.length;
  let start = 0;

  for (let i = 0; i < n; i++) {
    if (!isSentenceEnd(block.charCodeAt(i))) continue;

    let j = i + 1;
    while (j < n && isCloser(block.charCodeAt(j))) j += 1;

    const next = j < n ? block[j]! : "";
    if (block.charCodeAt(i) === 46) {
      const current = block.slice(start, j);
      const prevWord = current
        .replace(/[^A-Za-z.]+$/g, "")
        .split(/\s+/)
        .pop()
        ?.replace(/\.+$/, "")
        .toLowerCase();
      if (prevWord && ABBREVIATIONS.has(prevWord)) continue;
      if (next && /[a-z]/.test(next)) continue;
    }

    if (!next || next === " " || next === "\t" || next === "　" || /[A-Z0-9\u3400-\u9fff]/.test(next)) {
      const piece = block.slice(start, j).trim();
      if (piece) result.push(piece);
      start = j;
      i = j - 1;
    }
  }

  const tail = block.slice(start).trim();
  if (tail) result.push(tail);
  return result;
}

function splitLong(sentence: string): string[] {
  const limit = maxSlice(sentence);
  if (sentence.length <= limit) return [sentence];
  const pieces: string[] = [];
  const clauses = sentence.split(/(?<=[;；,，:：])\s*/);
  let buf = "";
  for (const clause of clauses) {
    if ((buf + clause).length > limit && buf) {
      pieces.push(buf.trim());
      buf = clause;
    } else {
      buf += clause;
    }
  }
  if (buf.trim()) pieces.push(buf.trim());
  const wrapped: string[] = [];
  for (const piece of pieces.length ? pieces : [sentence]) {
    if (piece.length <= limit) wrapped.push(piece);
    else wrapped.push(...splitByLength(piece, limit));
  }
  return wrapped.length ? wrapped : [sentence];
}

function maxSlice(text: string): number {
  let cjk = 0;
  const sample = Math.min(text.length, 80);
  for (let i = 0; i < sample; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0x3400 && c <= 0x9fff) cjk += 1;
  }
  return cjk > sample * 0.3 ? 120 : MAX_UTTERANCE;
}

function splitByLength(text: string, max: number): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    if (text.length - i <= max) {
      out.push(text.slice(i).trim());
      break;
    }
    let end = i + max;
    const window = text.slice(i, end);
    const breakAt = Math.max(
      window.lastIndexOf("。"),
      window.lastIndexOf("！"),
      window.lastIndexOf("？"),
      window.lastIndexOf("；"),
      window.lastIndexOf("，"),
      window.lastIndexOf(" "),
      window.lastIndexOf("、"),
    );
    if (breakAt >= max * 0.4) end = i + breakAt + 1;
    out.push(text.slice(i, end).trim());
    i = end;
  }
  return out.filter(Boolean);
}

export function readingProgress(offset: number, count: number): number {
  if (count <= 0) return 0;
  if (offset >= count - 1) return 100;
  return Math.round((offset / count) * 100);
}

export function unitsFromSentences(sentences: string[]): ReadingUnit[] {
  return sentences.map((text, index) => ({
    text,
    para: index === 0 || /[。！？.!?…]$/.test(sentences[index - 1] ?? ""),
  }));
}
