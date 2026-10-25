export interface TextMatch {
  sentenceIndex: number;
  start: number;
  end: number;
}

export function normalizeQuery(query: string): string {
  return query.trim().toLocaleLowerCase();
}

export function findInSentences(sentences: string[], query: string): TextMatch[] {
  const needle = normalizeQuery(query);
  if (!needle) return [];
  const matches: TextMatch[] = [];
  for (let i = 0; i < sentences.length; i++) {
    const hay = sentences[i]!.toLocaleLowerCase();
    let from = 0;
    while (from <= hay.length - needle.length) {
      const at = hay.indexOf(needle, from);
      if (at < 0) break;
      matches.push({ sentenceIndex: i, start: at, end: at + needle.length });
      if (matches.length >= 200) return matches;
      from = at + needle.length;
    }
  }
  return matches;
}

export function documentMatchesQuery(
  doc: { title: string; rawText: string; sourceName?: string },
  query: string,
): boolean {
  const needle = normalizeQuery(query);
  if (!needle) return true;
  if (doc.title.toLocaleLowerCase().includes(needle)) return true;
  if ((doc.sourceName ?? "").toLocaleLowerCase().includes(needle)) return true;
  const hay = doc.rawText.length > 24_000 ? doc.rawText.slice(0, 24_000) : doc.rawText;
  return hay.toLocaleLowerCase().includes(needle);
}
