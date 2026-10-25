import type { DocumentRecord } from "@/services/StorageService";
import { splitSentences } from "@/utils/sentences";

export const SAMPLE_WELCOME_ID = "sample-welcome";
export const SAMPLE_CHINESE_ID = "sample-jingyesi";

export const SAMPLE_WELCOME_TITLE = "A private library";
export const SAMPLE_CHINESE_TITLE = "静夜思 · 春晓";

export const SAMPLE_WELCOME_TEXT = `LinguaReader keeps the pages that matter on this device, and reads them aloud with the voices already on your system.

Nothing here is uploaded. Documents live in a local IndexedDB library — not on a server, not in someone else's cloud. Open a second tab and your place in the page follows through a local broadcast, with no network round-trip.

Drop a Word file, PDF, EPUB, HTML page, spreadsheet, or plain text. The importer reads the bytes on this device. Office files are unpacked, PDF pages yield their selectable text, and UTF-8, GB18030, or GBK encodings are decoded so Simplified Chinese does not collapse into mojibake. If a page still looks wrong, use the Encoding control and switch the alphabet yourself.

Press play. Speech is driven by the browser's own synthesis engine. Upload a recording of your own voice from the playback bar — it stays on this device. As each sentence is spoken, the reader marks your place and writes it down, so a lock-screen pause or a closed laptop does not throw you back to the beginning.

Edit the page, rename it, share a copy, or delete it from the toolbar above. Save as Word, PDF, EPUB, HTML, or text when you need a file. Export a signed library backup for the whole shelf; that file carries a SHA-256 digest, and importing it checks the digest before a single record is replaced.

This paragraph is here so you can try the controls. Skip forward. Slow the rate. Change the voice. The pine marker beside a sentence is where you are.

Reading is private work. Keep the file, keep the voice, keep the page.`;

export const SAMPLE_CHINESE_TEXT = `静夜思
李白

床前明月光，疑是地上霜。举头望明月，低头思故乡。

春晓
孟浩然

春眠不觉晓，处处闻啼鸟。夜来风雨声，花落知多少。

语言是随身的灯。把一份文稿留在这台设备上，用系统自己的声音读出来，进度写在本地，不经过任何云端。

Word、PDF、EPUB、网页或纯文本都可以直接打开。若文件仍是 GB18030 或 GBK 编码，阅读器会从字节里辨认，也可在页面上方手动改成 UTF-8、GBK 或 GB18030，避免乱码。

试着按下播放。句子会一节一节往前走，锁屏上的媒体键也可以暂停或继续。换一个中文语音，或在播放栏上传自己的录音。需要改稿、重命名、分享或删除，都在这篇正文上方。`;

function frozenSample(
  id: string,
  title: string,
  rawText: string,
  sourceName: string,
): DocumentRecord {
  const sentences = splitSentences(rawText);
  return {
    id,
    title,
    rawText,
    encoding: "utf-8",
    sourceName,
    createdAt: 1,
    updatedAt: 1,
    sentenceOffset: 0,
    sentenceCount: sentences.length,
    charCount: rawText.length,
  };
}

export const SAMPLE_DOCUMENTS: DocumentRecord[] = [
  frozenSample(SAMPLE_WELCOME_ID, SAMPLE_WELCOME_TITLE, SAMPLE_WELCOME_TEXT, "welcome.txt"),
  frozenSample(SAMPLE_CHINESE_ID, SAMPLE_CHINESE_TITLE, SAMPLE_CHINESE_TEXT, "jingyesi.txt"),
];
