import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useRpc, useSettings } from "@getpaseo/plugin/client";
import {
  ExternalLink,
  SettingsAction,
  SettingsCard,
  SettingsInput,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
} from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Text } from "react-native";
import { CONSOLE_USAGE_URL } from "../shared/account.js";
import {
  DEFAULT_SETTINGS,
  SAMPLE_INTERVAL_OPTIONS,
  formatBalance,
  parseBudgetInput,
  usageSettings,
  type UsageSettingsValues,
} from "../shared/budget.js";
import { usageSnapshotRpc } from "../shared/snapshot.js";
import { formatSampledAt, formatSpend } from "./format.js";

function formatBudget(value: number | null): string {
  return value === null ? "" : String(value);
}

function SnapshotRow({
  label,
  hint,
  value,
  color,
}: {
  label: string;
  hint?: string;
  value: string;
  color: string;
}) {
  return (
    <SettingsRow label={label} hint={hint}>
      <Text style={{ color, fontSize: 15, fontWeight: "500" }}>{value}</Text>
    </SettingsRow>
  );
}

export function UsageSettingsScreen({ theme }: PluginSurfaceProps) {
  const state = useSettings(usageSettings);
  const loaded: UsageSettingsValues | null = state.status === "ready" ? state.values : null;
  const revision =
    state.status === "ready" || state.status === "invalid" ? state.revision : null;

  const snapshot = useRpc(usageSnapshotRpc);
  // Keyed by revision, so saving a new limit refreshes the figures next to it.
  const query = useQuery({
    queryKey: ["paseo-deepseek-usage", "snapshot", revision],
    queryFn: () => snapshot({}),
    staleTime: 30_000,
  });
  const data = query.data;

  const [daily, setDaily] = useState("");
  const [rolling, setRolling] = useState("");
  const [interval, setInterval] = useState<number>(DEFAULT_SETTINGS.sampleIntervalMinutes);
  const [errors, setErrors] = useState<{ daily?: string; rolling?: string }>({});
  const [notice, setNotice] = useState<string | null>(null);

  // The document revision is the only thing that changes these values from the outside.
  useEffect(() => {
    const values = loaded ?? DEFAULT_SETTINGS;
    setDaily(formatBudget(values.dailyBudget));
    setRolling(formatBudget(values.rollingBudget));
    setInterval(values.sampleIntervalMinutes);
    setErrors({});
    setNotice(null);
  }, [revision]);

  const current = loaded ?? DEFAULT_SETTINGS;
  const dirty =
    loaded === null ||
    daily !== formatBudget(current.dailyBudget) ||
    rolling !== formatBudget(current.rollingBudget) ||
    interval !== current.sampleIntervalMinutes;

  const save = async () => {
    const dailyResult = parseBudgetInput(daily);
    const rollingResult = parseBudgetInput(rolling);
    const nextErrors: { daily?: string; rolling?: string } = {};
    if ("error" in dailyResult) nextErrors.daily = dailyResult.error;
    if ("error" in rollingResult) nextErrors.rolling = rollingResult.error;
    setErrors(nextErrors);
    if ("error" in dailyResult || "error" in rollingResult) return;
    if (state.status !== "ready" && state.status !== "invalid") return;

    const saved = await state.save(
      {
        dailyBudget: dailyResult.value,
        rollingBudget: rollingResult.value,
        sampleIntervalMinutes: interval,
      },
      state.revision,
    );
    setNotice(saved ? "Saved" : "Changed on another client. These are its values now.");
  };

  const statusHint =
    state.status === "error"
      ? state.error
      : (notice ??
        (dirty
          ? "Unsaved changes. Limits are what the sidebar shows."
          : "Limits are amounts in your DeepSeek wallet's currency."));

  // The wallet decides the unit; USD until a reading says otherwise.
  const currency = data?.status === "ok" ? data.currency : "USD";
  const unit = `(${currency})`;

  return (
    <>
      <SettingsSection title="Balance">
        <SettingsCard>
          {data?.status === "ok" ? (
            <>
              <SnapshotRow
                label={`Balance (${data.currency})`}
                hint={`Last read at ${formatSampledAt(data.sampledAt)}`}
                value={formatBalance(data.balance, data.currency)}
                color={theme.colors.foreground}
              />
              <SnapshotRow
                label="Today"
                value={formatSpend(data.daySpend, data.dailyBudget, data.currency)}
                color={theme.colors.foreground}
              />
              <SnapshotRow
                label="30 days"
                value={formatSpend(data.rollingSpend, data.rollingBudget, data.currency)}
                color={theme.colors.foreground}
              />
            </>
          ) : (
            <SettingsRow
              label="Balance"
              hint={data?.status === "unavailable" ? data.reason : undefined}
              error={query.error ? String(query.error) : null}
            >
              <Text style={{ color: theme.colors.foregroundMuted, fontSize: 15 }}>
                {query.isPending ? "Reading..." : "--"}
              </Text>
            </SettingsRow>
          )}
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Limits">
        <SettingsCard>
          <SettingsInput
            key={`daily-${revision}`}
            label={`Daily limit ${unit}`}
            hint="Spend since midnight, as a percent in the sidebar. Resets at your midnight."
            placeholder="No limit"
            initialValue={daily}
            onChangeText={setDaily}
            error={errors.daily ?? null}
          />
          <SettingsInput
            key={`rolling-${revision}`}
            label={`30 day limit ${unit}`}
            hint="Rolling window: the last 30 days, today included. It has no reset date."
            placeholder="No limit"
            initialValue={rolling}
            onChangeText={setRolling}
            error={errors.rolling ?? null}
          />
          <SettingsSelect
            label="Sample interval"
            hint="How often the balance is read to work out your spend."
            value={String(interval)}
            options={SAMPLE_INTERVAL_OPTIONS.map((minutes) => ({
              label: `${minutes} minutes`,
              value: String(minutes),
            }))}
            onValueChange={(value) => setInterval(Number(value))}
          />
          <SettingsAction
            label="Save limits"
            hint={statusHint}
            actionLabel={state.saving ? "Saving..." : "Save"}
            disabled={state.saving || !dirty}
            onPress={() => void save()}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="DeepSeek">
        <SettingsCard>
          <SettingsRow
            label="Usage page"
            hint="Opens platform.deepseek.com, which needs a signed-in browser session."
          >
            <ExternalLink href={CONSOLE_USAGE_URL} accessibilityLabel="Open the DeepSeek usage page">
              Open
            </ExternalLink>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
    </>
  );
}
