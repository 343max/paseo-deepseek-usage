import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BalanceReading } from "../server/deepseek.js";
import { daySpendOf } from "../server/ledger.js";
import { LedgerFile } from "../server/state.js";

let directory: string;
let path: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "deepseek-ledger-"));
  path = join(directory, "ledger.json");
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function reading(total: number): BalanceReading {
  return { isAvailable: true, currency: "USD", total, granted: 0, toppedUp: total };
}

const T1 = new Date(2026, 9, 13, 9, 0);
const T2 = new Date(2026, 9, 13, 9, 30);

describe("LedgerFile", () => {
  it("starts empty when there is no file", async () => {
    const ledger = new LedgerFile(path);
    expect(await ledger.read()).toEqual({ version: 2, accounts: {} });
  });

  it("creates the file and accumulates spend across samples", async () => {
    const ledger = new LedgerFile(path);
    const first = await ledger.sample("acct", reading(10), T1);
    expect(daySpendOf(first)).toBe(0);
    const second = await ledger.sample("acct", reading(9.5), T2);
    expect(daySpendOf(second)).toBeCloseTo(0.5, 10);
    expect(second.firstSampleAt).toBe(T1.toISOString());

    const stored = JSON.parse(await readFile(path, "utf8"));
    expect(stored.version).toBe(2);
    expect(stored.accounts.acct.lastBalance).toBe(9.5);
    expect(stored.accounts.acct.days[second.dayKey].spend).toBeCloseTo(0.5, 10);
  });

  it("serializes concurrent samples so no delta is lost", async () => {
    const ledger = new LedgerFile(path);
    // A first reading only sets the baseline; the interesting part starts after it.
    await ledger.sample("acct", reading(10), T1);
    await Promise.all([
      ledger.sample("acct", reading(9.5), T2),
      ledger.sample("acct", reading(9.9), T2),
    ]);
    const document = await ledger.read();
    // Raced, the second read-modify-write would have started from 10 and lost the 0.5.
    expect(document.accounts.acct.lastBalance).toBe(9.9);
    expect(daySpendOf(document.accounts.acct)).toBeCloseTo(0.5, 10);
    expect(document.accounts.acct.days["2026-10-13"].topUp).toBeCloseTo(0.4, 10);
  });

  it("keeps separate accounts apart", async () => {
    const ledger = new LedgerFile(path);
    await ledger.sample("one", reading(10), T1);
    await ledger.sample("two", reading(4), T1);
    await ledger.sample("two", reading(3), T2);
    const document = await ledger.read();
    expect(daySpendOf(document.accounts.one)).toBe(0);
    expect(daySpendOf(document.accounts.two)).toBeCloseTo(1, 10);
  });

  it("carries a v1 calendar-month ledger into per-day buckets", async () => {
    await writeFile(
      path,
      JSON.stringify({
        version: 1,
        accounts: {
          acct: {
            currency: "USD",
            lastBalance: 29.03,
            lastSampleAt: T2.toISOString(),
            firstSampleAt: T1.toISOString(),
            dayKey: "2026-10-13",
            daySince: T1.toISOString(),
            daySpend: 0.17,
            dayTopUp: 0,
            monthKey: "2026-10",
            monthSpend: 0.17,
            monthTopUp: 0,
          },
        },
      }),
    );
    const document = await new LedgerFile(path).read();
    expect(document.version).toBe(2);
    expect(document.accounts.acct.days).toEqual({ "2026-10-13": { spend: 0.17, topUp: 0 } });
    expect(daySpendOf(document.accounts.acct)).toBe(0.17);
  });

  it("recovers from a damaged file instead of losing the card", async () => {
    const warn = vi.fn();
    await writeFile(path, "{ this is not a ledger");
    const ledger = new LedgerFile(path, { warn });
    expect(await ledger.read()).toEqual({ version: 2, accounts: {} });
    expect(warn).toHaveBeenCalledOnce();

    const entry = await ledger.sample("acct", reading(10), T1);
    expect(entry.lastBalance).toBe(10);
  });
});

describe("LedgerFile.defaultPath", () => {
  it("uses an explicit override when given", () => {
    expect(LedgerFile.defaultPath({ PASEO_DEEPSEEK_USAGE_STATE_DIR: "/srv/state" })).toBe(
      "/srv/state/ledger.json",
    );
  });

  it("follows XDG_STATE_HOME, then the home directory", () => {
    expect(LedgerFile.defaultPath({ XDG_STATE_HOME: "/xdg", HOME: "/home/tester" })).toBe(
      "/xdg/paseo-deepseek-usage/ledger.json",
    );
    expect(LedgerFile.defaultPath({ HOME: "/home/tester" })).toBe(
      "/home/tester/.local/state/paseo-deepseek-usage/ledger.json",
    );
  });
});
