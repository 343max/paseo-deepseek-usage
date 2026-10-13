import {
  balanceToneFromRemaining,
  toneFromUsedPct,
  windowFromUsedPct,
  type UsageBalance,
  type UsageDetail,
  type UsageReport,
  type UsageWindow,
} from "@getpaseo/plugin/server/usage";
import type { UsageSettingsValues } from "../shared/budget.js";
import type { BalanceReading } from "./deepseek.js";
import { daySpendOf, rollingSpendOf, type AccountLedger } from "./ledger.js";

export interface ReportInput {
  reading: BalanceReading;
  ledger: AccountLedger;
  settings: UsageSettingsValues;
  now: Date;
}

/** Spend figures are always USD-denominated; a CNY account says so in the balance label. */
const UNIT = "usd" as const;

export function buildReport({ reading, ledger, settings, now }: ReportInput): UsageReport {
  // The card is deliberately one number. Spend still drives the budget windows below; it is
  // just not repeated as its own row next to the balance it is already reflected in.
  const balances: UsageBalance[] = [
    {
      id: "balance",
      label: `Balance (${reading.currency})`,
      remaining: reading.total,
      unit: UNIT,
      tone: reading.isAvailable ? balanceToneFromRemaining(reading.total) : "danger",
    },
  ];

  const windows: UsageWindow[] = [];
  // Neither limit reports a reset instant: the daily one ends at the user's own midnight, and
  // a rolling window has nothing to reset.
  const addBudgetWindow = (input: {
    id: string;
    label: string;
    shortLabel: string;
    summary?: boolean;
    spend: number;
    budget: number | null;
  }) => {
    if (input.budget === null) return;
    // Rounded here so the report never ships float noise like 1.7000000000000002.
    const usedPct = Math.round((input.spend / input.budget) * 10_000) / 100;
    windows.push(
      windowFromUsedPct({
        id: input.id,
        label: input.label,
        shortLabel: input.shortLabel,
        summary: input.summary,
        utilizationPct: usedPct,
        tone: toneFromUsedPct(usedPct),
      }),
    );
  };
  // The daily limit is the one that reaches the sidebar; the rolling one stays in the modal.
  addBudgetWindow({
    id: "budget:day",
    label: "Daily budget",
    shortLabel: "today",
    summary: true,
    spend: daySpendOf(ledger),
    budget: settings.dailyBudget,
  });
  addBudgetWindow({
    id: "budget:rolling",
    label: "30 day budget",
    shortLabel: "30d",
    spend: rollingSpendOf(ledger, now),
    budget: settings.rollingBudget,
  });

  // Only an account that cannot serve requests says anything beyond the balance.
  const details: UsageDetail[] = [];
  if (!reading.isAvailable) {
    details.push({
      id: "account",
      label: "Status",
      value: "Unavailable, top up to continue",
      tone: "danger",
    });
  }

  return {
    status: "available",
    planLabel: "Pay as you go",
    windows,
    balances,
    details,
  };
}
