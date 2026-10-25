import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Capacitor } from "@capacitor/core";
import { App } from "@/App";
import { Toaster } from "sonner";
import "@/styles.css";

(window as Window & { Capacitor?: typeof Capacitor }).Capacitor = Capacitor;

const root = document.getElementById("root");
if (!root) {
  document.body.innerHTML =
    '<main style="font-family:sans-serif;padding:24px;background:#f2ece2;min-height:100vh"><h1>LinguaReader</h1><p>This copy is missing its screen. Uninstall it, then download the latest Android file from Save & restore.</p></main>';
  throw new Error("LinguaReader root missing");
}

try {
  createRoot(root).render(
    <StrictMode>
      <App />
      <Toaster
        position="top-center"
        toastOptions={{
          className: "!bg-paper-raised !text-ink !border-0 !shadow-[var(--shadow-border-hover)] !font-sans",
        }}
      />
    </StrictMode>,
  );
} catch (err) {
  root.innerHTML = `<main style="font-family:sans-serif;padding:24px"><h1>LinguaReader could not open</h1><p>${String(err)}</p></main>`;
}
