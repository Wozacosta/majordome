import type { EnvironmentId, MajordomeRoutinesStatus } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";

import { routinesBlockedLine } from "./feed.logic";
import { StatusLine } from "./paper";

/** One line when a brain's routines can't run on their server, linking to that server's providers. */
export function RoutinesBlockedLine({
  environmentId,
  status,
  machine,
  label,
}: {
  /** The server that runs the routines. */
  readonly environmentId: EnvironmentId;
  readonly status: MajordomeRoutinesStatus | undefined;
  readonly machine: string;
  /** The brain the line is about, when several are listed. */
  readonly label: string | null;
}) {
  const line = routinesBlockedLine(status, machine);
  if (line === null) return null;
  return (
    <StatusLine tone={line.tone} className="py-2.5" data-routines-blocked={status?.reason}>
      {label === null ? "" : `${label}: `}
      {line.text}
      {line.tone === "warning" ? (
        <>
          {" "}
          <Link
            to="/settings/providers"
            search={{ environmentId }}
            className="rounded-sm underline underline-offset-2 outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          >
            Open Providers
          </Link>
        </>
      ) : null}
    </StatusLine>
  );
}
