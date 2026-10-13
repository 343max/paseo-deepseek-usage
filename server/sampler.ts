import type { UsageScope } from "@getpaseo/plugin/server/usage";
import { usageInputSchema } from "../shared/account.js";
import type { UsageSettingsValues } from "../shared/budget.js";
import { discoverAccounts } from "./accounts.js";
import { sampleAccount } from "./sample.js";
import type { LedgerFile } from "./state.js";

export interface SamplerOptions {
  ledger: LedgerFile;
  readSettings: () => Promise<UsageSettingsValues>;
  warn: (message: string, error?: unknown) => void;
  /** Injection seams for tests. */
  discover?: (scope: UsageScope) => Promise<{ key: string; input: unknown }[]>;
  sample?: typeof sampleAccount;
  now?: () => Date;
}

const MAX_BACKOFF_MS = 60 * 60 * 1000;

/**
 * DeepSeek only tells us a balance, so pinning a "spent today" figure to the calendar needs
 * readings on both sides of midnight. This sampler is the reason that works, and why the
 * plugin subprocess staying up matters.
 */
export function startSampler(options: SamplerOptions): () => void {
  const { ledger, readSettings, warn } = options;
  const discover = options.discover ?? ((scope) => discoverAccounts(scope));
  const sample = options.sample ?? sampleAccount;
  const now = options.now ?? (() => new Date());

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let backoffMs = 0;

  const tick = async () => {
    let failed = false;
    let intervalMinutes = 10;

    try {
      const values = await readSettings();
      intervalMinutes = values.sampleIntervalMinutes;

      let accounts: { key: string; input: unknown }[] = [];
      try {
        accounts = await discover({ kind: "global" });
      } catch (error) {
        failed = true;
        warn("DeepSeek account discovery failed", error);
      }

      for (const account of accounts) {
        try {
          const input = usageInputSchema.parse(account.input);
          const result = await sample(input, { ledger, now });
          // A rejected or vanished login is reported on the card, not by the sampler.
          if (result.kind === "ok") continue;
        } catch (error) {
          failed = true;
          warn(`DeepSeek balance sample failed for ${account.key}`, error);
        }
      }
    } catch (error) {
      failed = true;
      warn("DeepSeek sampler tick failed", error);
    }

    if (stopped) return;
    backoffMs = failed ? Math.min(backoffMs === 0 ? 60_000 : backoffMs * 2, MAX_BACKOFF_MS) : 0;
    const delay = intervalMinutes * 60_000 + backoffMs;
    timer = setTimeout(() => void tick(), delay);
    timer.unref?.();
  };

  void tick();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = undefined;
  };
}
