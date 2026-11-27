import { useAtomValue } from "@effect/atom-react";
import type { UsageProviderKind, UsageSummaryInput } from "@t3tools/contracts";
import { formatCount, formatPercent, formatTokens, formatUsd } from "@t3tools/shared/usageFormat";
import { useLocale } from "gt-react";

import { cn } from "../../lib/utils";
import { usageByUseAtom, type UsageByUseRequest } from "../../state/majordome";
import type { EnvironmentUsageStatus } from "../../state/usage";
import { Skeleton } from "../ui/skeleton";
import { USAGE_USE_CUTS, usageUseRows, type UsageUseCut } from "./usage.logic";

/** The servers whose usage can be cut by use: the ones the summary beside it was read from. */
export function usageByUseRequest(
  environments: ReadonlyArray<EnvironmentUsageStatus>,
  window: UsageSummaryInput,
): UsageByUseRequest {
  return {
    environmentIds: environments
      .filter((environment) => environment.canReadDiagnostics && environment.isConnected)
      .map((environment) => environment.environmentId),
    window,
  };
}

/** The usage page's breakdown by routine or by topic: one row a use, adding up to the total. */
export function UsageByUse({
  cut,
  window,
  environments,
  hiddenProviders,
  metric,
}: {
  readonly cut: UsageUseCut;
  readonly window: UsageSummaryInput;
  readonly environments: ReadonlyArray<EnvironmentUsageStatus>;
  readonly hiddenProviders: ReadonlySet<UsageProviderKind>;
  readonly metric: "cost" | "tokens";
}) {
  const locale = useLocale();
  const request = usageByUseRequest(environments, window);
  const results = useAtomValue(usageByUseAtom(JSON.stringify(request)));
  const answers = results.flatMap((result) => (result._tag === "Success" ? [result.value] : []));
  const failed = results.flatMap((result, index) => {
    if (result._tag !== "Failure" || result.waiting) return [];
    const environmentId = request.environmentIds[index];
    const environment = environments.find((entry) => entry.environmentId === environmentId);
    return environment === undefined ? [] : [environment.label];
  });
  if (answers.length === 0 && results.some((result) => result.waiting)) {
    return <Skeleton className="h-44" />;
  }

  const rows = usageUseRows({ cut, answers, hiddenProviders, metric });
  const value = (row: (typeof rows)[number]) => (metric === "cost" ? row.costUsd : row.tokens);
  const peak = rows.reduce((most, row) => Math.max(most, value(row)), 0);
  const heading = USAGE_USE_CUTS.find((entry) => entry.value === cut)?.label;
  const waiting = results.some((result) => result.waiting);

  return (
    <div className="flex flex-col gap-2">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-right text-xs text-muted-foreground">
            <th className="w-full py-2 pl-2 text-left font-normal">{heading}</th>
            <th className="hidden py-2 pl-6 font-normal sm:table-cell">Runs</th>
            <th className="py-2 pl-6 font-normal">Cost</th>
            <th className="hidden py-2 pl-6 font-normal sm:table-cell">Share</th>
            <th className="py-2 pr-2 pl-6 font-normal">Tokens</th>
          </tr>
        </thead>
        <tbody className={cn("transition-opacity", waiting && "opacity-40 delay-150")}>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5} className="py-6 text-center text-muted-foreground">
                No activity in this window.
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const own = row.kind === cut;
              const hasBar = own && value(row) > 0 && peak > 0;
              return (
                <tr
                  key={row.key}
                  data-use={row.kind}
                  className="border-b border-border/50 text-right whitespace-nowrap text-muted-foreground tabular-nums"
                >
                  <td className="py-2.5 pl-2 text-left whitespace-normal">
                    <span className={cn(own && "text-foreground", !hasBar && "block py-1")}>
                      {row.label}
                    </span>
                    {hasBar ? (
                      <div aria-hidden className="mt-1.5 h-0.5 max-w-48">
                        <div
                          className="h-full rounded-full bg-foreground/60"
                          style={{ width: `max(0.5rem, ${(value(row) / peak) * 100}%)` }}
                        />
                      </div>
                    ) : null}
                  </td>
                  <td className="hidden py-2.5 pl-6 sm:table-cell">
                    {row.runs > 0 ? formatCount(row.runs, locale) : ""}
                  </td>
                  <td className={cn("py-2.5 pl-6", own && "text-foreground")}>
                    {formatUsd(row.costUsd, locale)}
                  </td>
                  <td className="hidden py-2.5 pl-6 sm:table-cell">
                    {row.share === null ? "" : formatPercent(row.share)}
                  </td>
                  <td className="py-2.5 pr-2 pl-6">{formatTokens(row.tokens)}</td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
      {failed.map((label) => (
        <p key={label} className="px-2 text-xs text-muted-foreground">
          Not available from {label}.
        </p>
      ))}
    </div>
  );
}
