import { cleanExtractedText, decodeXmlEntities, stripXmlTags } from "@/services/documents/clean";

function blockify(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|head)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote|section|article|header|footer)>/gi, "\n")
    .replace(/<(h[1-6])\b[^>]*>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n• ")
    .replace(/<p\b[^>]*>/gi, "\n");
}

export function htmlToText(html: string): string {
  if (typeof DOMParser !== "undefined") {
    const asHtml = extractFromDom(html, "text/html");
    if (asHtml.trim()) return asHtml;
    const asXml = extractFromDom(html, "application/xhtml+xml");
    if (asXml.trim()) return asXml;
  }
  return cleanExtractedText(decodeXmlEntities(stripXmlTags(blockify(html))));
}

function extractFromDom(html: string, type: DOMParserSupportedType): string {
  const doc = new DOMParser().parseFromString(html, type);
  if (doc.querySelector("parsererror")) return "";
  doc.querySelectorAll("script, style, noscript, svg").forEach((el) => el.remove());
  doc.querySelectorAll("br").forEach((el) => el.replaceWith("\n"));
  doc.querySelectorAll("p, div, h1, h2, h3, h4, h5, h6, li, tr, blockquote").forEach((el) => {
    el.append("\n");
  });
  doc.querySelectorAll("li").forEach((el) => {
    if (!el.textContent?.startsWith("•")) el.prepend("• ");
  });
  const title = doc.querySelector("title")?.textContent?.trim();
  const body = doc.body?.innerText ?? doc.documentElement.textContent ?? "";
  const merged = title && !body.startsWith(title) ? `${title}\n\n${body}` : body;
  return cleanExtractedText(merged);
}

export function xmlToText(xml: string): string {
  return cleanExtractedText(stripXmlTags(xml));
}

export function fb2ToText(xml: string): string {
  const title =
    xml.match(/<book-title[^>]*>([\s\S]*?)<\/book-title>/i)?.[1] ??
    xml.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ??
    "";
  const body = xml.replace(/<binary\b[\s\S]*?<\/binary>/gi, "");
  const text = xmlToText(body);
  const heading = cleanExtractedText(stripXmlTags(title));
  if (heading && !text.startsWith(heading)) return `${heading}\n\n${text}`;
  return text;
}

export function csvToText(raw: string, separator: "," | "\t"): string {
  const lines = raw.replace(/^\uFEFF/, "").split(/\r?\n/);
  const rows = lines.map((line) =>
    line
      .split(separator)
      .map((cell) => cell.replace(/^"|"$/g, "").replace(/""/g, '"').trim())
      .filter((cell, i, arr) => cell || arr.length > 1)
      .join(" · "),
  );
  return cleanExtractedText(rows.join("\n"));
}
