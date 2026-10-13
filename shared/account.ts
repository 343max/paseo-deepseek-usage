import { z } from "zod";

/**
 * An opaque locator for a DeepSeek credential store.
 *
 * The credential itself never travels through this schema: `locator` names a store (a file
 * path) or an environment variable that holds the key. Paseo only validates and forwards it.
 */
export const usageInputSchema = z
  .object({
    store: z.enum(["pi", "env"]),
    locator: z.string().min(1),
  })
  .strict();

export type UsageInput = z.infer<typeof usageInputSchema>;

/**
 * The usage source id. Deliberately not the bare vendor name: the daemon rejects a duplicate
 * source id by failing whichever plugin registers it second, so `deepseek` would break this
 * plugin the moment a bundled DeepSeek source, or another plugin, claimed it. Saved pins
 * reference this id, so treat it as permanent. Users only ever see the label.
 */
export const USAGE_SOURCE_ID = "deepseek-usage";
export const USAGE_SOURCE_LABEL = "DeepSeek";
export const USAGE_SOURCE_ICON = "icon.svg";

/** Read only when pi's own login store has no DeepSeek key. */
export const ENV_LOCATOR = "DEEPSEEK_API_KEY";

/** DeepSeek's balance endpoint. The only account endpoint an API key can reach. */
export const BALANCE_URL = "https://api.deepseek.com/user/balance";

/**
 * DeepSeek's usage console. Linked from the settings screen and the command center; this
 * plugin never fetches it, because the console rejects API keys (code 40003) and only
 * accepts a browser session token.
 */
export const CONSOLE_USAGE_URL = "https://platform.deepseek.com/usage";
