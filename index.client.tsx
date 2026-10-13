import type { PluginClientContext } from "@getpaseo/plugin/client";
import { openExternalUrl } from "@getpaseo/plugin/client";
import { CONSOLE_USAGE_URL } from "./shared/account.js";
import { UsageSettingsScreen } from "./client/settings.js";

const SETTINGS_SCREEN_ID = "budgets";

export default function contribute(client: PluginClientContext) {
  client.addSettingsScreen({
    id: SETTINGS_SCREEN_ID,
    title: "DeepSeek usage",
    icon: "Gauge",
    Component: UsageSettingsScreen,
  });

  client.addCommandCenterItem({
    id: "deepseek-usage-limits",
    title: "DeepSeek usage limits",
    icon: "Gauge",
    keywords: ["deepseek", "budget", "limit", "usage"],
    context: "global",
    onSelect({ openSettings }) {
      openSettings(SETTINGS_SCREEN_ID);
    },
  });

  client.addCommandCenterItem({
    id: "deepseek-usage-page",
    title: "Open DeepSeek usage page",
    icon: "ExternalLink",
    keywords: ["deepseek", "balance", "top up", "usage"],
    context: "global",
    onSelect() {
      return openExternalUrl(CONSOLE_USAGE_URL);
    },
  });

  return () => {};
}
