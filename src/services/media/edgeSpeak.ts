const TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const HOST = "wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1";

function xml(value: string): string {
  const amp = "&" + "amp;";
  const lt = "&" + "lt;";
  const gt = "&" + "gt;";
  const apos = "&" + "apos;";
  const quot = "&" + "quot;";
  return value.replace(/&/g, amp).replace(/</g, lt).replace(/>/g, gt).replace(/'/g, apos).replace(/"/g, quot);
}

async function secToken(): Promise<string> {
  let ticks = Date.now() / 1000;
  ticks += 11644473600;
  ticks -= ticks % 300;
  ticks *= 1e7;
  const raw = `${ticks.toFixed(0)}${TOKEN}`;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}

function connectionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replace(/-/g, "");
  }
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`.slice(0, 32);
}

function stamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

function asBytes(data: unknown): Uint8Array | null {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    const view = data as ArrayBufferView;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  return null;
}

/** One spoken MP3 from the current Microsoft read-aloud address. */
export function speakEdgeMp3(text: string, neural: string, rate: string, pitch = "+0Hz"): Promise<Uint8Array> {
  const clean = text.replace(/[<>]/g, " ").trim().slice(0, 700);
  if (!clean) return Promise.reject(new Error("empty text"));
  return new Promise((resolve, reject) => {
    void secToken()
      .then((sec) => {
        const url = `${HOST}?Ocp-Apim-Subscription-Key=${TOKEN}&Sec-MS-GEC=${sec}&Sec-MS-GEC-Version=1-143.0.3650.96&ConnectionId=${connectionId()}`;
        const WS = globalThis.WebSocket;
        if (!WS) {
          reject(new Error("no websocket"));
          return;
        }
        const socket = new WS(url);
        socket.binaryType = "arraybuffer";
        const pieces: Uint8Array[] = [];
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
          const total = pieces.reduce((sum, part) => sum + part.byteLength, 0);
          if (total < 800) {
            reject(new Error("empty audio"));
            return;
          }
          const out = new Uint8Array(total);
          let offset = 0;
          for (const part of pieces) {
            out.set(part, offset);
            offset += part.byteLength;
          }
          resolve(out);
        };
        const timer = setTimeout(() => finish(new Error("voice timed out")), 12000);
        socket.onopen = () => {
          const when = stamp();
          const config =
            '{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":false,"wordBoundaryEnabled":false},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}';
          socket.send(
            `X-Timestamp:${when}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n${config}`,
          );
          const ssml =
            `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>` +
            `<voice name='${xml(neural)}'><prosody pitch='${xml(pitch)}' rate='${xml(rate)}' volume='+0%'>` +
            `${xml(clean)}</prosody></voice></speak>`;
          socket.send(
            `X-RequestId:${connectionId()}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${when}\r\nPath:ssml\r\n\r\n${ssml}`,
          );
        };
        socket.onmessage = (event) => {
          if (typeof event.data === "string") {
            if (event.data.includes("Path:turn.end")) finish();
            return;
          }
          const bytes = asBytes(event.data);
          if (!bytes || bytes.byteLength < 2) return;
          const header = ((bytes[0] ?? 0) << 8) | (bytes[1] ?? 0);
          if (bytes.byteLength > header + 2) pieces.push(bytes.subarray(header + 2));
        };
        socket.onerror = () => finish(new Error("voice connection failed"));
        socket.onclose = () => finish();
      })
      .catch((err) => reject(err instanceof Error ? err : new Error("voice connection failed")));
  });
}
