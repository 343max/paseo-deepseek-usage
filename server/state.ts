import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { BalanceReading } from "./deepseek.js";
import {
  applySample,
  emptyLedger,
  pruneLedger,
  type AccountLedger,
  type LedgerDocument,
} from "./ledger.js";

const dayBucketSchema = z
  .object({
    spend: z.number(),
    topUp: z.number(),
  })
  .strict();

const accountLedgerSchema = z
  .object({
    currency: z.string().min(1),
    lastBalance: z.number(),
    lastSampleAt: z.string(),
    firstSampleAt: z.string(),
    dayKey: z.string(),
    daySince: z.string(),
    days: z.record(z.string(), dayBucketSchema),
  })
  .strict();

const documentSchema = z
  .object({
    version: z.literal(2),
    accounts: z.record(z.string(), accountLedgerSchema),
  })
  .strict();

/**
 * v1 kept a calendar-month counter next to the day counter. v2 stores one bucket per local
 * day so the budget can roll; the day counter it already had carries over. Fields are picked
 * explicitly, so the v1-only month counters cannot leak into a document the v2 schema rejects.
 */
function migrateDocument(raw: unknown): unknown {
  const document = raw as {
    version?: unknown;
    accounts?: Record<string, Record<string, unknown>>;
  };
  if (document?.version !== 1) return raw;

  const accounts: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(document.accounts ?? {})) {
    const { currency, lastBalance, lastSampleAt, firstSampleAt, dayKey, daySince, daySpend, dayTopUp } =
      value;
    if (typeof dayKey !== "string") continue;
    accounts[key] = {
      currency,
      lastBalance,
      lastSampleAt,
      firstSampleAt,
      dayKey,
      daySince,
      days: {
        [dayKey]: {
          spend: typeof daySpend === "number" ? daySpend : 0,
          topUp: typeof dayTopUp === "number" ? dayTopUp : 0,
        },
      },
    };
  }
  return { version: 2, accounts };
}

export interface LedgerFileOptions {
  warn?: (message: string, error?: unknown) => void;
}

/**
 * The ledger on disk. The plugin subprocess is the only writer, and every mutation goes
 * through one queue so a sampler tick and a usage fetch cannot interleave a read-modify-write.
 */
export class LedgerFile {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    readonly path: string,
    private readonly options: LedgerFileOptions = {},
  ) {}

  /**
   * State lives outside the daemon home on purpose, so reinstalling the plugin or moving the
   * daemon does not reset the counters. `PASEO_DEEPSEEK_USAGE_STATE_DIR` overrides it.
   */
  static defaultPath(env: NodeJS.ProcessEnv = process.env): string {
    const override = env.PASEO_DEEPSEEK_USAGE_STATE_DIR?.trim();
    const base = override
      ? override
      : join(
          env.XDG_STATE_HOME?.trim() || join(env.HOME || homedir(), ".local", "state"),
          "paseo-deepseek-usage",
        );
    return join(base, "ledger.json");
  }

  async read(): Promise<LedgerDocument> {
    let raw: string;
    try {
      raw = await readFile(this.path, "utf8");
    } catch {
      return emptyLedger();
    }
    try {
      return documentSchema.parse(migrateDocument(JSON.parse(raw)));
    } catch (error) {
      // A damaged ledger must not cost the user their balance reading; start over.
      this.options.warn?.("Discarding an unreadable DeepSeek ledger", error);
      return emptyLedger();
    }
  }

  async sample(accountKey: string, reading: BalanceReading, now: Date): Promise<AccountLedger> {
    const task = this.queue.then(async () => {
      const document = await this.read();
      const entry = applySample(document.accounts[accountKey], reading, now);
      const next = pruneLedger(
        { version: 2, accounts: { ...document.accounts, [accountKey]: entry } },
        now,
      );
      await this.write(next);
      return entry;
    });
    this.queue = task.catch(() => undefined);
    return task;
  }

  private async write(document: LedgerDocument): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 });
      await rename(temporary, this.path);
    } finally {
      await rm(temporary, { force: true });
    }
  }
}
