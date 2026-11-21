import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./theme.css";
import frostoraIcon from "./assets/frostora-icon.webp";

// Favicon: the finalised Frostora crystal icon (faceted ice crystal
// with a sound wave inside). index.html ships an empty inline icon to
// stop a stray /favicon.ico fetch; point that link at the bundled
// asset instead so the tab / home-screen icon is the real artwork.
const faviconLink = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
if (faviconLink) {
  faviconLink.type = "image/webp";
  faviconLink.href = frostoraIcon;
}

// Standalone port: the Muse SDK's shared spaceQueryClient is gone; the
// app owns a fresh QueryClient. The root is the Vite `<div id="root">`,
// with the old `[data-generated-space-root]` selector kept as a fallback
// for any host page that still renders it.
const rootEl =
  document.querySelector<HTMLElement>("[data-generated-space-root]") ??
  document.querySelector<HTMLElement>("#root");
if (!rootEl) {
  throw new Error("missing app root element");
}

// Keep BOTH the `hatch-space-root` class AND the `data-hatch-space-root`
// attribute on the outer div: they are only CSS hooks now (theme.css
// selects on them for mobile safe-area insets and viewport sizing),
// but dropping either breaks layout silently.
createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={new QueryClient()}>
      <div className="hatch-space-root" data-hatch-space-root>
        <App />
      </div>
    </QueryClientProvider>
  </StrictMode>,
);
