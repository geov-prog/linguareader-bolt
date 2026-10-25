import { bytesOf, cleanExtractedText } from "@/services/documents/clean";

function asBytes(content: ArrayLike<number> | undefined | null): Uint8Array | null {
  if (!content) return null;
  return bytesOf(content as ArrayLike<number>);
}

function scrapeUtf16(bytes: Uint8Array, minLen = 6): string {
  const parts: string[] = [];
  let current = "";
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const code = bytes[i]! | (bytes[i + 1]! << 8);
    const printable =
      code === 9 ||
      code === 10 ||
      code === 13 ||
      (code >= 32 && code < 0xd800) ||
      (code >= 0xe000 && code < 0xfff0);
    if (printable && bytes[i + 1]! < 0x30) {
      current += String.fromCharCode(code);
    } else {
      if (current.trim().length >= minLen) parts.push(current.trim());
      current = "";
    }
  }
  if (current.trim().length >= minLen) parts.push(current.trim());
  return cleanExtractedText(parts.join("\n"));
}

function scrapeAnsi(bytes: Uint8Array, minLen = 8): string {
  const parts: string[] = [];
  let current: number[] = [];
  const flush = () => {
    if (current.length >= minLen) {
      parts.push(new TextDecoder("windows-1252", { fatal: false }).decode(Uint8Array.from(current)));
    }
    current = [];
  };
  for (let i = 0; i < bytes.length; i += 1) {
    const b = bytes[i]!;
    if (b === 9 || b === 10 || b === 13 || (b >= 32 && b !== 127)) current.push(b);
    else flush();
  }
  flush();
  return cleanExtractedText(parts.join("\n"));
}

function readPieceTable(word: Uint8Array, table: Uint8Array | null): string | null {
  if (word.length < 0x1aa) return null;
  const view = new DataView(word.buffer, word.byteOffset, word.byteLength);
  const ident = view.getUint16(0, true);
  if (ident !== 0xa5ec && ident !== 0xa5dc) return null;
  const ccpText = view.getInt32(0x4c, true);
  if (ccpText <= 0 || ccpText > 20_000_000) return null;
  const fcClx = view.getUint32(0x1a2, true);
  const lcbClx = view.getUint32(0x1a6, true);
  const stream = table && lcbClx > 0 && fcClx + lcbClx <= table.length ? table : word;
  if (fcClx + lcbClx > stream.length || lcbClx < 5) return null;

  let offset = fcClx;
  const end = fcClx + lcbClx;
  while (offset < end) {
    const clxt = stream[offset]!;
    if (clxt === 0x01) {
      const cb = stream[offset + 1]!;
      offset += 2 + cb;
      continue;
    }
    if (clxt !== 0x02) break;
    const lcb = new DataView(stream.buffer, stream.byteOffset + offset + 1, 4).getInt32(0, true);
    const plc = offset + 5;
    if (lcb <= 0 || plc + lcb > stream.length) return null;
    const n = Math.floor((lcb - 4) / 12);
    if (n <= 0 || n > 20000) return null;
    const chunks: string[] = [];
    for (let i = 0; i < n; i += 1) {
      const cpStart = new DataView(stream.buffer, stream.byteOffset + plc + i * 4, 4).getInt32(0, true);
      const cpEnd = new DataView(stream.buffer, stream.byteOffset + plc + (i + 1) * 4, 4).getInt32(0, true);
      const pcdOff = plc + (n + 1) * 4 + i * 8;
      if (pcdOff + 8 > stream.length) break;
      const fcRaw = new DataView(stream.buffer, stream.byteOffset + pcdOff, 4).getUint32(0, true);
      const compressed = (fcRaw & 0x40000000) !== 0;
      const fc = fcRaw & 0x3fffffff;
      const count = Math.max(0, cpEnd - cpStart);
      if (count <= 0) continue;
      if (compressed) {
        const start = Math.floor(fc / 2);
        const slice = word.slice(start, start + count);
        chunks.push(new TextDecoder("windows-1252", { fatal: false }).decode(slice));
      } else {
        const slice = word.slice(fc, fc + count * 2);
        chunks.push(new TextDecoder("utf-16le", { fatal: false }).decode(slice));
      }
    }
    const text = cleanExtractedText(chunks.join(""));
    return text || null;
  }
  return null;
}

export async function oleToText(buffer: ArrayBuffer): Promise<{ text: string; formatLabel: string; encoding: string }> {
  const CFB = await import("cfb");
  const cfb = CFB.read(new Uint8Array(buffer), { type: "array" });
  const find = (name: string) => CFB.find(cfb, name);

  const word = find("WordDocument");
  if (word?.content) {
    const wordBytes = asBytes(word.content)!;
    const table =
      asBytes(find("1Table")?.content) ??
      asBytes(find("0Table")?.content) ??
      asBytes(find("Table")?.content);
    const pieced = readPieceTable(wordBytes, table);
    const scraped = scrapeUtf16(wordBytes) || scrapeAnsi(wordBytes);
    const text = pieced && pieced.length >= Math.min(40, scraped.length) ? pieced : scraped || pieced || "";
    if (text) return { text, formatLabel: "Word 97–2003", encoding: "doc" };
  }

  if (find("Workbook") || find("Book") || find("WORKBOOK")) {
    const XLSX = await import("xlsx");
    const workbook = XLSX.read(new Uint8Array(buffer), { type: "array" });
    const parts: string[] = [];
    for (const name of workbook.SheetNames) {
      const sheet = workbook.Sheets[name];
      if (!sheet) continue;
      const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
      if (csv.trim()) parts.push(workbook.SheetNames.length > 1 ? `${name}\n${csv}` : csv);
    }
    const text = cleanExtractedText(parts.join("\n\n"));
    if (text) return { text, formatLabel: "Excel 97–2003", encoding: "xls" };
  }

  const ppt = find("PowerPoint Document");
  if (ppt?.content || find("Current User")) {
    const bytes = asBytes(ppt?.content) ?? asBytes(find("Current User")?.content);
    const text = bytes ? scrapeUtf16(bytes, 4) : "";
    if (text) return { text, formatLabel: "PowerPoint 97–2003", encoding: "ppt" };
  }

  const parts: string[] = [];
  for (const name of cfb.FullPaths ?? []) {
    const entry = CFB.find(cfb, name);
    if (!entry?.content) continue;
    const bytes = asBytes(entry.content);
    if (!bytes || bytes.length < 16) continue;
    const text = scrapeUtf16(bytes, 10);
    if (text) parts.push(text);
  }
  const text = cleanExtractedText(parts.join("\n\n"));
  if (!text) {
    throw new Error(
      "That older Office file has no extractable text. Save it as .docx, .pdf, or .txt and drop it again.",
    );
  }
  return { text, formatLabel: "Office document", encoding: "ole" };
}
