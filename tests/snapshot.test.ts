import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../shared/budget.js";
import type { AccountLedger } from "../server/ledger.js";
import { buildSnapshot, isStale, SNAPSHOT_STALE_MS } from "../server/snapshot.js";

const NOW = new Date(2026, 9, 13, 15, 30);

const entry: AccountLedger = {
  currency: "USD",
  lastBalance: 28.95,
  lastSampleAt: new Date(2026, 9, 13, 15, 29).toISOString(),
  firstSampleAt: new Date(2026, 9, 13, 15, 0).toISOString(),
  dayKey: "2026-10-13",
  daySince: new Date(2026, 9, 13, 15, 0).toISOString(),
  days: {
    "2026-10-13": { spend: 0.25, topUp: 0 },
    "2026-10-10": { spend: 4, topUp: 0 },
    // Outside the rolling window.
    "2026-09-01": { spend: 9, topUp: 0 },
  },
};

const settings = { ...DEFAULT_SETTINGS, dailyBudget: 2, rollingBudget: 20 };

describe("buildSnapshot", () => {
  it("reports the balance, today, and the rolling window against the limits", () => {
    expect(buildSnapshot({ entry, settings, now: NOW })).toEqual({
      status: "ok",
      currency: "USD",
      balance: 28.95,
      daySpend: 0.25,
      rollingSpend: 4.25,
      dailyBudget: 2,
      rollingBudget: 20,
      sampledAt: entry.lastSampleAt,
    });
  });

  it("still reports spend when no limit is set", () => {
    const snapshot = buildSnapshot({ entry, settings: DEFAULT_SETTINGS, now: NOW });
    expect(snapshot).toMatchObject({
      status: "ok",
      daySpend: 0.25,
      dailyBudget: null,
      rollingBudget: null,
    });
  });

  it("explains itself before the first reading instead of showing zeroes", () => {
    const snapshot = buildSnapshot({ entry: undefined, settings, now: NOW });
    expect(snapshot.status).toBe("unavailable");
    if (snapshot.status !== "unavailable") return;
    expect(snapshot.reason).toContain("No balance has been read yet");
  });
});

describe("isStale", () => {
  it("asks for a reading when there is none", () => {
    expect(isStale(undefined, NOW)).toBe(true);
  });

  it("reuses an entry that was sampled moments ago", () => {
    const fresh = { ...entry, lastSampleAt: new Date(NOW.getTime() - 1_000).toISOString() };
    expect(isStale(fresh, NOW)).toBe(false);
  });

  it("refreshes once the entry is older than the threshold", () => {
    const old = {
      ...entry,
      lastSampleAt: new Date(NOW.getTime() - SNAPSHOT_STALE_MS).toISOString(),
    };
    expect(isStale(old, NOW)).toBe(true);
  });

  it("treats an unparsable timestamp as stale rather than trusting it", () => {
    expect(isStale({ ...entry, lastSampleAt: "not a date" }, NOW)).toBe(true);
  });
});
