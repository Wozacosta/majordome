import { useAtomValue } from "@effect/atom-react";
import type { MajordomeTopicsResult } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import * as Schema from "effect/Schema";

import { isMajordome } from "../../env";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useProjects } from "../../state/entities";
import { usePrimaryEnvironmentId } from "../../state/environments";
import {
  vaultBackupStatusesAtom,
  vaultHistoriesAtom,
  vaultTopicsAtom,
} from "../../state/majordome";
import { statusBrainId } from "./brains.logic";
import { collectVaults, mergeVaultCopies, pickActiveVault } from "./topics.logic";

const ACTIVE_VAULT_STORAGE_KEY = "majordome.activeVault";
const ActiveVaultKey = Schema.NullOr(Schema.String);

const NOT_A_VAULT: MajordomeTopicsResult = {
  isVault: false,
  topics: [],
  suggestions: [],
  folders: [],
  projectsFolder: "",
};

/**
 * The open vaults, one per brain, each with its topics, and the one the sidebar shows. A project
 * is a vault when its server says so; other projects never appear in Majordome. `copies` keeps
 * every server's copy apart, for what belongs to one server (its chats).
 */
export function useMajordomeVaults() {
  const listed = useProjects();
  // T3 Code mode never asks servers about vaults.
  const projects = isMajordome
    ? listed.filter((project) => !project.isScratch && !project.archivedAt)
    : [];
  const key = JSON.stringify(projects.map((project) => [project.environmentId, project.id]));
  const results = useAtomValue(vaultTopicsAtom(key));
  // The backup status says which brain each copy is.
  const statuses = useAtomValue(vaultBackupStatusesAtom(key));
  // The server that runs a brain's routines keeps its topics' conversations.
  const histories = useAtomValue(vaultHistoriesAtom(key));
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const { vaults: copies, loading } = collectVaults(
    projects,
    // A server that cannot list topics has no vault Majordome can show.
    results.map((result) =>
      result._tag === "Failure" ? NOT_A_VAULT : AsyncResult.getOrElse(result, () => null),
    ),
    statuses.map(statusBrainId),
    histories.map(
      (history) => AsyncResult.getOrElse(history, () => null)?.routinesRunner === "this-server",
    ),
  );
  const vaults = mergeVaultCopies(copies, primaryEnvironmentId);
  const [chosenKey, setActiveVaultKey] = useLocalStorage(
    ACTIVE_VAULT_STORAGE_KEY,
    null,
    ActiveVaultKey,
  );
  return {
    vaults,
    copies,
    loading,
    activeVault: pickActiveVault(vaults, chosenKey),
    setActiveVaultKey,
  };
}
