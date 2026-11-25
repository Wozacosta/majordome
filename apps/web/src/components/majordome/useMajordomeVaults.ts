import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, MajordomeTopicsResult } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import * as Schema from "effect/Schema";

import { isMajordome } from "../../env";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useProjects } from "../../state/entities";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { vaultBackupStatusesAtom, vaultTopicsAtom } from "../../state/majordome";
import { statusBrainId } from "./brains.logic";
import { conversationHomesAtom } from "./conversationHome";
import { usePendingSideChats } from "./pendingSideChats";
import {
  collectVaults,
  mergeVaultCopies,
  pickActiveVault,
  withPendingSideChats,
} from "./topics.logic";

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
 * is a vault when its server says so. `copies` keeps every server's copy apart. A vault's
 * `environmentId` is where its notes are read and changed; its `home`, where its chats are kept.
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
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const pendingSideChats = usePendingSideChats();
  const { vaults: copies, loading } = collectVaults(
    projects,
    // A server that cannot list topics has no vault Majordome can show.
    results.map((result, index) => {
      if (result._tag === "Failure") return NOT_A_VAULT;
      const topics = AsyncResult.getOrElse(result, () => null);
      const project = projects[index];
      return topics === null || project === undefined
        ? topics
        : withPendingSideChats(
            topics,
            pendingSideChats.filter(
              (chat) =>
                chat.environmentId === project.environmentId && chat.projectId === project.id,
            ),
          );
    }),
    statuses.map(statusBrainId),
  );
  const vaults = mergeVaultCopies(
    copies,
    primaryEnvironmentId,
    useAtomValue(conversationHomesAtom),
  );
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

/**
 * The computer that answers the shown notes folder's chats, so the one whose saved keys the
 * assistant can use. Null until it is known, and outside Majordome.
 */
export function useAssistantEnvironmentId(): EnvironmentId | null {
  const home = useMajordomeVaults().activeVault?.home;
  return home?.kind === "ready" ? home.environmentId : null;
}
