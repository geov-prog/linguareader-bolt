export interface OcrLanguage {
  id: string;
  tess: string;
  label: string;
  native: string;
  speak: string;
}

export const OCR_LANGUAGES: OcrLanguage[] = [
  { id: "en", tess: "eng", label: "English", native: "English", speak: "en-US" },
  { id: "zh", tess: "chi_sim", label: "Chinese (Simplified)", native: "简体中文", speak: "zh-CN" },
  { id: "zh-hant", tess: "chi_tra", label: "Chinese (Traditional) / Cantonese written", native: "繁體中文 / 粵語", speak: "zh-HK" },
  { id: "ja", tess: "jpn", label: "Japanese", native: "日本語", speak: "ja-JP" },
  { id: "ko", tess: "kor", label: "Korean", native: "한국어", speak: "ko-KR" },
  { id: "ms", tess: "msa", label: "Malay / Bahasa Melayu", native: "Bahasa Melayu", speak: "ms-MY" },
  { id: "th", tess: "tha", label: "Thai", native: "ไทย", speak: "th-TH" },
  { id: "vi", tess: "vie", label: "Vietnamese", native: "Tiếng Việt", speak: "vi-VN" },
  { id: "km", tess: "khm", label: "Khmer", native: "ភាសាខ្មែរ", speak: "km-KH" },
  { id: "lo", tess: "lao", label: "Lao", native: "ພາສາລາວ", speak: "lo-LA" },
];

export const DEFAULT_SCAN_LANGS = ["chi_sim", "eng"];
