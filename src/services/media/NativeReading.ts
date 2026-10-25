import { Capacitor, registerPlugin } from "@capacitor/core";

type Native = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
};

const plugin = Capacitor.isNativePlatform() ? registerPlugin<Native>("ReadingKeepAlive") : null;

export const NativeReading = {
  async start(): Promise<void> {
    try {
      await plugin?.start();
    } catch {
      /* web, or the phone refused the reading notice */
    }
  },
  async stop(): Promise<void> {
    try {
      await plugin?.stop();
    } catch {
      /* ignore */
    }
  },
};
