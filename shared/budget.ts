import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

/**
 * DeepSeek is prepaid, so there is no provider-side quota to show as a percentage. The
 * budgets below are the user's own limits; they are the only reason this source can put a
 * percent window in the sidebar. Unset means no window at all.
 *
 * Limits are amounts in the wallet's own currency, which DeepSeek reports as USD or CNY.
 * Spend and budget are then the same unit, so the percentage means something either way.
 */
export const usageSettings = defineSettings({
  id: "budgets",
  scope: "host",
  version: 3,
  schema: z.object({
    dailyBudget: z.number().positive().max(100_000).nullable().default(null),
    rollingBudget: z.number().positive().max(100_000).nullable().default(null),
    sampleIntervalMinutes: z.number().int().min(5).max(240).default(10),
  }),
  /**
   * v1 called the second limit "monthly" and reset it on the calendar month; v2 made it
   * rolling but kept the currency in the key name. Only the names moved: the amounts carry
   * over untouched.
   */
  migrate(values, fromVersion) {
    if (fromVersion >= 3) return values;
    const previous = (values ?? {}) as Record<string, unknown>;
    const {
      monthlyBudgetUsd,
      dailyBudgetUsd,
      rollingBudgetUsd,
      dailyBudget,
      rollingBudget,
      ...rest
    } = previous;
    return {
      ...rest,
      dailyBudget: dailyBudget ?? dailyBudgetUsd ?? null,
      rollingBudget: rollingBudget ?? rollingBudgetUsd ?? monthlyBudgetUsd ?? null,
    };
  },
});

export type UsageSettingsValues = z.infer<typeof usageSettings.schema>;

export const DEFAULT_SETTINGS: UsageSettingsValues = {
  dailyBudget: null,
  rollingBudget: null,
  sampleIntervalMinutes: 10,
};

export const SAMPLE_INTERVAL_OPTIONS = [5, 10, 15, 30, 60] as const;

/** Empty means "no limit", anything else must be a positive, finite amount. */
export function parseBudgetInput(text: string): { value: number | null } | { error: string } {
  const trimmed = text.trim();
  if (trimmed === "") return { value: null };
  const value = Number(trimmed.replace(/^\$/, "").replace(/,/g, ""));
  if (!Number.isFinite(value)) return { error: "Enter a number, or leave it empty" };
  if (value <= 0) return { error: "A limit has to be greater than zero" };
  if (value > 100_000) return { error: "That is larger than this plugin stores" };
  return { value: Math.round(value * 100) / 100 };
}

/** Never throws: a host with an unreadable settings document still gets usable values. */
export function resolveSettings(values: unknown): UsageSettingsValues {
  const parsed = usageSettings.schema.safeParse(values);
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

/** USD and CNY are the two wallets DeepSeek reports; anything else is shown as a code. */
export function formatAmount(value: number, currency: string): string {
  const text = value.toFixed(2);
  return currency === "USD" ? `$${text}` : `${text} ${currency}`;
}
