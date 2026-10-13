import { afterEach, describe, expect, it, vi } from "vitest";
import { BALANCE_TIMEOUT_MS, readBalance } from "../server/deepseek.js";

function jsonFetch(status: number, payload: unknown): typeof fetch {
  return (async () =>
    ({
      status,
      ok: status >= 200 && status < 300,
      json: async () => payload,
    }) as unknown as Response) as unknown as typeof fetch;
}

describe("readBalance", () => {
  it("parses the decimal strings the API returns", async () => {
    const outcome = await readBalance(
      "sk-test",
      jsonFetch(200, {
        is_available: true,
        balance_infos: [
          {
            currency: "USD",
            total_balance: "29.39",
            granted_balance: "0.00",
            topped_up_balance: "19.88",
          },
        ],
      }),
    );
    expect(outcome).toEqual({
      kind: "ok",
      reading: { isAvailable: true, currency: "USD", total: 29.39, granted: 0, toppedUp: 19.88 },
    });
  });

  it("keeps the wallet currency for a CNY account", async () => {
    const outcome = await readBalance(
      "sk-test",
      jsonFetch(200, {
        is_available: true,
        balance_infos: [{ currency: "cny", total_balance: "88.5" }],
      }),
    );
    expect(outcome.kind === "ok" && outcome.reading.currency).toBe("CNY");
  });

  it("reports a rejected key instead of throwing", async () => {
    const outcome = await readBalance("sk-bogus", jsonFetch(401, {}));
    expect(outcome).toEqual({ kind: "rejected", status: 401 });
  });

  it("treats an account without wallets as empty", async () => {
    const outcome = await readBalance(
      "sk-test",
      jsonFetch(200, { is_available: false, balance_infos: [] }),
    );
    expect(outcome).toEqual({ kind: "empty" });
  });

  it("throws on a server error so the card can say the read failed", async () => {
    await expect(readBalance("sk-test", jsonFetch(500, {}))).rejects.toThrow("returned 500");
  });

  it("throws on a response that is not the documented shape", async () => {
    await expect(readBalance("sk-test", jsonFetch(200, { ok: true }))).rejects.toThrow();
  });

  it("gives a hung connection a deadline instead of waiting forever", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const hanging = ((_url: string, init?: { signal?: AbortSignal }) => {
      signal = init?.signal;
      return new Promise<Response>(() => {});
    }) as unknown as typeof fetch;

    void readBalance("sk-test", hanging, 1_000).catch(() => undefined);
    await vi.advanceTimersByTimeAsync(999);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(signal?.aborted).toBe(true);
    vi.useRealTimers();
  });

  it("waits long enough to be a real deadline", () => {
    expect(BALANCE_TIMEOUT_MS).toBeGreaterThan(5_000);
  });
});
