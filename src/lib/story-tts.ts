import { createServerFn } from "@tanstack/react-start";

type StoryTtsInput = { text: string; voice: string; rate: number; pitch?: string };

export const speakStoryChunk = createServerFn({ method: "POST" })
  .validator((data: StoryTtsInput) => ({
    text: String(data?.text ?? "").trim().slice(0, 700),
    voice: String(data?.voice ?? "zh-CN-XiaoxiaoNeural"),
    rate: Number(data?.rate ?? 1) || 1,
    pitch: String(data?.pitch ?? "+0Hz"),
  }))
  .handler(async ({ data }) => {
    if (!data.text) throw new Error("empty text");
    const { synthesizeEdge } = await import("./story-tts.server");
    return synthesizeEdge(data);
  });
