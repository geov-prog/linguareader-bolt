import { defineConfig, type Plugin } from "vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

function stubPwaRegister(): Plugin {
  return {
    name: "stub-pwa-register",
    resolveId(id) {
      if (id === "virtual:pwa-register") return id;
      return null;
    },
    load(id) {
      if (id === "virtual:pwa-register") {
        return "export function registerSW() { return () => {}; }";
      }
      return null;
    },
  };
}

function stubStoryTts(): Plugin {
  return {
    name: "stub-story-tts",
    enforce: "pre",
    resolveId(id) {
      if (id === "@/lib/story-tts" || id.endsWith("/lib/story-tts")) return "\0story-tts-cap";
      return null;
    },
    load(id) {
      if (id === "\0story-tts-cap") {
        return `export const speakStoryChunk = () => Promise.reject(new Error("apk-local-tts"));`;
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [stubPwaRegister(), stubStoryTts(), tailwindcss(), viteReact()],
  resolve: { tsconfigPaths: true },
  publicDir: false,
  base: "./",
  build: {
    outDir: "android-www",
    emptyOutDir: true,
    rollupOptions: {
      input: "capacitor.html",
    },
  },
});
