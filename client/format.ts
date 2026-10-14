import { formatAmount } from "../shared/budget.js";

/** "0.25 of 2.00", with the wallet's own currency on both sides. */
export function formatSpend(spend: number, budget: number | null, currency: string): string {
  if (budget === null) return `${formatAmount(spend, currency)} spent`;
  return `${formatAmount(spend, currency)} of ${formatAmount(budget, currency)}`;
}

/** The clock time of a reading, or "unknown" when the daemon stored something unparsable. */
export function formatSampledAt(sampledAt: string): string {
  const date = new Date(sampledAt);
  if (Number.isNaN(date.getTime())) return "unknown";
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}
