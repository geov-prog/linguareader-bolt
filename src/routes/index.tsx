import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

const App = lazy(() => import("@/App").then((mod) => ({ default: mod.App })));

export const Route = createFileRoute("/")({
  ssr: false,
  component: Home,
});

function Home() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-paper" aria-hidden="true" />}>
      <App />
    </Suspense>
  );
}
