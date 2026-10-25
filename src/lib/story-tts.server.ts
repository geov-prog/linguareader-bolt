import { createHash, randomBytes } from "node:crypto";
import WebSocket from "ws";

const TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";

const ALLOWED = new Set([
  "zh-CN-XiaoxiaoNeural",
  "zh-CN-XiaoyiNeural",
  "zh-CN-XiaohanNeural",
  "zh-CN-XiaoxuanNeural",
  "zh-CN-YunxiNeural",
  "zh-CN-YunyangNeural",
  "zh-CN-YunjianNeural",
  "zh-CN-YunyeNeural",
  "en-US-JennyNeural",
  "en-US-AriaNeural",
  "en-US-GuyNeural",
  "en-US-AndrewNeural",
]);

function rateToEdge(rate: number): string {
  const pct = Math.round((Math.max(0.6, Math.min(1.8, rate || 1)) - 1) * 100);
  return `${pct >= 0 ? "+" : ""}${pct}%`;
}

function pitchToEdge(pitch: string | undefined): string {
  if (pitch && /^[+-]\d+Hz$/.test(pitch)) return pitch;
  return "+0Hz";
}

export async function synthesizeEdge(opts: {
  text: string;
  voice: string;
  rate: number;
  pitch?: string;
}): Promise<{ mime: string; b64: string }> {
  const text = opts.text.replace(/[<>]/g, " ").trim().slice(0, 700);
  if (!text) throw new Error("empty text");
  const looksZh = /[\u4e00-\u9fff]/.test(text);
  let preferred = ALLOWED.has(opts.voice) ? opts.voice : "zh-CN-XiaoyiNeural";
  if (looksZh && !preferred.startsWith("zh-")) {
    const male = /Guy|Andrew|Yunxi|Yunyang|Yunjian|Yunye/i.test(opts.voice);
    preferred = male ? "zh-CN-YunxiNeural" : "zh-CN-XiaoyiNeural";
  }
  const chain = looksZh
    ? [preferred, "zh-CN-XiaoyiNeural", "zh-CN-YunxiNeural", "zh-CN-XiaoxiaoNeural"]
    : [preferred, "en-US-JennyNeural", "en-US-GuyNeural"];
  const seen = new Set<string>();
  let lastError: unknown;
  for (const voice of chain) {
    if (seen.has(voice)) continue;
    seen.add(voice);
    try {
      return await synthesizeOnce(text, voice, opts.rate, opts.pitch);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("voice failed");
}

function secToken(): string {
  let ticks = Date.now() / 1000;
  ticks += 11644473600;
  ticks -= ticks % 300;
  ticks *= 1e7;
  return createHash("sha256").update(`${ticks.toFixed(0)}${TOKEN}`, "ascii").digest("hex").toUpperCase();
}

function speakOnServer(text: string, voice: string, rate: string, pitch: string): Promise<Uint8Array> {
  const url =
    "wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1" +
    `?Ocp-Apim-Subscription-Key=${TOKEN}&Sec-MS-GEC=${secToken()}` +
    `&Sec-MS-GEC-Version=1-143.0.3650.96&ConnectionId=${randomBytes(16).toString("hex")}`;
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0",
        Origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
        Pragma: "no-cache",
        "Cache-Control": "no-cache",
      },
    });
    const pieces: Buffer[] = [];
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        /* already closed */
      }
      if (err) {
        reject(err);
        return;
      }
      const out = Buffer.concat(pieces);
      if (out.byteLength < 800) {
        reject(new Error("empty audio"));
        return;
      }
      resolve(new Uint8Array(out));
    };
    const timer = setTimeout(() => finish(new Error("voice timed out")), 12000);
    socket.on("open", () => {
      const when = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
      const config =
        '{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":false,"wordBoundaryEnabled":false},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}';
      socket.send(`X-Timestamp:${when}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n${config}`);
      const ssml =
        `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>` +
        `<voice name='${xml(voice)}'><prosody pitch='${xml(pitch)}' rate='${xml(rate)}' volume='+0%'>` +
        `${xml(text)}</prosody></voice></speak>`;
      socket.send(
        `X-RequestId:${randomBytes(16).toString("hex")}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${when}\r\nPath:ssml\r\n\r\n${ssml}`,
      );
    });
    socket.on("message", (data, isBinary) => {
      if (!isBinary) {
        if (data.toString().includes("Path:turn.end")) finish();
        return;
      }
      const buf = Buffer.from(data as Buffer);
      if (buf.length < 2) return;
      const header = buf.readUInt16BE(0);
      if (buf.length > header + 2) pieces.push(buf.subarray(header + 2));
    });
    socket.on("error", () => finish(new Error("voice connection failed")));
    socket.on("close", () => finish());
  });
}

function xml(value: string): string {
  const amp = "&" + "amp;";
  const lt = "&" + "lt;";
  const gt = "&" + "gt;";
  const apos = "&" + "apos;";
  const quot = "&" + "quot;";
  return value.replace(/&/g, amp).replace(/</g, lt).replace(/>/g, gt).replace(/'/g, apos).replace(/"/g, quot);
}

async function synthesizeOnce(
  text: string,
  voice: string,
  rate: number,
  pitch?: string,
): Promise<{ mime: string; b64: string }> {
  const bytes = await Promise.race([
    speakOnServer(text, voice, rateToEdge(rate), pitchToEdge(pitch)),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("voice timed out")), 12000);
    }),
  ]);
  const mime = "audio/mpeg";
  if (bytes.byteLength < 800) throw new Error("empty audio");
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return { mime, b64: btoa(binary) };
}
