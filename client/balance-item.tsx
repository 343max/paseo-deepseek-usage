import type { PluginPopoverProps, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { openExternalUrl, useRpc } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { Pressable, Text, View } from "react-native";
import { CONSOLE_USAGE_URL } from "../shared/account.js";
import { formatBalance } from "../shared/budget.js";
import { usageBalanceRpc } from "../shared/snapshot.js";
import { formatSampledAt, formatSpend } from "./format.js";

/**
 * How often the row re-reads the ledger while the app is in the foreground. It is a local read,
 * so this only decides how soon a new sampler reading shows up; the daemon sampler still owns
 * the reads that reach DeepSeek.
 */
const REFRESH_MS = 60_000;

const QUERY_KEY = ["paseo-deepseek-usage", "balance"] as const;

/**
 * The ledger's last known figures, without the API call the settings screen is allowed to make.
 * Shared by the row and its popover: same query key, so opening the popover reuses the read.
 */
function useBalanceFigures() {
  const readBalance = useRpc(usageBalanceRpc);
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => readBalance({}),
    staleTime: REFRESH_MS,
    refetchInterval: REFRESH_MS,
  });
}

function DetailRow({
  label,
  value,
  theme,
}: {
  label: string;
  value: string;
  theme: PluginPopoverProps["theme"];
}) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 16 }}>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13 }}>{label}</Text>
      <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "500" }}>{value}</Text>
    </View>
  );
}

function BalanceDetails({ theme }: PluginPopoverProps) {
  const query = useBalanceFigures();
  const data = query.data;
  return (
    <View style={{ gap: 10 }}>
      {data?.status === "ok" ? (
        <>
          <DetailRow
            label={`Balance (${data.currency})`}
            value={formatBalance(data.balance, data.currency)}
            theme={theme}
          />
          <DetailRow
            label="Today"
            value={formatSpend(data.daySpend, data.dailyBudget, data.currency)}
            theme={theme}
          />
          <DetailRow
            label="30 days"
            value={formatSpend(data.rollingSpend, data.rollingBudget, data.currency)}
            theme={theme}
          />
          <DetailRow
            label="Last read"
            value={formatSampledAt(data.sampledAt)}
            theme={theme}
          />
        </>
      ) : (
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13 }}>
          {data?.status === "unavailable"
            ? data.reason
            : query.error
              ? String(query.error)
              : "Reading your balance..."}
        </Text>
      )}
      <Pressable
        accessibilityRole="link"
        accessibilityLabel="Open the DeepSeek usage page"
        onPress={() => void openExternalUrl(CONSOLE_USAGE_URL)}
      >
        <Text style={{ color: theme.colors.accent, fontSize: 13 }}>Open the DeepSeek usage page</Text>
      </Pressable>
    </View>
  );
}

/**
 * The footer row. It shows the balance itself rather than a label, so the figure is what the row
 * announces; the item's registered title still names it in Settings > Sidebar.
 */
export function BalanceSidebarItem({ openPopover }: PluginSidebarItemProps) {
  const query = useBalanceFigures();
  const data = query.data;
  const label =
    data?.status === "ok"
      ? formatBalance(data.balance, data.currency)
      : data?.status === "unavailable"
        ? "Balance unavailable"
        : "Balance";
  return <SidebarRow icon="Wallet" label={label} onPress={() => openPopover(BalanceDetails)} />;
}
