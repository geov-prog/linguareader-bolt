import { cleanExtractedText } from "@/services/documents/clean";

const SKIP_DESTINATIONS = new Set([
  "fonttbl",
  "filetbl",
  "colortbl",
  "stylesheet",
  "listtable",
  "listoverridetable",
  "rsidtbl",
  "generator",
  "info",
  "pict",
  "object",
  "xmlnstbl",
  "themedata",
  "colorschememapping",
  "latentstyles",
  "datastore",
  "datafield",
  "field",
  "fldinst",
  "header",
  "footer",
  "headerl",
  "headerr",
  "headerf",
  "footerl",
  "footerr",
  "footerf",
  "footnote",
  "annotation",
  "xe",
  "tc",
  "revtbl",
]);

const CODEPAGE: Record<number, string> = {
  65001: "utf-8",
  65000: "utf-8",
  936: "gbk",
  54936: "gb18030",
  950: "big5",
  932: "shift_jis",
  949: "euc-kr",
  1252: "windows-1252",
  1250: "windows-1250",
  1251: "windows-1251",
  1254: "windows-1254",
  10000: "utf-8",
};

function decodeBytes(bytes: number[], encoding: string): string {
  if (!bytes.length) return "";
  try {
    return new TextDecoder(encoding, { fatal: false }).decode(Uint8Array.from(bytes));
  } catch {
    return new TextDecoder("windows-1252", { fatal: false }).decode(Uint8Array.from(bytes));
  }
}

export function rtfToText(source: string): string {
  const out: string[] = [];
  let i = 0;
  const n = source.length;
  let skipDepth = 0;
  let group = 0;
  let uc = 1;
  let encoding = "windows-1252";
  const pending: number[] = [];
  const ucStack: number[] = [];
  const skipStack: number[] = [];

  const flush = () => {
    if (!pending.length) return;
    out.push(decodeBytes(pending, encoding));
    pending.length = 0;
  };

  const skip = () => skipDepth > 0;

  while (i < n) {
    const ch = source[i]!;
    if (ch === "{") {
      flush();
      group += 1;
      ucStack.push(uc);
      skipStack.push(skipDepth);
      i += 1;
      continue;
    }
    if (ch === "}") {
      flush();
      group -= 1;
      uc = ucStack.pop() ?? 1;
      const prevSkip = skipStack.pop() ?? 0;
      skipDepth = skipDepth > 0 && skipDepth >= group + 1 ? prevSkip : Math.min(skipDepth, Math.max(0, group));
      if (skipDepth > group) skipDepth = group;
      i += 1;
      continue;
    }
    if (ch !== "\\") {
      if (!skip()) {
        if (ch === "\n" || ch === "\r") {
          // ignored in RTF source
        } else {
          pending.push(ch.charCodeAt(0) & 0xff);
        }
      }
      i += 1;
      continue;
    }

    i += 1;
    if (i >= n) break;
    const next = source[i]!;

    if (next === "\\" || next === "{" || next === "}") {
      if (!skip()) {
        flush();
        out.push(next);
      }
      i += 1;
      continue;
    }
    if (next === "'") {
      const hex = source.slice(i + 1, i + 3);
      i += 3;
      if (!skip() && /^[0-9a-fA-F]{2}$/.test(hex)) {
        pending.push(Number.parseInt(hex, 16));
      }
      continue;
    }
    if (next === "~") {
      if (!skip()) {
        flush();
        out.push("\u00a0");
      }
      i += 1;
      continue;
    }
    if (next === "-" || next === "_") {
      if (!skip()) {
        flush();
        out.push("-");
      }
      i += 1;
      continue;
    }
    if (next === "*") {
      i += 1;
      continue;
    }

    let j = i;
    while (j < n && /[a-zA-Z]/.test(source[j]!)) j += 1;
    const word = source.slice(i, j).toLowerCase();
    let k = j;
    if (k < n && (source[k] === "-" || /[0-9]/.test(source[k]!))) {
      k += 1;
      while (k < n && /[0-9]/.test(source[k]!)) k += 1;
    }
    const argStr = source.slice(j, k);
    const arg = argStr ? Number.parseInt(argStr, 10) : 0;
    i = k;
    if (source[i] === " ") i += 1;

    if (word === "ansicpg" && arg) {
      encoding = CODEPAGE[arg] ?? encoding;
      continue;
    }
    if (word === "uc") {
      uc = Number.isFinite(arg) ? arg : 1;
      continue;
    }
    if (word === "u") {
      if (!skip()) {
        flush();
        let code = arg;
        if (code < 0) code += 65536;
        if (code > 0) out.push(String.fromCharCode(code));
      }
      let skipLeft = uc;
      while (skipLeft > 0 && i < n) {
        if (source[i] === "\\") {
          if (source[i + 1] === "'") {
            i += 4;
            skipLeft -= 1;
            continue;
          }
          break;
        }
        if (source[i] === "{" || source[i] === "}") break;
        i += 1;
        skipLeft -= 1;
      }
      continue;
    }

    if (SKIP_DESTINATIONS.has(word) || word === "fonttbl") {
      skipDepth = Math.max(skipDepth, group);
      continue;
    }

    if (skip()) continue;

    if (word === "par" || word === "pard" || word === "line" || word === "page" || word === "sect") {
      flush();
      out.push("\n");
      continue;
    }
    if (word === "tab") {
      flush();
      out.push("\t");
      continue;
    }
    if (word === "emdash") {
      flush();
      out.push("—");
      continue;
    }
    if (word === "endash") {
      flush();
      out.push("–");
      continue;
    }
    if (word === "lquote" || word === "rquote") {
      flush();
      out.push("’");
      continue;
    }
    if (word === "ldblquote" || word === "rdblquote") {
      flush();
      out.push("”");
      continue;
    }
    if (word === "bullet") {
      flush();
      out.push("•");
      continue;
    }
  }

  flush();
  return cleanExtractedText(out.join(""));
}
