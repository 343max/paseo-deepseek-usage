import { describe, expect, it } from "vitest";
import type { BalanceReading } from "../server/deepseek.js";
import {
  applySample,
  dayKeyOf,
  daySpendOf,
  pruneLedger,
  rollingSpendOf,
  type AccountLedger,
  type DayBucket,
} from "../server/ledger.js";

function reading(total: number, currency = "USD"): BalanceReading {
  return { isAvailable: true, currency, total, granted: 0, toppedUp: total };
}

function ledgerEntry(overrides: Partial<AccountLedger> = {}): AccountLedger {
  return {
    currency: "USD",
    lastBalance: 10,
    lastSampleAt: new Date(2026, 9, 13, 12, 0).toISOString(),
    firstSampleAt: new Date(2026, 9, 1, 9, 0).toISOString(),
    dayKey: "2026-10-13",
    daySince: new Date(2026, 9, 13, 0, 0).toISOString(),
    days: { "2026-10-13": { spend: 0, topUp: 0 } },
    ...overrides,
  };
}

function withDays(days: Record<string, number>): AccountLedger {
  const buckets: Record<string, DayBucket> = {};
  for (const [key, spend] of Object.entries(days)) buckets[key] = { spend, topUp: 0 };
  return ledgerEntry({ days: buckets });
}

const NOW = new Date(2026, 9, 13, 12, 30);

describe("applySample", () => {
  it("stores a baseline without inventing spend for the first reading", () => {
    const entry = applySample(undefined, reading(29.39), NOW);
    expect(entry.days["2026-10-13"]).toEqual({ spend: 0, topUp: 0 });
    expect(daySpendOf(entry)).toBe(0);
    expect(rollingSpendOf(entry, NOW)).toBe(0);
    expect(entry.lastBalance).toBe(29.39);
    expect(entry.dayKey).toBe("2026-10-13");
    expect(entry.daySince).toBe(NOW.toISOString());
    expect(entry.firstSampleAt).toBe(NOW.toISOString());
  });

  it("books a falling balance as spend for the day", () => {
    const entry = applySample(ledgerEntry(), reading(9.5), NOW);
    expect(daySpendOf(entry)).toBeCloseTo(0.5, 10);
    expect(rollingSpendOf(entry, NOW)).toBeCloseTo(0.5, 10);
  });

  it("books a rising balance as credit, never negative spend", () => {
    const entry = applySample(ledgerEntry(), reading(29.88), NOW);
    expect(daySpendOf(entry)).toBe(0);
    expect(entry.days["2026-10-13"].topUp).toBeCloseTo(19.88, 10);
  });

  it("accumulates across samples on the same day", () => {
    const first = applySample(ledgerEntry(), reading(9.7), NOW);
    const second = applySample(first, reading(9.55), NOW);
    expect(daySpendOf(second)).toBeCloseTo(0.45, 10);
    expect(second.firstSampleAt).toBe(first.firstSampleAt);
    expect(second.daySince).toBe(first.daySince);
  });

  it("attributes a cross-midnight delta to the earlier day", () => {
    const yesterday = ledgerEntry({
      dayKey: "2026-10-12",
      daySince: new Date(2026, 9, 12, 0, 0).toISOString(),
      lastSampleAt: new Date(2026, 9, 12, 23, 55).toISOString(),
      days: { "2026-10-12": { spend: 4, topUp: 0 } },
    });
    const entry = applySample(yesterday, reading(9.5), NOW);
    // Today starts clean, and the delta is not lost from the rolling window.
    expect(daySpendOf(entry)).toBe(0);
    expect(entry.daySince).toBe(NOW.toISOString());
    expect(entry.days["2026-10-12"].spend).toBeCloseTo(4.5, 10);
    expect(rollingSpendOf(entry, NOW)).toBeCloseTo(4.5, 10);
  });

  it("follows the wallet currency", () => {
    expect(applySample(undefined, reading(1, "CNY"), NOW).currency).toBe("CNY");
  });
});

describe("rollingSpendOf", () => {
  it("sums the last 30 local days, today included", () => {
    const days: Record<string, number> = {};
    for (let offset = 0; offset < 31; offset += 1) days[dayKeyOf(NOW, offset)] = 1;
    const entry = withDays(days);
    // 30 days of the 31 present are inside the window.
    expect(rollingSpendOf(entry, NOW)).toBe(30);
    expect(rollingSpendOf(entry, NOW, 31)).toBe(31);
  });

  it("counts today and ignores a gap in the history", () => {
    const entry = withDays({
      [dayKeyOf(NOW, 0)]: 1.5,
      [dayKeyOf(NOW, 1)]: 2,
      [dayKeyOf(NOW, 25)]: 3,
      [dayKeyOf(NOW, 40)]: 9,
    });
    expect(rollingSpendOf(entry, NOW)).toBe(6.5);
  });
});

describe("day pruning", () => {
  it("drops buckets that have left the rolling window", () => {
    const days: Record<string, number> = {};
    for (let offset = 0; offset < 40; offset += 1) days[dayKeyOf(NOW, offset)] = 1;
    const entry = applySample(withDays(days), reading(9.5), NOW);
    expect(Object.keys(entry.days)).toHaveLength(30);
    expect(entry.days[dayKeyOf(NOW, 30)]).toBeUndefined();
    expect(entry.days[dayKeyOf(NOW, 29)]).toBeDefined();
  });
});

describe("pruneLedger", () => {
  it("drops accounts that have not been seen for the retention window", () => {
    const stale = ledgerEntry({ lastSampleAt: new Date(2026, 0, 1).toISOString() });
    const fresh = ledgerEntry({ lastSampleAt: new Date(2026, 9, 12).toISOString() });
    const pruned = pruneLedger({ version: 2, accounts: { stale, fresh } }, NOW);
    expect(Object.keys(pruned.accounts)).toEqual(["fresh"]);
  });
});
