import { useState } from "react";

import { useEnvironments } from "../../state/environments";
import { AddEnvironmentDialog } from "../settings/AddEnvironmentDialog";

/** Adds a server that exists already to this app, from its address and a one-time code. */
export function AddComputerButton() {
  const { environments } = useEnvironments();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <AddEnvironmentDialog
      open={open}
      routeTarget={null}
      error={error}
      savedEnvironments={environments.filter(
        (environment) => environment.entry.target._tag !== "PrimaryConnectionTarget",
      )}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
      onErrorChange={setError}
    />
  );
}
