// Small Express dev server for standalone Frostora.
//
//   POST /api/actions            { action, args, deviceId } -> action result
//   GET  /api/blobs/*            locally stored avatar/wallpaper bytes
//   GET  /*                     client/dist static files + SPA fallback (when built)
//
// No auth: device scoping (deviceId per request) is the only isolation,
// exactly as documented in SERVER-NOTES.md. Do not expose this server
// publicly without understanding that anyone with a deviceId gets
// their own separate library — which is the point — but anyone can
// mint a deviceId.
//
// Run:  DATABASE_URL=file:./frostora.db PORT=3000 npx tsx server/src/index.ts
// (or the integrator's `npm run dev`, which should do the equivalent.)

import express from "express";
import fs from "node:fs";
import path from "node:path";
import { handleAction } from "./handler.js";
import { isVercelBlob, readLocalBlob } from "./blobs.js";
import { getDb, migrate } from "./db.js";

const PORT = Number(process.env.PORT ?? 3000);
const CLIENT_DIST = path.join(process.cwd(), "client", "dist");

const app = express();
// Avatar/wallpaper uploads arrive as base64 (up to 4 MB) inside JSON.
app.use(express.json({ limit: "10mb" }));

app.post("/api/actions", async (req, res) => {
  const { action, args, deviceId } = (req.body ?? {}) as {
    action?: unknown;
    args?: unknown;
    deviceId?: unknown;
  };
  if (typeof action !== "string" || !action) {
    res.status(400).json({ error: "Missing action: expected { action, args, deviceId }." });
    return;
  }
  try {
    const result = await handleAction(action, args, deviceId as string);
    res.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Action failed.";
    const status =
      message.startsWith("Unknown action") ||
      message.startsWith("Invalid deviceId") ||
      message.startsWith("Invalid args")
        ? 400
        : 500;
    res.status(status).json({ error: message });
  }
});

// Locally stored blobs only. With Vercel Blob configured there is
// nothing local to serve; the stored URLs point at Vercel directly.
// Written as app.use (not a wildcard route) so it works on Express 4 and 5.
app.use("/api/blobs", async (req, res, next) => {
  if (req.method !== "GET") return next();
  if (isVercelBlob()) {
    res.status(404).json({ error: "Blobs are stored on Vercel Blob, not locally." });
    return;
  }
  const key = req.path.replace(/^\//, "");
  let blob: { bytes: Buffer; contentType: string } | null = null;
  try {
    blob = await readLocalBlob(key);
  } catch {
    res.status(400).json({ error: "Invalid blob key." });
    return;
  }
  if (!blob) {
    res.status(404).json({ error: "Blob not found." });
    return;
  }
  res.setHeader("Content-Type", blob.contentType);
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.send(blob.bytes);
});

// Static client build (when present) with SPA fallback.
// Plain middleware fallback (not a "*" route) so it works on Express 4 and 5.
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.use((req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(CLIENT_DIST, "index.html"));
  });
} else {
  app.get("/", (_req, res) => {
    res.json({
      ok: true,
      service: "frostora-server",
      note: "No client/dist found; API only. Build the client or point the app at this server's /api/actions.",
    });
  });
}

async function main(): Promise<void> {
  // Touch the DB early so a bad DATABASE_URL fails fast with a clear error.
  getDb();
  // Local file DBs migrate on startup; Turso is intentionally skipped (see db.ts).
  await migrate();
  app.listen(PORT, () => {
    console.log(`[frostora] listening on http://localhost:${PORT}`);
    if (fs.existsSync(CLIENT_DIST)) console.log(`[frostora] serving client from ${CLIENT_DIST}`);
    else console.log("[frostora] no client/dist found; API only.");
  });
}

main().catch((e: unknown) => {
  console.error("[frostora] failed to start:", e instanceof Error ? e.message : e);
  process.exit(1);
});
