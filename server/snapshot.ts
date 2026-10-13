import type { UsageSettingsValues } from "../shared/budget.js";
import type { UsageSnapshot } from "../shared/snapshot.js";
import { daySpendOf, rollingSpendOf, type AccountLedger } from "./ledger.js";

/**
 * Builds the settings screen's snapshot from what the ledger already knows, so opening the
 * screen costs no API call of its own.
 */
export function buildSnapshot(input: {
  entry: AccountLedger | undefined;
  settings: UsageSettingsValues;
  now: Date;
}): UsageSnapshot {
  const { entry, settings, now } = input;
  if (!entry) {
    return {
      status: "unavailable",
      reason: "No balance has been read yet. The first reading arrives within a minute of the plugin starting.",
    };
  }
  return {
    status: "ok",
    currency: entry.currency,
    balance: entry.lastBalance,
    daySpend: daySpendOf(entry),
    rollingSpend: rollingSpendOf(entry, now),
    dailyBudget: settings.dailyBudget,
    rollingBudget: settings.rollingBudget,
    sampledAt: entry.lastSampleAt,
  };
}

/** How stale a ledger entry may be before the snapshot refreshes it from the API. */
export const SNAPSHOT_STALE_MS = 60_000;

export function isStale(entry: AccountLedger | undefined, now: Date): boolean {
  if (!entry) return true;
  const sampledAt = Date.parse(entry.lastSampleAt);
  return !Number.isFinite(sampledAt) || now.getTime() - sampledAt >= SNAPSHOT_STALE_MS;
}
