// HTTP-facing action dispatcher for the standalone Frostora server.
//
// The client POSTs { action, args, deviceId } to /api/actions (see
// index.ts). This module validates the device id, looks the action up
// in the registry (server/src/actions.ts), zod-parses the args against
// the action's own request schema, runs the handler, and zod-parses
// the result against its response schema — so a handler bug can never
// leak a malformed payload to the client.
//
// Errors are plain Errors with clear messages; the HTTP layer maps
// them to 400 (unknown action / bad args / bad device id) or 500.

import { z } from "zod";
import { Actions } from "./actions.js";
import { getBlobStore } from "./blobs.js";
import { getDb } from "./db.js";
import type { ActionContext } from "./actions.js";

export const ACTION_NAMES = Object.keys(Actions) as (keyof typeof Actions)[];

const DEVICE_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

export function validateDeviceId(deviceId: unknown): string {
  if (typeof deviceId !== "string" || !DEVICE_ID_RE.test(deviceId)) {
    throw new Error("Invalid deviceId: must be a string of 8-64 characters [A-Za-z0-9_-].");
  }
  return deviceId;
}

type ActionDef = {
  description: string;
  request: z.ZodTypeAny;
  response: z.ZodTypeAny;
  handler: (args: any, ctx: ActionContext) => Promise<unknown>;
};

function lookupAction(action: string): ActionDef {
  const def = (Actions as unknown as Record<string, ActionDef>)[action];
  if (!def) {
    throw new Error(`Unknown action: ${action}. Known actions: ${ACTION_NAMES.join(", ")}`);
  }
  return def;
}

export async function handleAction(
  action: string,
  args: unknown,
  deviceId: string,
): Promise<unknown> {
  const validDeviceId = validateDeviceId(deviceId);
  const def = lookupAction(action);
  let parsedArgs: unknown;
  try {
    parsedArgs = def.request.parse(args);
  } catch (e) {
    if (e instanceof z.ZodError) {
      throw new Error(`Invalid args for action ${action}: ${e.message}`);
    }
    throw e;
  }
  const ctx: ActionContext = {
    db: getDb(),
    blobs: getBlobStore(),
    deviceId: validDeviceId,
    invalidateQueries: () => {},
  };
  const result = await def.handler(parsedArgs, ctx);
  try {
    return def.response.parse(result);
  } catch (e) {
    if (e instanceof z.ZodError) {
      throw new Error(`Action ${action} returned an invalid response: ${e.message}`);
    }
    throw e;
  }
}
