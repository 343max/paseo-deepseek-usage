import type { UsageInput } from "../shared/account.js";
import { accountKeyFor } from "./accounts.js";
import { readBalance, type BalanceReading } from "./deepseek.js";
import type { AccountLedger } from "./ledger.js";
import type { LedgerFile } from "./state.js";
import { readApiKey, type StoreLookup } from "./store.js";

export interface SampleDeps {
  ledger: LedgerFile;
  lookup?: StoreLookup;
  fetchBalance?: typeof readBalance;
  now?: () => Date;
}

export type SampleResult =
  | { kind: "ok"; entry: AccountLedger; reading: BalanceReading }
  | { kind: "rejected"; status: number }
  | { kind: "empty" }
  | { kind: "missing" };

/**
 * One balance reading folded into the ledger. Shared by the usage fetch and the background
 * sampler so a card and a tick can never disagree about how a delta is booked.
 */
export async function sampleAccount(
  input: UsageInput,
  deps: SampleDeps,
): Promise<SampleResult> {
  const apiKey = await readApiKey(input, deps.lookup);
  if (!apiKey) return { kind: "missing" };

  const outcome = await (deps.fetchBalance ?? readBalance)(apiKey);
  if (outcome.kind !== "ok") return outcome;

  const now = (deps.now ?? (() => new Date()))();
  const entry = await deps.ledger.sample(accountKeyFor(input), outcome.reading, now);
  return { kind: "ok", entry, reading: outcome.reading };
}
