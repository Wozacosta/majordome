import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import { AsyncResult } from "effect/reactivity";
import { ArrowLeftIcon } from "lucide-react";

import { isElectron } from "../../env";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useProjects } from "../../state/entities";
import { vaultBackupStatusesAtom } from "../../state/majordome";
import FileBrowserPanel from "../files/FileBrowserPanel";
import { FileExplorerPane } from "../files/FileExplorerPane";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SidebarInset } from "../ui/sidebar";
import { Skeleton } from "../ui/skeleton";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { NotePreview } from "./NotePreview";
import {
  isHiddenVaultPath,
  notesLink,
  type NotesSearch,
  type NotesVault,
  selectNotesVault,
} from "./notes.logic";

const vaultKey = (vault: NotesVault) => `${vault.environmentId}:${vault.projectId}`;

/** The vaults among the open projects: those with a `.majordome` folder, as their backup status says. */
function useNotesVaults(): {
  readonly vaults: ReadonlyArray<NotesVault>;
  readonly loading: boolean;
} {
  const projects = useProjects().filter((project) => !project.isScratch && !project.archivedAt);
  const results = useAtomValue(
    vaultBackupStatusesAtom(
      JSON.stringify(projects.map((project) => [project.environmentId, project.id])),
    ),
  );
  const vaults: Array<NotesVault> = [];
  let loading = false;
  projects.forEach((project, index) => {
    const result = results[index];
    if (result === undefined || result._tag === "Initial") loading = true;
    if (AsyncResult.getOrElse(result ?? AsyncResult.initial(), () => null)?.isVault) {
      vaults.push({
        environmentId: project.environmentId,
        projectId: project.id,
        title: project.title,
        workspaceRoot: project.workspaceRoot,
      });
    }
  });
  return { vaults, loading };
}

/** A read-only view of the notes folder: its folders and files, and the note picked from them. */
export function NotesPage({ search }: { readonly search: NotesSearch }) {
  const navigate = useNavigate();
  const isPhone = useMediaQuery("max-md");
  const { vaults, loading } = useNotesVaults();
  const vault = selectNotesVault(vaults, {
    projectId: search.project,
    environmentId: search.environment,
  });
  const path =
    vault !== null && vault.projectId === search.project && search.path !== undefined
      ? search.path
      : null;

  const open = (next: { vault: NotesVault; path?: string | undefined }) =>
    void navigate({
      ...notesLink({
        projectId: next.vault.projectId,
        environmentId: vaults.length > 1 ? next.vault.environmentId : undefined,
        path: next.path,
      }),
    });

  const showNote = vault !== null && path !== null;
  const showTree = vault !== null && !(isPhone && showNote);
  const phoneNote = isPhone && vault !== null && path !== null ? { vault, path } : null;

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <WorkspacePageHeader electron={isElectron} className="border-b border-border">
          {phoneNote ? (
            <Button size="sm" variant="ghost" onClick={() => open({ vault: phoneNote.vault })}>
              <ArrowLeftIcon />
              Back
            </Button>
          ) : null}
          <h1 className="min-w-0 flex-1 truncate text-sm font-medium">
            {phoneNote ? noteTitle(phoneNote.path) : "Notes"}
          </h1>
          {vaults.length > 1 && vault !== null && phoneNote === null ? (
            <div className="min-w-0 [-webkit-app-region:no-drag]">
              <Select
                value={vaultKey(vault)}
                onValueChange={(key) => {
                  const next = vaults.find((candidate) => vaultKey(candidate) === key);
                  if (next) open({ vault: next });
                }}
              >
                <SelectTrigger size="sm" aria-label="Notes folder">
                  <SelectValue>{vault.title}</SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {vaults.map((candidate) => (
                    <SelectItem key={vaultKey(candidate)} value={vaultKey(candidate)}>
                      {candidate.title}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
          ) : null}
        </WorkspacePageHeader>

        {vault === null ? (
          loading ? (
            <div className="p-5">
              <Skeleton className="h-40 w-full" />
            </div>
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>No notes folder yet</EmptyTitle>
                <EmptyDescription>
                  Open your notes folder in Majordome, and its notes show up here.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )
        ) : (
          <div className="flex min-h-0 flex-1 overflow-hidden" data-notes-vault={vault.title}>
            {path !== null ? (
              <NotePreview
                key={`${vaultKey(vault)}:${path}`}
                vault={vault}
                path={path}
                showTitle={!isPhone}
                onOpenNote={(target) => open({ vault, path: target })}
              />
            ) : null}
            {showTree ? (
              <FileExplorerPane
                resizable={showNote}
                storageKey="majordome.notesTreeWidth"
                defaultWidth={288}
                resizeLabel="Resize the folder list"
              >
                <FileBrowserPanel
                  key={vaultKey(vault)}
                  environmentId={vault.environmentId}
                  cwd={vault.workspaceRoot}
                  projectName={vault.title}
                  selectedPath={path}
                  selectedPathRevealId={0}
                  onOpenFile={(target) => {
                    if (target !== path) open({ vault, path: target });
                  }}
                  workspaceMutationId={null}
                  hidePath={isHiddenVaultPath}
                />
              </FileExplorerPane>
            ) : null}
          </div>
        )}
      </div>
    </SidebarInset>
  );
}

function noteTitle(path: string): string {
  const name = path.split("/").at(-1) ?? path;
  return name.replace(/\.(?:md|markdown)$/i, "");
}
