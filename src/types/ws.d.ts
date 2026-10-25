declare module "ws" {
  import { EventEmitter } from "node:events";

  export default class WebSocket extends EventEmitter {
    constructor(url: string, options?: { headers?: Record<string, string> });
    send(data: string): void;
    close(): void;
    on(event: "open", listener: () => void): this;
    on(event: "message", listener: (data: Buffer, isBinary: boolean) => void): this;
    on(event: "error", listener: (err: Error) => void): this;
    on(event: "close", listener: () => void): this;
  }
}
