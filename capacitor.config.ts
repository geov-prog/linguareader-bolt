import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.linguareader.app",
  appName: "LinguaReader",
  webDir: "android-www",
  backgroundColor: "#f2ece2",
  android: {
    allowMixedContent: true,
    webContentsDebuggingEnabled: false,
  },
  ios: {
    backgroundColor: "#f2ece2",
    contentInset: "automatic",
    preferredContentMode: "mobile",
  },
};

export default config;
