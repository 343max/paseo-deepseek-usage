import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../shared/budget.js";
import type { AccountLedger } from "../server/ledger.js";
import { startSampler } from "../server/sampler.js";
import type { LedgerFile } from "../server/state.js";

const NOW = new Date(2026, 9, 13, 9, 0);

const entry: AccountLedger = {
  currency: "USD",
  lastBalance: 10,
  lastSampleAt: NOW.toISOString(),
  firstSampleAt: NOW.toISOString(),
  dayKey: "2026-10-13",
  daySince: NOW.toISOString(),
  days: { "2026-10-13": { spend: 0, topUp: 0 } },
};

function setup(options: { fail?: boolean; accounts?: { key: string; input: unknown }[] } = {}) {
  const ledger = { sample: vi.fn(async () => entry) } as unknown as LedgerFile;
  const warn = vi.fn();
  const sample = vi.fn(async () => {
    if (options.fail) throw new Error("network is down");
    return { kind: "ok" as const, entry, reading: { isAvailable: true, currency: "USD", total: 10, granted: 0, toppedUp: 10 } };
  });
  const stop = startSampler({
    ledger,
    readSettings: async () => ({ ...DEFAULT_SETTINGS, sampleIntervalMinutes: 5 }),
    warn,
    now: () => NOW,
    discover: async () => options.accounts ?? [{ key: "acct", input: { store: "env", locator: "DEEPSEEK_API_KEY" } }],
    sample,
  });
  return { stop, sample, warn, ledger };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("startSampler", () => {
  it("samples as soon as the plugin starts", async () => {
    vi.useFakeTimers();
    const { stop, sample } = setup();
    await vi.advanceTimersByTimeAsync(0);
    expect(sample).toHaveBeenCalledTimes(1);
    stop();
  });

  it("keeps sampling at the configured interval", async () => {
    vi.useFakeTimers();
    const { stop, sample } = setup();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(sample).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(sample).toHaveBeenCalledTimes(3);
    stop();
  });

  it("stops for good once cleaned up", async () => {
    vi.useFakeTimers();
    const { stop, sample } = setup();
    await vi.advanceTimersByTimeAsync(0);
    stop();
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(sample).toHaveBeenCalledTimes(1);
  });

  it("backs off after a failure instead of hammering the API", async () => {
    vi.useFakeTimers();
    const { stop, sample, warn } = setup({ fail: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(warn).toHaveBeenCalled();

    // One minute of backoff on top of the five minute interval.
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(sample).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sample).toHaveBeenCalledTimes(2);
    stop();
  });

  it("skips an account whose input is not the contract", async () => {
    vi.useFakeTimers();
    const { stop, sample, warn } = setup({ accounts: [{ key: "bad", input: { store: "nope" } }] });
    await vi.advanceTimersByTimeAsync(0);
    expect(sample).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    stop();
  });
});
