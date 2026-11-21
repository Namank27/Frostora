// Blob storage abstraction for avatar / wallpaper uploads.
//
// Two backends, chosen by environment:
//   - BLOB_READ_WRITE_TOKEN set  -> Vercel Blob (public access).
//     @vercel/blob is imported lazily so a local-only checkout never
//     needs the package installed.
//   - otherwise                  -> local `uploads/` directory (never
//     committed; see .gitignore). Files are served back by the dev
//     server at /api/blobs/<key> (server/src/index.ts).
//
// Only the key (never the bytes) is stored in the database, exactly
// as the Muse app did with ctx.blobs. Keys are namespaced per device
// by the actions (profile/<deviceId>/avatar, wallpaper/<deviceId>/image).

import fs from "node:fs";
import path from "node:path";

export interface BlobStore {
  /** Store bytes under `key`; returns the public URL for the blob. */
  put(key: string, bytes: Buffer, contentType: string): Promise<string>;
  /** Resolve a stored key to its public URL. */
  getUrl(key: string): Promise<string>;
}

function useVercelBlob(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

/** Reject keys that would escape the uploads directory. */
function assertSafeKey(key: string): void {
  if (
    !key ||
    key.startsWith("/") ||
    key.includes("\\") ||
    key.split("/").some((part) => part === ".." || part === "" || part === ".")
  ) {
    throw new Error(`Unsafe blob key: ${key}`);
  }
}

function localDir(): string {
  return process.env.BLOB_LOCAL_DIR ?? path.join(process.cwd(), "uploads");
}

function localPath(key: string): string {
  assertSafeKey(key);
  return path.join(localDir(), ...key.split("/"));
}

/** Public URL of a locally stored blob (served by index.ts). */
export function localBlobUrl(key: string): string {
  return `/api/blobs/${key}`;
}

class LocalBlobStore implements BlobStore {
  async put(key: string, bytes: Buffer, _contentType: string): Promise<string> {
    const file = localPath(key);
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(file, bytes);
    return localBlobUrl(key);
  }

  async getUrl(key: string): Promise<string> {
    return localBlobUrl(key);
  }
}

class VercelBlobStore implements BlobStore {
  async put(key: string, bytes: Buffer, contentType: string): Promise<string> {
    const { put } = await import("@vercel/blob");
    const blob = await put(key, bytes, { access: "public", contentType });
    return blob.url;
  }

  async getUrl(key: string): Promise<string> {
    // The DB stores only the key, so resolve it back to its public
    // URL with a metadata lookup. (put() already returned the URL
    // at upload time; this path is for later reads.)
    const { head } = await import("@vercel/blob");
    const meta = await head(key);
    return meta.url;
  }
}

let storeInstance: BlobStore | null = null;

/** The configured blob store (Vercel Blob when BLOB_READ_WRITE_TOKEN is set, else local). */
export function getBlobStore(): BlobStore {
  if (!storeInstance) {
    storeInstance = useVercelBlob() ? new VercelBlobStore() : new LocalBlobStore();
  }
  return storeInstance;
}

/** True when blobs live on Vercel Blob (so /api/blobs/* has nothing local to serve). */
export function isVercelBlob(): boolean {
  return useVercelBlob();
}

/** Read a locally stored blob's bytes (dev server's /api/blobs/:key route).
 *  The content type is sniffed from the magic bytes (same check the
 *  upload path enforces), not from the key — keys carry no extension. */
export async function readLocalBlob(key: string): Promise<{ bytes: Buffer; contentType: string } | null> {
  const file = localPath(key);
  let bytes: Buffer;
  try {
    bytes = await fs.promises.readFile(file);
  } catch {
    return null;
  }
  let contentType = "application/octet-stream";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    contentType = "image/jpeg";
  } else if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
  ) {
    contentType = "image/png";
  } else if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  ) {
    contentType = "image/webp";
  }
  return { bytes, contentType };
}
