// Typed RPC client (standalone port — no space SDK).
//
// Same call shape as the Muse original: `api.<actionName>(args)` POSTs
// `{ action, args, deviceId }` as JSON to `/api/actions` (proxied to the
// API server in dev, see vite.config.ts) and returns the parsed response
// JSON. Throws on a non-OK HTTP status or on a `{ error }` payload.
//
// Device ID: generated once with crypto.randomUUID(), persisted in
// localStorage under `frostora-device-id`, and sent with every call so
// the server can scope per-device state (likes, history, profile).
//
// Typing: `api` is typed from the local mirror in `./actions.ts`,
// transcribed field-for-field from the ported server's zod schemas
// (`../../server/src/actions`). A direct
// `import type { Actions } from "../../server/src/actions"` was tried
// on 22 Nov 2026 and REJECTED — it does not typecheck against the
// ported server file, for two reasons: (1) the server's `Actions`
// type maps to the raw handlers, which are `(args, ctx)` (2 args),
// while the client only ever passes `args`; (2) importing the server
// file pulls its whole dependency graph (zod, drizzle-orm,
// @types/node) into the client's typecheck, and those modules do not
// resolve from the client directory, so the server file itself
// reports errors under the client config. The mirror avoids both:
// a 1-argument client form with the server's response shapes.
// If the server later exports a client-facing 1-arg `Actions` type
// (or the repo gains a shared types package), swap the import in
// `api.ts` to it and delete `./actions.ts` — App.tsx needs no change.
// (A loose `Record<string, (args: any) => Promise<any>>` fallback was
// also tried first: it made every `api.<action>` possibly-undefined
// under `noUncheckedIndexedAccess` and dropped all contextual types
// in App.tsx — 67 type errors — so it is NOT used.)

import type { Actions } from "./actions";

const DEVICE_ID_KEY = "frostora-device-id";

function getDeviceId(): string {
  const fallbackId = () =>
    `device-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const id =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : fallbackId();
    localStorage.setItem(DEVICE_ID_KEY, id);
    return id;
  } catch {
    // localStorage unavailable (private mode, etc.): fall back to an
    // in-memory id so calls still work for this session.
    return fallbackId();
  }
}

async function callAction(action: string, args: unknown): Promise<unknown> {
  const res = await fetch("/api/actions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, args, deviceId: getDeviceId() }),
  });
  if (!res.ok) {
    throw new Error(`Frostora API error: ${action} failed with HTTP ${res.status}`);
  }
  const json: unknown = await res.json();
  if (json && typeof json === "object" && "error" in json) {
    const err = (json as { error?: unknown }).error;
    if (err) {
      throw new Error(typeof err === "string" ? err : `Frostora API error: ${action} failed`);
    }
  }
  return json;
}

export type ApiResponse<C, K extends keyof C> =
  C[K] extends (...args: never[]) => infer R ? Awaited<R> : never;
export type ApiRequest<C, K extends keyof C> =
  C[K] extends (...args: infer A) => unknown ? A[0] : never;

function createApiClient<C extends object>(): C {
  return new Proxy({} as C, {
    get(_target, prop) {
      // Symbols and `then` must not become actions: awaiting the proxy
      // itself (or React Query inspecting it) would otherwise hang.
      if (typeof prop !== "string" || prop === "then") return undefined;
      return (args: unknown) => callAction(prop, args);
    },
  });
}

// Same `api.<action>(args)` call shape as the Muse original, typed from
// the Actions mirror in ./actions.ts (see header note).
export const api = createApiClient<Actions>();
