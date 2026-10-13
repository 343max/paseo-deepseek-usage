import { z } from "zod";
import { BALANCE_URL } from "../shared/account.js";

export interface BalanceReading {
  isAvailable: boolean;
  /** The wallet currency, "USD" or "CNY". Paseo has no cny unit, so the label carries it. */
  currency: string;
  total: number;
  granted: number;
  toppedUp: number;
}

export type BalanceOutcome =
  | { kind: "ok"; reading: BalanceReading }
  | { kind: "rejected"; status: number }
  | { kind: "empty" };

/** The API returns amounts as decimal strings, so coerce before validating. */
const balanceSchema = z.object({
  is_available: z.boolean(),
  balance_infos: z.array(
    z.object({
      currency: z.coerce.string().min(1),
      total_balance: z.coerce.number(),
      granted_balance: z.coerce.number().optional(),
      topped_up_balance: z.coerce.number().optional(),
    }),
  ),
});

/** The API answers in well under a second; anything longer is a hung connection. */
export const BALANCE_TIMEOUT_MS = 15_000;

export async function readBalance(
  apiKey: string,
  fetchApi: typeof fetch = fetch,
  timeoutMs: number = BALANCE_TIMEOUT_MS,
): Promise<BalanceOutcome> {
  // An explicit controller rather than AbortSignal.timeout: that static's type comes and goes
  // with the ambient node types, and this works the same on every build.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchApi(BALANCE_URL, {
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    });

    if (response.status === 401 || response.status === 403) {
      return { kind: "rejected", status: response.status };
    }
    if (!response.ok) throw new Error(`DeepSeek balance API returned ${response.status}`);

    const parsed = balanceSchema.parse(await response.json());
    const info = parsed.balance_infos[0];
    if (!info) return { kind: "empty" };

    return {
      kind: "ok",
      reading: {
        isAvailable: parsed.is_available,
        currency: info.currency.toUpperCase(),
        total: info.total_balance,
        granted: info.granted_balance ?? 0,
        toppedUp: info.topped_up_balance ?? 0,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}
