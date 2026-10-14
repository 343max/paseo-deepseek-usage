import type { PluginServerContext } from "@getpaseo/plugin/server";
import { unavailable, type UsageReport } from "@getpaseo/plugin/server/usage";
import {
  USAGE_SOURCE_ICON,
  USAGE_SOURCE_ID,
  USAGE_SOURCE_LABEL,
  usageInputSchema,
} from "./shared/account.js";
import { resolveSettings, usageSettings, type UsageSettingsValues } from "./shared/budget.js";
import { usageBalanceRpc, usageSnapshotRpc, type UsageSnapshot } from "./shared/snapshot.js";
import { accountKeyFor, discoverAccounts } from "./server/accounts.js";
import { buildReport } from "./server/report.js";
import { sampleAccount } from "./server/sample.js";
import { buildSnapshot, isStale } from "./server/snapshot.js";
import { startSampler } from "./server/sampler.js";
import { LedgerFile } from "./server/state.js";

const LOG_PREFIX = "[paseo-deepseek-usage]";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(usageSettings);
  const ledger = new LedgerFile(LedgerFile.defaultPath(), {
    warn: (message, error) => console.warn(`${LOG_PREFIX} ${message}`, error ?? ""),
  });

  const readSettingsValues = async (): Promise<UsageSettingsValues> => {
    const state = await settings.read();
    return resolveSettings(state.status === "ready" ? state.values : {});
  };

  const fetchUsage = async (value: unknown): Promise<UsageReport> => {
    const input = usageInputSchema.parse(value);
    const result = await sampleAccount(input, { ledger });

    if (result.kind === "missing") {
      throw new Error("DeepSeek login store no longer exists");
    }
    if (result.kind === "rejected") {
      return unavailable({
        kind: "rejected",
        status: result.status,
        refreshedBy: input.store === "pi" ? "pi" : undefined,
      });
    }
    if (result.kind === "empty") {
      return unavailable({ kind: "no_quota", detail: "This DeepSeek account reports no balance" });
    }

    return buildReport({
      reading: result.reading,
      ledger: result.entry,
      settings: await readSettingsValues(),
      now: new Date(),
    });
  };

  /**
   * The figures both the settings screen and the sidebar row show. `refresh` is what separates
   * them: the settings screen may spend a balance request when its reading is stale, while the
   * sidebar row reads what the sampler already wrote and nothing else.
   */
  const readSnapshot = async ({ refresh }: { refresh: boolean }): Promise<UsageSnapshot> => {
    const settings = await readSettingsValues();
    const accounts = await discoverAccounts({ kind: "global" });
    if (accounts.length === 0) {
      return {
        status: "unavailable",
        reason: "No DeepSeek login was found in pi's store or in DEEPSEEK_API_KEY.",
      };
    }

    const input = usageInputSchema.parse(accounts[0].input);
    const key = accountKeyFor(input);
    let entry = (await ledger.read()).accounts[key];
    if (refresh && isStale(entry, new Date())) {
      try {
        const result = await sampleAccount(input, { ledger });
        if (result.kind === "ok") entry = result.entry;
      } catch (error) {
        // Keep showing the last known numbers rather than the screen going blank.
        console.warn(`${LOG_PREFIX} snapshot refresh failed`, error);
      }
    }
    return buildSnapshot({ entry, settings, now: new Date() });
  };

  server.handle(usageSnapshotRpc, () => readSnapshot({ refresh: true }));
  server.handle(usageBalanceRpc, () => readSnapshot({ refresh: false }));

  // Registered unconditionally. A duplicate id is rejected by the daemon, not by this call, so a
  // guard here could never fire; the id is chosen not to collide instead.
  server.registerUsageSource({
    id: USAGE_SOURCE_ID,
    label: USAGE_SOURCE_LABEL,
    icon: USAGE_SOURCE_ICON,
    input: usageInputSchema,
    discover: (scope) => discoverAccounts(scope),
    fetch: fetchUsage,
  });

  const stopSampler = startSampler({
    ledger,
    readSettings: readSettingsValues,
    warn: (message, error) => console.warn(`${LOG_PREFIX} ${message}`, error ?? ""),
  });

  return () => {
    stopSampler();
  };
}
