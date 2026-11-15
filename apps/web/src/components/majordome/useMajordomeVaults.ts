import { useAtomValue } from "@effect/atom-react";
import type { MajordomeTopicsResult } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import * as Schema from "effect/Schema";

import { isMajordome } from "../../env";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useProjects } from "../../state/entities";
import { vaultTopicsAtom } from "../../state/majordome";
import { collectVaults, pickActiveVault } from "./topics.logic";

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
 * The open vaults, each with its topics, and the one the sidebar shows. A project is a vault when
 * its server says so; other projects never appear in Majordome.
 */
export function useMajordomeVaults() {
  const listed = useProjects();
  // T3 Code mode never asks servers about vaults.
  const projects = isMajordome
    ? listed.filter((project) => !project.isScratch && !project.archivedAt)
    : [];
  const results = useAtomValue(
    vaultTopicsAtom(JSON.stringify(projects.map((project) => [project.environmentId, project.id]))),
  );
  const { vaults, loading } = collectVaults(
    projects,
    // A server that cannot list topics has no vault Majordome can show.
    results.map((result) =>
      result._tag === "Failure" ? NOT_A_VAULT : AsyncResult.getOrElse(result, () => null),
    ),
  );
  const [chosenKey, setActiveVaultKey] = useLocalStorage(
    ACTIVE_VAULT_STORAGE_KEY,
    null,
    ActiveVaultKey,
  );
  return {
    vaults,
    loading,
    activeVault: pickActiveVault(vaults, chosenKey),
    setActiveVaultKey,
  };
}
