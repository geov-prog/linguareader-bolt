import { pinyin } from "pinyin-pro";

const EN: Record<string, string> = {
  的: "of; possessive",
  一: "one",
  是: "to be",
  不: "not",
  了: "completed; already",
  人: "person",
  我: "I; me",
  在: "at; in",
  有: "have; there is",
  他: "he; him",
  这: "this",
  中: "middle; China",
  大: "big",
  来: "come",
  上: "up; on",
  国: "country",
  个: "item (measure)",
  到: "arrive",
  说: "say",
  们: "plural",
  为: "for; as",
  子: "child; noun suffix",
  和: "and",
  你: "you",
  地: "ground; -ly",
  出: "out",
  道: "way; say",
  也: "also",
  时: "time",
  年: "year",
  得: "get; must; -ly",
  就: "then; at once",
  那: "that",
  要: "want; need",
  下: "down",
  以: "by means of",
  生: "life; give birth",
  会: "can; meeting",
  自: "self",
  着: "ongoing",
  去: "go",
  之: "of (classical)",
  过: "pass; too",
  家: "home; family",
  学: "study",
  对: "correct; toward",
  可: "can",
  她: "she",
  里: "inside",
  后: "after; behind",
  小: "small",
  么: "question particle",
  心: "heart",
  多: "many",
  天: "day; sky",
  而: "and yet",
  能: "can; able",
  好: "good",
  都: "all",
  然: "however; like so",
  没: "not have",
  日: "sun; day",
  于: "at; in",
  起: "rise",
  还: "still; return",
  发: "send; hair",
  成: "become",
  事: "matter; affair",
  只: "only",
  作: "do; make",
  当: "when; act as",
  想: "think; want",
  看: "look",
  文: "language; writing",
  无: "without",
  开: "open",
  手: "hand",
  十: "ten",
  用: "use",
  主: "main; master",
  行: "go; OK",
  方: "square; method",
  又: "again",
  如: "as; if",
  前: "front; before",
  所: "place; that which",
  本: "root; this",
  见: "see",
  经: "pass; classic",
  头: "head",
  面: "face; surface",
  公: "public",
  同: "same",
  三: "three",
  已: "already",
  老: "old",
  从: "from",
  动: "move",
  两: "two",
  长: "long; grow",
  知: "know",
  民: "people",
  样: "kind; appearance",
  现: "now; appear",
  分: "divide; minute",
  将: "will; general",
  外: "outside",
  但: "but",
  身: "body",
  些: "some",
  与: "and",
  高: "tall; high",
  意: "meaning; intent",
  进: "enter",
  把: "hold; handle",
  法: "law; method",
  此: "this",
  实: "real",
  回: "return",
  理: "reason; manage",
  月: "moon; month",
  明: "bright; understand",
  种: "type; seed",
  美: "beautiful",
  物: "thing",
  正: "upright; just",
  新: "new",
  力: "strength",
  性: "nature",
  工: "work",
  名: "name",
  定: "decide; fixed",
  因: "because",
  女: "woman",
  马: "horse",
  水: "water",
  火: "fire",
  山: "mountain",
  爱: "love",
  春: "spring",
  秋: "autumn",
  风: "wind",
  花: "flower",
  夜: "night",
  思: "think; miss",
  故乡: "hometown",
  明月: "bright moon",
  床前: "before the bed",
  你好: "hello",
  谢谢: "thank you",
  对不起: "sorry",
  再见: "goodbye",
  中国: "China",
  美国: "America",
  什么: "what",
  怎么: "how",
  为什么: "why",
  可以: "may; can",
  因为: "because",
  所以: "therefore",
  如果: "if",
  但是: "but",
  我们: "we",
  他们: "they",
  自己: "oneself",
  现在: "now",
  今天: "today",
  明天: "tomorrow",
  朋友: "friend",
  老师: "teacher",
  学生: "student",
  时间: "time",
  世界: "world",
  生活: "life",
  工作: "work",
  问题: "question; problem",
  时候: "moment",
  地方: "place",
  东西: "thing",
  孩子: "child",
  父亲: "father",
  母亲: "mother",
  哥哥: "older brother",
  姐姐: "older sister",
  弟弟: "younger brother",
  妹妹: "younger sister",
  先生: "Mr.; husband",
  太太: "Mrs.; wife",
  爱情: "romantic love",
  故事: "story",
  小说: "novel",
  语言: "language",
  汉字: "Chinese character",
  拼音: "pinyin",
};

const WORD_EN: Record<string, string> = {
  hello: "你好",
  thanks: "谢谢",
  thank: "谢谢",
  sorry: "对不起",
  goodbye: "再见",
  love: "爱",
  friend: "朋友",
  book: "书",
  water: "水",
  moon: "月",
  night: "夜",
  spring: "春",
  home: "家",
  mother: "母亲",
  father: "父亲",
  time: "时间",
  world: "世界",
  language: "语言",
  story: "故事",
};

export interface GlossLine {
  original: string;
  pinyin: string;
  english: string;
  other: string;
}

function hasHan(text: string): boolean {
  return /[\u4e00-\u9fff]/.test(text);
}

function glossHanChunk(chunk: string): { pinyin: string; english: string } {
  if (EN[chunk]) return { pinyin: pinyin(chunk, { toneType: "symbol", nonZh: "consecutive" }), english: EN[chunk]! };
  const parts: string[] = [];
  for (const ch of chunk) {
    if (EN[ch]) parts.push(EN[ch]!);
  }
  return {
    pinyin: pinyin(chunk, { toneType: "symbol", nonZh: "consecutive" }),
    english: parts.join(" · ") || "—",
  };
}

export function explainBilingual(text: string, pair: "zh" | "en" = "zh"): GlossLine[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  if (hasHan(clean)) {
    const tokens = clean.match(/[\u4e00-\u9fff]{1,4}|[^\u4e00-\u9fff]+/g) ?? [clean];
    const lines: GlossLine[] = [];
    for (const token of tokens) {
      const piece = token.trim();
      if (!piece) continue;
      if (!hasHan(piece)) {
        const other = WORD_EN[piece.toLowerCase()] || piece;
        lines.push({ original: piece, pinyin: "", english: piece, other: pair === "zh" ? other : piece });
        continue;
      }
      const g = glossHanChunk(piece);
      lines.push({ original: piece, pinyin: g.pinyin, english: g.english, other: piece });
    }
    return lines;
  }
  const words = clean.split(/\s+/).slice(0, 40);
  return words.map((word) => ({
    original: word,
    pinyin: "",
    english: word,
    other: WORD_EN[word.toLowerCase().replace(/[^a-z']/g, "")] || "",
  }));
}

export function formatGlossSpeech(lines: GlossLine[]): string {
  return lines
    .map((line) => {
      if (line.pinyin) return `${line.original}，${line.pinyin}，${line.english}`;
      if (line.other && line.other !== line.english) return `${line.original}. ${line.other}. ${line.english}`;
      return `${line.original}. ${line.english}`;
    })
    .join("。");
}
