import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";

import { environmentCatalog } from "../../connection/catalog";
import { isElectron } from "../../env";
import { isMacPlatform } from "../../lib/utils";
import { primaryEnvironmentIdAtom } from "../../state/primaryEnvironment";
import { machineName } from "./brains.logic";

const DESKTOP = isElectron
  ? isMacPlatform(typeof navigator === "undefined" ? "" : navigator.platform)
    ? "mac"
    : "other"
  : null;

/** The window's own server, and how each server is named where a brain is on several. */
export function useMachineNames() {
  const primaryEnvironmentId = useAtomValue(primaryEnvironmentIdAtom);
  const catalog = useAtomValue(environmentCatalog.catalogValueAtom);
  const labels = new Map(
    [...catalog.entries].map(([environmentId, entry]) => [environmentId, entry.target.label]),
  );
  return {
    primaryEnvironmentId,
    machineOf: (environmentId: EnvironmentId) =>
      machineName(environmentId, { primaryEnvironmentId, desktop: DESKTOP, labels }),
    /** In the desktop app, whether the server runs on another machine than this one. */
    isElsewhere: (environmentId: EnvironmentId) =>
      DESKTOP !== null && environmentId !== primaryEnvironmentId,
  };
}
