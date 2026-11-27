import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, UsageProviderKind } from "@t3tools/contracts";
import {
  collectLimitAccounts,
  collectLimitPools,
  displayLimitWindows,
} from "@t3tools/shared/usageLimits";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { environmentPresentations } from "../../state/presentation";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { PROVIDER_PRESENTATION } from "../usage/usageProviders";
import { usageGauges } from "./usage.logic";

const RADIUS = 6;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function Ring({ usedPercent }: { readonly usedPercent: number }) {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className="size-4 shrink-0 -rotate-90">
      <circle
        cx="8"
        cy="8"
        r={RADIUS}
        fill="none"
        strokeWidth="2.5"
        className="stroke-foreground/15"
      />
      <circle
        cx="8"
        cy="8"
        r={RADIUS}
        fill="none"
        strokeWidth="2.5"
        strokeLinecap="round"
        stroke="currentColor"
        strokeDasharray={`${(usedPercent / 100) * CIRCUMFERENCE} ${CIRCUMFERENCE}`}
      />
    </svg>
  );
}

/**
 * How much of each plan's limits is used, as the providers last reported it: the session and the
 * week of each signed-in plan. Nothing when no plan reports a limit. Opens the page's Limits view.
 */
export function UsageLimitGauges({
  selectedEnvironmentIds,
  hiddenProviders,
  onOpenLimits,
}: {
  readonly selectedEnvironmentIds: ReadonlySet<EnvironmentId> | null;
  readonly hiddenProviders: ReadonlySet<UsageProviderKind>;
  readonly onOpenLimits: () => void;
}) {
  const presentations = useAtomValue(environmentPresentations.presentationsWithProvidersAtom);
  // Read once: the gauges show percentages, which do not move with the clock.
  const [now] = useState(() => Date.now());
  const selected = new Map(
    [...presentations].filter(
      ([environmentId]) =>
        selectedEnvironmentIds === null || selectedEnvironmentIds.has(environmentId),
    ),
  );
  const hiddenDrivers = new Set<string>(
    [...hiddenProviders].map((provider) => PROVIDER_PRESENTATION[provider].driverKind),
  );
  const plans = collectLimitPools(collectLimitAccounts(selected), now).flatMap((pool) => {
    if (hiddenDrivers.has(pool.driver)) return [];
    const gauges = usageGauges(displayLimitWindows(pool));
    return gauges.length === 0 ? [] : [{ driver: pool.driver, gauges }];
  });
  if (plans.length === 0) return null;

  return (
    <button
      type="button"
      onClick={onOpenLimits}
      aria-label="Plan limits"
      className="-mx-1 flex flex-wrap items-center gap-x-4 gap-y-1.5 self-start rounded-md px-1 py-0.5 text-left text-xs outline-hidden hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      {plans.map((plan) => (
        <span key={plan.driver} className="flex items-center gap-x-3">
          {plans.length > 1 ? (
            <ProviderInstanceIcon
              driverKind={plan.driver}
              displayName={plan.driver}
              iconClassName="size-3.5"
            />
          ) : null}
          {plan.gauges.map((gauge) => (
            <span
              key={gauge.key}
              data-gauge={gauge.label}
              className={cn(
                "flex items-center gap-1.5 tabular-nums",
                gauge.usedPercent >= 90 ? "text-destructive-foreground" : "text-foreground",
              )}
            >
              <Ring usedPercent={gauge.usedPercent} />
              {Math.round(gauge.usedPercent)}%
              <span className="text-muted-foreground">{gauge.label}</span>
            </span>
          ))}
        </span>
      ))}
    </button>
  );
}
