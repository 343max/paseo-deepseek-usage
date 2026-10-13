import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/**
 * What the settings screen shows above the limits. The usage panel gets its numbers from the
 * usage source, but a settings screen cannot read that, and the ledger lives in the daemon
 * subprocess, so it asks for a snapshot over plugin RPC.
 */
export const usageSnapshotRpc = defineRpc({
  name: "usage.snapshot",
  input: z.object({}).strict(),
  output: z.discriminatedUnion("status", [
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
  ]),
});

export type UsageSnapshot = z.infer<typeof usageSnapshotRpc.output>;
