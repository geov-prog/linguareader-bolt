import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const mdPath = process.argv[2] || join(root, "LinguaReader-AKB-v1.5.6.md");
const outPath = process.argv[3] || mdPath.replace(/\.md$/, ".docx");
const md = readFileSync(mdPath, "utf8");

const thin = { style: BorderStyle.SINGLE, size: 4, color: "C4B8A8" };
const borders = { top: thin, bottom: thin, left: thin, right: thin };
const cellMargins = { top: 40, bottom: 40, left: 80, right: 80 };

function runs(text, opts = {}) {
  return [new TextRun({ text, font: "Calibri", size: opts.size || 22, bold: opts.bold, italics: opts.italics, color: opts.color || "1A1714" })];
}

function para(text, extra = {}) {
  return new Paragraph({ spacing: { after: 120 }, ...extra, children: typeof text === "string" ? runs(text, extra.run || {}) : text });
}

function heading(text, level) {
  const map = { 1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3, 4: HeadingLevel.HEADING_4 };
  return new Paragraph({
    heading: map[level] || HeadingLevel.HEADING_2,
    spacing: { before: 280, after: 120 },
    children: runs(text, { bold: true, size: level === 1 ? 36 : level === 2 ? 28 : 24 }),
  });
}

function cell(text, header = false) {
  return new TableCell({
    borders,
    margins: cellMargins,
    shading: header ? { type: ShadingType.CLEAR, fill: "2F4F4A" } : undefined,
    children: [
      new Paragraph({
        children: runs(text.replace(/<br\s*\/?>/gi, "\n"), { bold: header, size: 18, color: header ? "F7F1E8" : "1A1714" }),
      }),
    ],
  });
}

function tableFrom(lines) {
  const rows = lines
    .filter((l) => /^\|/.test(l) && !/^\|\s*-+/.test(l))
    .map((l) =>
      l
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((c) => c.trim()),
    );
  if (!rows.length) return null;
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map(
      (cols, i) =>
        new TableRow({
          children: cols.map((c) => cell(c, i === 0)),
        }),
    ),
  });
}

function wireframe(lines) {
  const body = lines.join("\n");
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            borders,
            shading: { type: ShadingType.CLEAR, fill: "F2ECE2" },
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: body,
                    font: "Consolas",
                    size: 16,
                    color: "1A1714",
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

const children = [];
const lines = md.split(/\r?\n/);
let i = 0;
while (i < lines.length) {
  const line = lines[i];
  if (!line.trim()) {
    i += 1;
    continue;
  }
  if (line.startsWith("```")) {
    const fence = [];
    i += 1;
    while (i < lines.length && !lines[i].startsWith("```")) {
      fence.push(lines[i]);
      i += 1;
    }
    i += 1;
    children.push(wireframe(fence));
    continue;
  }
  if (line.startsWith("|")) {
    const block = [];
    while (i < lines.length && lines[i].startsWith("|")) {
      block.push(lines[i]);
      i += 1;
    }
    const tbl = tableFrom(block);
    if (tbl) children.push(tbl);
    children.push(new Paragraph({ spacing: { after: 160 }, children: [] }));
    continue;
  }
  const h = /^(#{1,4})\s+(.*)$/.exec(line);
  if (h) {
    children.push(heading(h[2].replace(/\*\*/g, ""), h[1].length));
    i += 1;
    continue;
  }
  if (/^---+$/.test(line)) {
    i += 1;
    continue;
  }
  if (/^[-*]\s+/.test(line)) {
    children.push(
      new Paragraph({
        bullet: { level: 0 },
        spacing: { after: 80 },
        children: runs(line.replace(/^[-*]\s+/, "").replace(/\*\*/g, "")),
      }),
    );
    i += 1;
    continue;
  }
  if (/^\d+\.\s+/.test(line)) {
    children.push(
      new Paragraph({
        numbering: { reference: "akb-num", level: 0 },
        spacing: { after: 80 },
        children: runs(line.replace(/^\d+\.\s+/, "").replace(/\*\*/g, "")),
      }),
    );
    i += 1;
    continue;
  }
  children.push(para(line.replace(/\*\*/g, "")));
  i += 1;
}

const doc = new Document({
  numbering: {
    config: [
      {
        reference: "akb-num",
        levels: [
          {
            level: 0,
            format: "decimal",
            text: "%1.",
            alignment: AlignmentType.LEFT,
          },
        ],
      },
    ],
  },
  sections: [
    {
      properties: {
        page: { margin: { top: 720, bottom: 720, left: 720, right: 720 } },
      },
      children,
    },
  ],
});

const buf = await Packer.toBuffer(doc);
writeFileSync(outPath, buf);
console.log(`AKB Word -> ${outPath}`);
