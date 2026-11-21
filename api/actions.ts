// Vercel serverless entry for Frostora's action API.
//
// POST /api/actions  { action, args, deviceId } -> action result
// (same contract as the Express dev server in server/src/index.ts,
// which shares handleAction from server/src/handler.ts).
//
// No auto-migration here: on Vercel the database is Turso, and
// migrations are applied explicitly (see SERVER-NOTES.md) — a
// serverless function must never auto-migrate shared production data.
// DATABASE_URL / DATABASE_AUTH_TOKEN / WEB3FORMS_ACCESS_KEY /
// BLOB_READ_WRITE_TOKEN come from Vercel env vars.

import { handleAction } from "../server/src/handler.js";

export default async function handler(req: any, res: any): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed. Use POST /api/actions." });
    return;
  }
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
    res.status(200).json(result);
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
}
