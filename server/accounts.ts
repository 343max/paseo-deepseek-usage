import { hashAccountKey, type UsageAccount, type UsageScope } from "@getpaseo/plugin/server/usage";
import { homedir } from "node:os";
import { ENV_LOCATOR, type UsageInput } from "../shared/account.js";
import { piAuthPath, readApiKey, type StoreLookup } from "./store.js";

/**
 * Stable identity for a login: the store, never the key material. It survives rotating the
 * key in place, and pi and the environment resolve to the same card only when they really
 * are the same store.
 */
export function accountKeyFor(input: UsageInput): string {
  return hashAccountKey(`${input.store}:${input.locator}`);
}

function piAccount(path: string): UsageAccount {
  const input: UsageInput = { store: "pi", locator: path };
  return { key: accountKeyFor(input), harness: "Pi", input };
}

function envAccount(locator: string): UsageAccount {
  const input: UsageInput = { store: "env", locator };
  return { key: accountKeyFor(input), harness: "Environment", input };
}

export async function discoverAccounts(
  scope: UsageScope,
  lookup: StoreLookup = {},
): Promise<UsageAccount[]> {
  return scope.kind === "global" ? globalAccounts(lookup) : sessionAccounts(scope, lookup);
}

/**
 * pi's own login store first: it is where a DeepSeek key normally lives on this machine.
 * The environment variable is only a fallback so one account does not become two cards.
 */
async function globalAccounts(lookup: StoreLookup): Promise<UsageAccount[]> {
  const path = piAuthPath(lookup);
  if (await readApiKey({ store: "pi", locator: path }, lookup)) return [piAccount(path)];
  const env = lookup.env ?? process.env;
  if (env[ENV_LOCATOR]?.trim()) return [envAccount(ENV_LOCATOR)];
  return [];
}

/**
 * Only this session's own login, resolved from its launch environment. A session that is
 * not a direct DeepSeek session gets nothing, so an agent on OpenRouter or Moonshot never
 * shows DeepSeek account usage.
 */
async function sessionAccounts(
  scope: Extract<UsageScope, { kind: "session" }>,
  lookup: StoreLookup,
): Promise<UsageAccount[]> {
  if (scope.provider !== "pi" && scope.provider !== "omp") return [];

  const env = scope.env;
  const baseUrl = env.DEEPSEEK_BASE_URL?.trim();
  if (baseUrl && !/^https?:\/\/api\.deepseek\.com(\/|$)/i.test(baseUrl)) return [];

  const sessionLookup: StoreLookup = {
    home: env.HOME || env.USERPROFILE || homedir(),
    env,
  };

  if (env[ENV_LOCATOR]?.trim()) return [envAccount(ENV_LOCATOR)];
  if (!/^deepseek\//i.test(scope.model ?? "")) return [];

  const path = piAuthPath(sessionLookup);
  return (await readApiKey({ store: "pi", locator: path }, sessionLookup)) ? [piAccount(path)] : [];
}
