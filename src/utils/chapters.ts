import { sentenceIndexAt } from "@/utils/sentences";

export interface ChapterMark {
  title: string;
  charOffset: number;
  sentenceIndex: number;
  startSentenceIndex: number;
}

const CN_CHAPTER = /^\s*第[0-9零一二三四五六七八九十百千万]+[章回节卷]/;

function isChapterLine(line: string): boolean {
  const text = line.trim();
  if (!text || text.length > 80) return false;
  if (CN_CHAPTER.test(text)) return true;
  if (/^(chapter|ch\.?)\s+\d+/i.test(text)) return true;
  if (/^\d{1,5}$/.test(text)) return true;
  return false;
}

export function scanChapters(rawText: string, sentences?: string[]): ChapterMark[] {
  void sentences;
  const text = rawText.replace(/\r\n/g, "\n");
  const found: { title: string; charOffset: number }[] = [];
  let offset = 0;
  for (const line of text.split("\n")) {
    if (isChapterLine(line)) {
      found.push({ title: line.trim().slice(0, 72), charOffset: offset });
    }
    offset += line.length + 1;
  }
  return found.map((chapter) => markAt(chapter.title, chapter.charOffset, text));
}

export function chaptersAt(
  marks: { title: string; charOffset: number }[],
  sentences: string[],
  rawText = "",
): ChapterMark[] {
  return marks.map((chapter) =>
    rawText
      ? markAt(chapter.title, chapter.charOffset, rawText)
      : {
          title: chapter.title.slice(0, 72),
          charOffset: chapter.charOffset,
          sentenceIndex: sentenceIndexFor(sentences, chapter.title),
          startSentenceIndex: sentenceIndexFor(sentences, chapter.title),
        },
  );
}

function markAt(title: string, charOffset: number, rawText: string): ChapterMark {
  const startSentenceIndex = sentenceIndexAt(rawText, charOffset);
  return {
    title: title.slice(0, 72),
    charOffset,
    sentenceIndex: startSentenceIndex,
    startSentenceIndex,
  };
}

function sentenceIndexFor(sentences: string[], title: string): number {
  const key = title.replace(/\s+/g, "").slice(0, 18);
  if (!key) return 0;
  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i]!.replace(/\s+/g, "");
    if (sentence.includes(key) || key.startsWith(sentence.slice(0, Math.min(8, sentence.length)))) return i;
  }
  return 0;
}
