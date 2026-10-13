import type { BalanceReading } from "./deepseek.js";

/** Spend and credit added during one local day. */
export interface DayBucket {
  spend: number;
  topUp: number;
}

/**
 * What we know about one DeepSeek account. DeepSeek's API key endpoints expose a balance
 * but no usage history, so consumption is derived from the difference between consecutive
 * balance readings: a drop is spend, a rise is credit that was added.
 */
export interface AccountLedger {
  currency: string;
  lastBalance: number;
  lastSampleAt: string;
  firstSampleAt: string;
  /** Local day the newest reading belongs to. */
  dayKey: string;
  /** First sample of that day; later than midnight when the sampler was not running. */
  daySince: string;
  /** Per-day buckets, kept so a rolling window can age days out. */
  days: Record<string, DayBucket>;
}

export interface LedgerDocument {
  version: 2;
  accounts: Record<string, AccountLedger>;
}

/** Length of the rolling budget window, in days, counting today. */
export const ROLLING_WINDOW_DAYS = 30;

export function emptyLedger(): LedgerDocument {
  return { version: 2, accounts: {} };
}

/** Balances carry cents; anything past six decimals is subtraction noise. */
function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

export function dayKeyOf(date: Date, offsetDays = 0): string {
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate() - offsetDays);
  const pad = (value: number) => (value < 10 ? `0${value}` : String(value));
  return `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}`;
}

export function daySpendOf(entry: AccountLedger): number {
  return entry.days[entry.dayKey]?.spend ?? 0;
}

/** Spend over the last `windowDays` local days, today included. */
export function rollingSpendOf(
  entry: AccountLedger,
  now: Date,
  windowDays = ROLLING_WINDOW_DAYS,
): number {
  let total = 0;
  for (let offset = 0; offset < windowDays; offset += 1) {
    total += entry.days[dayKeyOf(now, offset)]?.spend ?? 0;
  }
  return round(total);
}

/**
 * Folds one reading into the ledger.
 *
 * A delta belongs to the day of the *earlier* reading, because that is the day the balance
 * was last known and the spend happened somewhere between the two samples. That keeps a
 * daemon that was off for a day from dumping hours of spend onto today, and the rolling
 * window still counts it as long as the day is inside the window.
 */
export function applySample(
  previous: AccountLedger | undefined,
  reading: BalanceReading,
  now: Date,
): AccountLedger {
  const at = now.toISOString();
  const dayKey = dayKeyOf(now);

  if (!previous) {
    return {
      currency: reading.currency,
      lastBalance: reading.total,
      lastSampleAt: at,
      firstSampleAt: at,
      dayKey,
      daySince: at,
      days: { [dayKey]: { spend: 0, topUp: 0 } },
    };
  }

  const delta = previous.lastBalance - reading.total;
  const spent = Math.max(0, delta);
  const toppedUp = Math.max(0, -delta);

  const days = { ...previous.days };
  const targetKey = previous.dayKey;
  const bucket = days[targetKey] ?? { spend: 0, topUp: 0 };
  days[targetKey] = {
    spend: round(bucket.spend + spent),
    topUp: round(bucket.topUp + toppedUp),
  };
  days[dayKey] = days[dayKey] ?? { spend: 0, topUp: 0 };

  return {
    currency: reading.currency,
    lastBalance: reading.total,
    lastSampleAt: at,
    firstSampleAt: previous.firstSampleAt,
    dayKey,
    daySince: previous.dayKey === dayKey ? previous.daySince : at,
    days: pruneDays(days, now),
  };
}

/** Days outside the rolling window can never be read again. */
function pruneDays(days: Record<string, DayBucket>, now: Date): Record<string, DayBucket> {
  const cutoff = dayKeyOf(now, ROLLING_WINDOW_DAYS - 1);
  const kept: Record<string, DayBucket> = {};
  for (const [key, bucket] of Object.entries(days)) {
    if (key >= cutoff) kept[key] = bucket;
  }
  return kept;
}

/** Accounts that have not been seen for this long are dropped when the file is written. */
export const LEDGER_RETENTION_MS = 120 * 24 * 60 * 60 * 1000;

export function pruneLedger(document: LedgerDocument, now: Date): LedgerDocument {
  const cutoff = now.getTime() - LEDGER_RETENTION_MS;
  const accounts: Record<string, AccountLedger> = {};
  for (const [key, entry] of Object.entries(document.accounts)) {
    const seen = Date.parse(entry.lastSampleAt);
    if (Number.isFinite(seen) && seen >= cutoff) accounts[key] = entry;
  }
  return { version: 2, accounts };
}
