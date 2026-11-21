// Vercel serverless entry for locally stored blobs.
//
// GET /api/blobs/<key> — only meaningful for local-dev uploads.
// On Vercel, uploads live on Vercel Blob (BLOB_READ_WRITE_TOKEN set)
// and their URLs point there directly, so this route answers 404.

import { isVercelBlob, readLocalBlob } from "../../server/src/blobs.js";

export default async function handler(req: any, res: any): Promise<void> {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }
  if (isVercelBlob()) {
    res.status(404).json({ error: "Blobs are stored on Vercel Blob, not locally." });
    return;
  }
  const key = String(req.query.key ?? "").replace(/^\/+/, "");
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
}
