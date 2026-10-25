import { Capacitor, registerPlugin } from "@capacitor/core";
import { isInstalledAndroidApp } from "@/utils/platform";

export type AndroidVoice = { id: string; name: string; lang: string; features: string };

type PhoneVoicePlugin = {
  list: () => Promise<{ voices: AndroidVoice[] }>;
  speak: (opts: { id: string; text: string; rate: number }) => Promise<void>;
  stop: () => Promise<void>;
  openDownload: () => Promise<void>;
  fetchStory: (opts: { text: string; neural: string; rate: string; pitch: string }) => Promise<{ b64: string }>;
};

const plugin = Capacitor.isNativePlatform() ? registerPlugin<PhoneVoicePlugin>("PhoneVoice") : null;

export const APK_VOICE_PREFIX = "apk:";

export function isApkVoiceURI(uri: string | null | undefined): boolean {
  return !!uri?.startsWith(APK_VOICE_PREFIX);
}

export async function listAndroidVoices(): Promise<AndroidVoice[]> {
  if (!isInstalledAndroidApp() || !plugin) return [];
  try {
    const result = await plugin.list();
    return result.voices ?? [];
  } catch {
    return [];
  }
}

export async function speakAndroidVoice(id: string, text: string, rate: number): Promise<void> {
  if (!plugin) throw new Error("no phone voice");
  await plugin.speak({ id, text, rate });
}

export async function stopAndroidVoice(): Promise<void> {
  try {
    await plugin?.stop();
  } catch {
    /* already stopped */
  }
}

export async function openAndroidVoiceDownload(): Promise<void> {
  try {
    await plugin?.openDownload();
  } catch {
    /* the phone has no voice installer */
  }
}

export async function fetchAndroidStory(text: string, neural: string, rate: string, pitch: string): Promise<Blob> {
  if (!plugin) throw new Error("Could not fetch that voice");
  const result = await plugin.fetchStory({ text, neural, rate, pitch });
  const binary = atob(result.b64 || "");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: "audio/mpeg" });
}

function genderOf(voice: AndroidVoice): "female" | "male" | "" {
  const blob = `${voice.name} ${voice.lang} ${voice.features}`.toLowerCase();
  if (/female|女声|女聲/.test(blob)) return "female";
  const withoutFemale = blob.replace(/female/g, "");
  if (/male|男声|男聲/.test(withoutFemale)) return "male";
  if (/x-(tpc|iob|iog|tpf|sfg|gba|gbc|gbg|fis|ssa|ccc|jar|yuc)(?:#|-|$)/.test(blob)) return "female";
  if (/x-(iom|iol|tpd|rjs|gbb|gbd|ccd|cce|yud|yuf)(?:#|-|$)/.test(blob)) return "male";
  if (/x-yue(?:#|-|$)/.test(blob)) return "male";
  return "";
}

function groupOf(voice: AndroidVoice): "uk" | "us" | "zh" | "yue" | null {
  const lang = voice.lang.replace(/_/g, "-").toLowerCase();
  const blob = `${lang} ${voice.name} ${voice.features}`.toLowerCase();
  if (/yue|zh-hk|cantonese|粵|粤/.test(blob)) return "yue";
  if (lang.startsWith("zh-cn") || lang.startsWith("cmn") || /zh-cn|cmn-cn|chinese/.test(blob)) return "zh";
  if (lang.startsWith("en-gb") || /en-gb/.test(blob)) return "uk";
  if (lang.startsWith("en-us") || /en-us/.test(blob)) return "us";
  return null;
}

export function androidPhoneChoices(voices: AndroidVoice[]): { uri: string; label: string }[] {
  const groups: Record<"uk" | "us" | "zh" | "yue", AndroidVoice[]> = { uk: [], us: [], zh: [], yue: [] };
  for (const voice of voices) {
    const group = groupOf(voice);
    if (group) groups[group].push(voice);
  }
  const out: { uri: string; label: string }[] = [];
  const used = new Set<string>();
  const add = (voice: AndroidVoice | undefined, label: string) => {
    if (!voice || used.has(voice.id)) return;
    used.add(voice.id);
    out.push({ uri: `${APK_VOICE_PREFIX}${voice.id}`, label });
  };
  const pair = (list: AndroidVoice[], female: string, male: string) => {
    const local = [...list].sort((a, b) => Number(/network/i.test(b.features)) - Number(/network/i.test(a.features)));
    add(local.find((voice) => genderOf(voice) === "female"), female);
    add(local.find((voice) => genderOf(voice) === "male"), male);
  };
  pair(groups.uk, "English UK · female", "English UK · male");
  pair(groups.us, "English US · female", "English US · male");
  pair(groups.zh, "Chinese · female", "Chinese · male");
  pair(groups.yue, "Cantonese · female", "Cantonese · male");
  return out;
}
