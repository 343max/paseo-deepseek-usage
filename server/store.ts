import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";
import type { UsageInput } from "../shared/account.js";

export interface StoreLookup {
  home?: string;
  env?: NodeJS.ProcessEnv;
}

/** Only the DeepSeek entry of pi's auth store is meaningful here; everything else is kept. */
const piAuthSchema = z
  .object({
    deepseek: z
      .object({
        type: z.string().optional(),
        key: z.string().min(1).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

/**
 * pi's own login store. Mirrors the path resolution the bundled Claude and Codex sources
 * use, so a `PI_CODING_AGENT_DIR` override behaves the same for every provider.
 */
export function piAuthPath(lookup: StoreLookup = {}): string {
  const home = lookup.home ?? homedir();
  const env = lookup.env ?? process.env;
  const configured = env.PI_CODING_AGENT_DIR?.trim();
  if (!configured) return join(home, ".pi", "agent", "auth.json");
  if (configured === "~") return join(home, "auth.json");
  const directory = configured.startsWith("~/")
    ? join(home, configured.slice(2))
    : resolve(configured);
  return join(directory, "auth.json");
}

/**
 * Re-reads the selected store and returns the API key, or null when it is gone. The store
 * is never written: pi owns rotation.
 */
export async function readApiKey(
  input: UsageInput,
  lookup: StoreLookup = {},
): Promise<string | null> {
  if (input.store === "env") {
    const env = lookup.env ?? process.env;
    const value = env[input.locator]?.trim();
    return value ? value : null;
  }
  try {
    const parsed = piAuthSchema.parse(JSON.parse(await readFile(input.locator, "utf8")));
    const key = parsed.deepseek?.key?.trim();
    return key ? key : null;
  } catch {
    return null;
  }
}
