import { convertBuffer, DOCUMENT_ACCEPT, isSupportedFile } from "@/services/documents/convert";
import { StorageService, type DocumentRecord } from "@/services/StorageService";
import { TextNormalizationService } from "@/utils/textNormalization";
import { sentenceIndexAt, splitSentences } from "@/utils/sentences";

export { DOCUMENT_ACCEPT, isSupportedFile };

export const AUDIO_ACCEPT = "audio/*,.mp3,.wav,.ogg,.m4a,.webm,.aac,.flac";
export const AUDIO_EXT = /\.(mp3|wav|ogg|oga|m4a|webm|aac|flac|opus)$/i;
export const FILE_INPUT_ID = "lingua-open-file";
export const VOICE_INPUT_ID = "lingua-open-voice";

export function isAudioFile(file: File): boolean {
  return AUDIO_EXT.test(file.name) || file.type.startsWith("audio/");
}

export type ImportResult =
  | { kind: "documents"; documents: DocumentRecord[]; encoding: string; formatLabel: string }
  | { kind: "backup"; count: number };

function looksLikeBackup(text: string): boolean {
  return (
    text.includes('"app": "LinguaReader"') ||
    text.includes('"app":"LinguaReader"') ||
    text.includes("linguareader.full-backup") ||
    text.includes("linguareader.settings") ||
    text.includes("linguareader.library") ||
    text.includes("linguareader.mix-pack")
  );
}

const SKIP_BYTES = new Set(["pdf", "docx", "xlsx", "pptx", "odt", "odp", "ods", "epub", "pages", "doc", "xls", "ppt", "ole", "zip", "rtf"]);

/** Let the loading message paint while a long book is prepared. Does not change the text. */
async function yieldToBrowser(fullText: string): Promise<void> {
  const chunkSize = 50_000;
  let offset = 0;
  while (offset < fullText.length) {
    offset += chunkSize;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

export async function snapshotFiles(files: FileList | File[]): Promise<File[]> {
  const list = Array.from(files);
  return Promise.all(
    list.map(async (file, index) => {
      const name = file.name?.trim() || `document-${index + 1}`;
      try {
        const buffer = await file.arrayBuffer();
        return new File([buffer], name, {
          type: file.type,
          lastModified: file.lastModified,
        });
      } catch {
        try {
          return new File([file], name, { type: file.type, lastModified: file.lastModified });
        } catch {
          throw new Error(
            `Could not read “${name}”. On a phone, pick it from Files or Downloads — not from a cloud preview.`,
          );
        }
      }
    }),
  );
}

export async function importFile(file: File): Promise<ImportResult> {
  let buffer: ArrayBuffer;
  try {
    buffer = await file.arrayBuffer();
  } catch {
    throw new Error(
      `Could not read “${file.name || "that file"}”. Pick it again from Files or Downloads.`,
    );
  }
  if (!buffer.byteLength) {
    throw new Error(
      `“${file.name || "That file"}” arrived empty. Open it from Files or Downloads, then choose it again.`,
    );
  }

  const name = file.name.toLowerCase();
  if (name.endsWith(".json") || file.type === "application/json") {
    const asText = TextNormalizationService.decode(buffer);
    try {
      const result = await StorageService.importTypedBackup(asText.text);
      return { kind: "backup", count: result.count };
    } catch (backupError) {
      if (looksLikeBackup(asText.text)) throw backupError;
    }
  }

  const converted = await convertBuffer(buffer, file.name, file.type);
  if (!converted.text) {
    throw new Error("No readable text was found in that file.");
  }
  await yieldToBrowser(converted.text);
  if (converted.text.length > 50_000) {
    splitSentences(converted.text);
    await new Promise((resolve) => setTimeout(resolve, 0));
    sentenceIndexAt(converted.text, 0);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  const keepBytes = !SKIP_BYTES.has(converted.encoding) && buffer.byteLength <= 6_000_000;
  const doc = StorageService.buildDocument({
    rawText: converted.text,
    encoding: converted.encoding,
    sourceName: file.name,
    title: converted.titleHint,
    chapters: converted.chapters,
    frontPages: converted.frontPages,
    sourceBytes: keepBytes ? buffer.slice(0) : undefined,
  });
  await StorageService.putDocument(doc);
  return {
    kind: "documents",
    documents: [doc],
    encoding: converted.encoding,
    formatLabel: converted.formatLabel,
  };
}

export async function importVoiceFile(file: File): Promise<{ id: string; name: string }> {
  if (!isAudioFile(file)) {
    throw new Error("Choose an audio file (MP3, WAV, M4A, or OGG).");
  }
  const id = crypto.randomUUID();
  const name = file.name.replace(/\.[^.]+$/, "") || "My voice";
  const blob = file.size ? file : new File([await file.arrayBuffer()], file.name, { type: file.type });
  await StorageService.putVoice({
    id,
    name,
    mime: file.type || "audio/mpeg",
    blob,
    createdAt: Date.now(),
  });
  return { id, name };
}
