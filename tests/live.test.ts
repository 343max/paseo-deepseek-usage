import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { UsageReportSchema } from "@getpaseo/protocol/messages";
import { usageInputSchema } from "../shared/account.js";
import { DEFAULT_SETTINGS, resolveSettings } from "../shared/budget.js";
import { discoverAccounts } from "../server/accounts.js";
import { readBalance } from "../server/deepseek.js";
import { buildReport } from "../server/report.js";
import { sampleAccount } from "../server/sample.js";
import { LedgerFile } from "../server/state.js";
import { readApiKey } from "../server/store.js";

/**
 * Opt-in check against the real DeepSeek API and the real login on this machine:
 *
 *   DEEPSEEK_LIVE=1 npx vitest run tests/live.test.ts
 *
 * It never touches the normal ledger; `PASEO_DEEPSEEK_USAGE_STATE_DIR` is overridden first.
 */
const enabled = process.env.DEEPSEEK_LIVE === "1";

describe.skipIf(!enabled)("live DeepSeek account", () => {
  let directory: string | undefined;

  afterAll(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("discovers a login, reads a balance, and builds a report", async () => {
    const accounts = await discoverAccounts({ kind: "global" });
    expect(accounts).toHaveLength(1);

    directory = await mkdtemp(join(tmpdir(), "deepseek-live-"));
    const ledger = new LedgerFile(join(directory, "ledger.json"));
    const result = await sampleAccount(accounts[0].input as never, { ledger });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    const report = buildReport({
      reading: result.reading,
      ledger: result.entry,
      settings: { ...DEFAULT_SETTINGS, dailyBudget: 5, rollingBudget: 50 },
      now: new Date(),
    });
    console.log(JSON.stringify(report, null, 2));
    expect(report.status).toBe("available");
    expect(() => UsageReportSchema.parse(report)).not.toThrow();
  }, 30_000);

  it("reads the state this daemon actually has, so the card can be compared", async () => {
    const document = await new LedgerFile(LedgerFile.defaultPath()).read();
    const key = Object.keys(document.accounts)[0];
    expect(key, "no samples recorded yet").toBeDefined();

    const settingsPath = join(
      process.env.HOME ?? "",
      ".paseo",
      "plugin-settings",
      "paseo-deepseek-usage",
      "budgets.json",
    );
    const settings = await readFile(settingsPath, "utf8")
      .then((raw) => resolveSettings(JSON.parse(raw).values))
      .catch(() => DEFAULT_SETTINGS);

    const reading = await readBalance((await rawApiKey()) ?? "");
    expect(reading.kind).toBe("ok");
    if (reading.kind !== "ok") return;

    const report = buildReport({
      reading: reading.reading,
      ledger: document.accounts[key],
      settings,
      now: new Date(),
    });
    console.log(JSON.stringify({ settings, report }, null, 2));
    expect(report.status).toBe("available");
    expect(() => UsageReportSchema.parse(report)).not.toThrow();
  }, 30_000);

  async function rawApiKey(): Promise<string | null> {
    const accounts = await discoverAccounts({ kind: "global" });
    return readApiKey(usageInputSchema.parse(accounts[0].input));
  }
});
