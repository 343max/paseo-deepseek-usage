import { describe, expect, it } from "vitest";
import { UsageReportSchema } from "@getpaseo/protocol/messages";
import {
  DEFAULT_SETTINGS,
  parseBudgetInput,
  resolveSettings,
  usageSettings,
} from "../shared/budget.js";
import type { BalanceReading } from "../server/deepseek.js";
import type { AccountLedger } from "../server/ledger.js";
import { buildReport } from "../server/report.js";

const NOW = new Date(2026, 9, 13, 15, 30);

const reading: BalanceReading = {
  isAvailable: true,
  currency: "USD",
  total: 29.29,
  granted: 0,
  toppedUp: 29.29,
};

const ledger: AccountLedger = {
  currency: "USD",
  lastBalance: 29.29,
  lastSampleAt: NOW.toISOString(),
  firstSampleAt: new Date(2026, 9, 11, 8, 0).toISOString(),
  dayKey: "2026-10-13",
  daySince: new Date(2026, 9, 13, 0, 0).toISOString(),
  days: {
    "2026-10-13": { spend: 1.42, topUp: 19.88 },
    "2026-10-12": { spend: 7.35, topUp: 0 },
    "2026-10-11": { spend: 10, topUp: 0 },
  },
};

function report(overrides: Partial<Parameters<typeof buildReport>[0]> = {}) {
  const result = buildReport({
    reading,
    ledger,
    settings: DEFAULT_SETTINGS,
    now: NOW,
    ...overrides,
  });
  if (result.status !== "available") throw new Error(`expected an available report`);
  return result;
}

/** The document's migration is optional in the type; this one must exist to be tested. */
function migrate(values: unknown, fromVersion: number): unknown {
  const run = usageSettings.migrate;
  if (!run) throw new Error("the settings document should declare a migration");
  return run(values, fromVersion);
}

describe("buildReport", () => {
  it("shows the balance and nothing else without a budget", () => {
    const result = report();
    expect(result.planLabel).toBe("Pay as you go");
    expect(result.windows).toEqual([]);
    expect(result.balances?.map((entry) => entry.id)).toEqual(["balance"]);
    expect(result.balances?.[0].label).toBe("Balance (USD)");
    expect(result.balances?.[0].remaining).toBe(29.29);
    expect(result.details).toEqual([]);
  });

  it("keeps spend out of the rows but still uses it for the budget", () => {
    const result = report({ settings: { ...DEFAULT_SETTINGS, dailyBudget: 5 } });
    expect(result.balances?.map((entry) => entry.id)).toEqual(["balance"]);
    expect(result.windows[0].usedPct).toBeCloseTo(28.4, 5);
  });

  it("turns the daily limit into the percent window the sidebar uses", () => {
    const result = report({ settings: { ...DEFAULT_SETTINGS, dailyBudget: 5 } });
    expect(result.windows).toHaveLength(1);
    const window = result.windows[0];
    expect(window.id).toBe("budget:day");
    expect(window.label).toBe("Daily budget");
    expect(window.shortLabel).toBe("today");
    expect(window.summary).toBe(true);
    expect(window.usedPct).toBeCloseTo(28.4, 5);
    expect(window.remainingPct).toBeCloseTo(71.6, 5);
    expect(window.resetsAt).toBeNull();
    expect(window.tone).toBe("ok");
  });

  it("rolls the 30 day limit over the last 30 days", () => {
    const result = report({ settings: { ...DEFAULT_SETTINGS, rollingBudget: 50 } });
    expect(result.windows).toHaveLength(1);
    const window = result.windows[0];
    expect(window.id).toBe("budget:rolling");
    expect(window.label).toBe("30 day budget");
    expect(window.shortLabel).toBe("30d");
    expect(window.summary).toBeUndefined();
    // 1.42 + 7.35 + 10 over the window.
    expect(window.usedPct).toBeCloseTo(37.54, 2);
    expect(window.resetsAt).toBeNull();
  });

  it("ages old days out of the rolling window without touching today", () => {
    const result = report({
      settings: { ...DEFAULT_SETTINGS, rollingBudget: 50 },
      ledger: {
        ...ledger,
        days: {
          "2026-10-13": { spend: 1.42, topUp: 0 },
          // Outside the 30 day window that ends today.
          "2026-09-01": { spend: 40, topUp: 0 },
        },
      },
    });
    expect(result.windows[0].usedPct).toBeCloseTo(2.84, 2);
  });

  it("escalates a budget that is nearly spent", () => {
    const result = report({ settings: { ...DEFAULT_SETTINGS, dailyBudget: 1.5 } });
    expect(result.windows[0].tone).toBe("danger");
  });

  it("rounds the percentage instead of shipping float noise", () => {
    const result = report({
      settings: { ...DEFAULT_SETTINGS, rollingBudget: 20 },
      ledger: { ...ledger, days: { "2026-10-13": { spend: 0.34, topUp: 0 } } },
    });
    expect(result.windows[0].usedPct).toBe(1.7);
    expect(result.windows[0].remainingPct).toBe(98.3);
  });

  it("says nothing extra while the account can serve requests", () => {
    expect(report().details).toEqual([]);
  });

  it("marks an account that cannot serve requests", () => {
    const result = report({ reading: { ...reading, isAvailable: false, total: 0 } });
    expect(result.balances?.[0].tone).toBe("danger");
    expect(result.details?.find((entry) => entry.id === "account")?.tone).toBe("danger");
  });

  it("names the currency for a wallet that is not USD", () => {
    const result = report({ reading: { ...reading, currency: "CNY", total: 88.5 } });
    expect(result.balances?.[0].label).toBe("Balance (CNY)");
  });

  it("satisfies the protocol schema the daemon parses every report with", () => {
    const withBudgets = report({
      settings: { ...DEFAULT_SETTINGS, dailyBudget: 5, rollingBudget: 50 },
    });
    expect(() => UsageReportSchema.parse(withBudgets)).not.toThrow();
    expect(() => UsageReportSchema.parse(report())).not.toThrow();
  });
});

describe("settings helpers", () => {
  it("treats an empty field as no limit", () => {
    expect(parseBudgetInput("  ")).toEqual({ value: null });
  });

  it("accepts a plain or dollar-prefixed amount", () => {
    expect(parseBudgetInput("$12.505")).toEqual({ value: 12.51 });
  });

  it("rejects zero and nonsense", () => {
    expect(parseBudgetInput("0")).toHaveProperty("error");
    expect(parseBudgetInput("lots")).toHaveProperty("error");
  });

  it("falls back to defaults for an unusable document", () => {
    expect(resolveSettings({ dailyBudget: -1 })).toEqual(DEFAULT_SETTINGS);
    expect(resolveSettings({ dailyBudget: 3 })).toEqual({
      ...DEFAULT_SETTINGS,
      dailyBudget: 3,
    });
  });

  it("moves a v1 monthly limit onto the rolling window", () => {
    const migrated = resolveSettings(migrate({ dailyBudgetUsd: 2, monthlyBudgetUsd: 20 }, 1));
    expect(migrated).toEqual({
      dailyBudget: 2,
      rollingBudget: 20,
      sampleIntervalMinutes: 10,
    });
  });

  it("renames the v2 keys without touching the amounts", () => {
    const migrated = resolveSettings(
      migrate({ dailyBudgetUsd: 3, rollingBudgetUsd: 40, sampleIntervalMinutes: 15 }, 2),
    );
    expect(migrated).toEqual({ dailyBudget: 3, rollingBudget: 40, sampleIntervalMinutes: 15 });
  });

  it("leaves a current document alone", () => {
    const values = { dailyBudget: 3, rollingBudget: 40, sampleIntervalMinutes: 15 };
    expect(resolveSettings(migrate(values, 3))).toEqual(values);
  });
});
