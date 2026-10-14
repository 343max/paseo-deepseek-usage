import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/**
 * The figures the settings screen shows above the limits and the sidebar row shows in one
 * line. The usage panel gets its numbers from the usage source, but neither a settings screen
 * nor a sidebar row can read that, and the ledger lives in the daemon subprocess, so both ask
 * for a snapshot over plugin RPC.
 */
const usageFigures = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    currency: z.string().min(1),
    balance: z.number(),
    daySpend: z.number(),
    rollingSpend: z.number(),
    dailyBudget: z.number().nullable(),
    rollingBudget: z.number().nullable(),
    sampledAt: z.string(),
  }),
  z.object({
    status: z.literal("unavailable"),
    reason: z.string(),
  }),
]);

const noInput = z.object({}).strict();

/**
 * What the settings screen asks for: the ledger's numbers, refreshed from the API when the
 * last reading is more than a minute old, so leaving the screen open keeps them current.
 */
export const usageSnapshotRpc = defineRpc({
  name: "usage.snapshot",
  input: noInput,
  output: usageFigures,
});

/**
 * The sidebar row's view, which reads the ledger and never the API. The row is on screen the
 * whole time the app is open, so a read of its own would put the balance request on the
 * sidebar's clock instead of the sampler's; the background sampler stays the only thing that
 * spends a request on a schedule.
 */
export const usageBalanceRpc = defineRpc({
  name: "usage.balance",
  input: noInput,
  output: usageFigures,
});

export type UsageSnapshot = z.infer<typeof usageFigures>;
