const AMP = "\u0026";

export function decodeXmlEntities(input: string): string {
  return input
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(new RegExp(`${AMP}nbsp;`, "gi"), " ")
    .replaceAll(`${AMP}amp;`, AMP)
    .replaceAll(`${AMP}lt;`, "<")
    .replaceAll(`${AMP}gt;`, ">")
    .replaceAll(`${AMP}quot;`, '"')
    .replaceAll(`${AMP}apos;`, "'")
    .replace(new RegExp(`${AMP}#x([0-9a-fA-F]+);`, "g"), (_, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    })
    .replace(new RegExp(`${AMP}#(\\d+);`, "g"), (_, dec: string) => {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    });
}

export function stripXmlTags(xml: string): string {
  const withBreaks = xml
    .replace(/<(w:p|w:p\s[^>]*)>/g, "\n")
    .replace(/<(w:br|w:cr)\b[^/]*\/>/g, "\n")
    .replace(/<w:tab\b[^/]*\/>/g, "\t")
    .replace(/<(text:p|text:h)\b[^>]*>/g, "\n")
    .replace(/<text:line-break\b[^/]*\/>/g, "\n")
    .replace(/<text:tab\b[^/]*\/>/g, "\t")
    .replace(/<(a:p|a:p\s[^>]*)>/g, "\n")
    .replace(/<a:br\b[^/]*\/>/g, "\n")
    .replace(/<(p|h[1-6]|li|div|tr|br|title|section)\b[^>]*>/gi, "\n")
    .replace(/<\/(p|h[1-6]|div|tr|section)>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n• ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "");
  return decodeXmlEntities(withBreaks);
}

export function cleanExtractedText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function looksLikeBinaryGarbage(text: string): boolean {
  if (!text) return true;
  const sample = text.slice(0, 4000);
  let bad = 0;
  for (let i = 0; i < sample.length; i++) {
    const c = sample.charCodeAt(i);
    if (c === 9 || c === 10 || c === 13) continue;
    if (c < 32 || c === 0xfffd) bad += 1;
  }
  return bad / sample.length > 0.12;
}

export function bytesOf(content: ArrayLike<number> | ArrayBuffer): Uint8Array {
  if (content instanceof ArrayBuffer) return new Uint8Array(content);
  if (content instanceof Uint8Array) return content;
  return Uint8Array.from(content as ArrayLike<number>);
}

export function extname(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? name;
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "";
  return base.slice(dot + 1).toLowerCase();
}

export function stemname(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? name;
  return base.replace(/\.[^.]+$/, "") || base;
}
