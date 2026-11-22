import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import { AsyncResult, Atom } from "effect/reactivity";
import { ArrowLeftIcon } from "lucide-react";
import { useState } from "react";

import { isElectron } from "../../env";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { cn } from "../../lib/utils";
import { useProjects } from "../../state/entities";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { majordomeEnvironment, vaultBackupStatusesAtom } from "../../state/majordome";
import FileBrowserPanel from "../files/FileBrowserPanel";
import { FileExplorerPane } from "../files/FileExplorerPane";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SidebarInset } from "../ui/sidebar";
import { Skeleton } from "../ui/skeleton";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { type Brain, brainKey, groupBrains } from "./brains.logic";
import { NotePreview } from "./NotePreview";
import { NotesSearchField, NotesSearchResults } from "./NotesSearch";
import { notesSearchCopies, notesSearchQuery } from "./notesSearch.logic";
import { PageTitle, READING_MEASURE_CLASS } from "./paper";
import {
  isHiddenVaultPath,
  notesLink,
  type NotesSearch,
  type NotesVault,
  selectNotesVault,
  NOTES_RETURN_SCREENS,
} from "./notes.logic";

const vaultKey = (vault: NotesVault) => `${vault.environmentId}:${vault.projectId}`;

/**
 * The vaults among the open projects: those with a `.majordome` folder, as their backup status
 * says. `vaults` holds every server's copy, so a link to any of them opens; `brains` holds the one
 * copy of each brain the switcher offers.
 */
function useNotesVaults(): {
  readonly vaults: ReadonlyArray<NotesVault>;
  readonly brains: ReadonlyArray<Brain<NotesVault>>;
  readonly loading: boolean;
} {
  const projects = useProjects().filter((project) => !project.isScratch && !project.archivedAt);
  const results = useAtomValue(
    vaultBackupStatusesAtom(
      JSON.stringify(projects.map((project) => [project.environmentId, project.id])),
    ),
  );
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const vaults: Array<NotesVault> = [];
  let loading = false;
  projects.forEach((project, index) => {
    const result = results[index];
    if (result === undefined || result._tag === "Initial") loading = true;
    const status = AsyncResult.getOrElse(result ?? AsyncResult.initial(), () => null);
    if (status?.isVault) {
      vaults.push({
        environmentId: project.environmentId,
        projectId: project.id,
        title: project.title,
        workspaceRoot: project.workspaceRoot,
        brainId: status.brainId,
      });
    }
  });
  return { vaults, brains: groupBrains(vaults, primaryEnvironmentId), loading };
}

const NO_VAULT_CHANGES = Atom.make(AsyncResult.initial<number, never>(false)).pipe(
  Atom.withLabel("majordome:notes-vault-changes:none"),
);

/** Moves on whenever the vault's notes change on disk, as its server sees them. */
function useVaultRevision(vault: NotesVault | null): string | null {
  const result = useAtomValue(
    vault === null
      ? NO_VAULT_CHANGES
      : majordomeEnvironment.vaultChanges({
          environmentId: vault.environmentId,
          input: { projectId: vault.projectId },
        }),
  );
  const revision = AsyncResult.getOrElse(result, () => null);
  return revision === null ? null : String(revision);
}

/** The notes folder: its folders and files, and the note picked from them, written in place. */
export function NotesPage({ search }: { readonly search: NotesSearch }) {
  const navigate = useNavigate();
  const isPhone = useMediaQuery("max-md");
  const { vaults, brains, loading } = useNotesVaults();
  // Each brain's own-server copy first, so a plain link opens that one.
  const vault = selectNotesVault(
    brains.flatMap((brain) => brain.copies),
    {
      projectId: search.project,
      environmentId: search.environment,
    },
  );
  const path =
    vault !== null && vault.projectId === search.project && search.path !== undefined
      ? search.path
      : null;
  const revision = useVaultRevision(vault);
  // Kept here, above the list, so the results are still there after a note is opened and closed.
  const [searchText, setSearchText] = useState("");
  const searching = notesSearchQuery(searchText) !== "";

  const linkTo = (next: { vault: NotesVault; path?: string | undefined }) =>
    notesLink({
      projectId: next.vault.projectId,
      environmentId: vaults.length > 1 ? next.vault.environmentId : undefined,
      path: next.path,
      from: search.from,
    });
  const open = (next: { vault: NotesVault; path?: string | undefined }) =>
    void navigate(linkTo(next));

  const showNote = vault !== null && path !== null;
  const returnScreen = search.from === undefined ? null : NOTES_RETURN_SCREENS[search.from];
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
          ) : returnScreen ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void navigate({ to: returnScreen.to })}
            >
              <ArrowLeftIcon />
              {returnScreen.label}
            </Button>
          ) : null}
          {/* Without a note open, the page's own title below is the heading. */}
          {showNote ? (
            <h1 className="min-w-0 flex-1 truncate text-sm font-medium">
              {phoneNote ? noteTitle(phoneNote.path) : "Notes"}
            </h1>
          ) : (
            <div className="min-w-0 flex-1" />
          )}
          {brains.length > 1 && vault !== null && phoneNote === null ? (
            <div className="min-w-0 [-webkit-app-region:no-drag]">
              <Select
                value={brainKey(vault)}
                onValueChange={(key) => {
                  const next = brains.find((brain) => brain.key === key);
                  if (next) open({ vault: next.copies[0] });
                }}
              >
                <SelectTrigger size="sm" aria-label="Notes folder">
                  <SelectValue>{vault.title}</SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {brains.map((brain) => (
                    <SelectItem key={brain.key} value={brain.key}>
                      {brain.copies[0].title}
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
                revision={revision}
                showTitle={!isPhone}
                editable
                noteLink={(target) => linkTo({ vault, path: target })}
              />
            ) : null}
            {showTree ? (
              <FileExplorerPane
                resizable={showNote}
                storageKey="majordome.notesTreeWidth"
                defaultWidth={288}
                resizeLabel="Resize the folder list"
              >
                {/* One wrapper in both layouts, so opening a note keeps the list's open folders. */}
                <div
                  className={cn(
                    "flex min-h-0 min-w-0 flex-1 flex-col",
                    !showNote && "mx-auto pt-6",
                    !showNote && READING_MEASURE_CLASS,
                  )}
                >
                  {showNote ? null : <PageTitle className="mb-3 px-3">Notes</PageTitle>}
                  <div className={cn("px-3 pb-2", showNote && "pt-2")}>
                    <NotesSearchField value={searchText} onChange={setSearchText} />
                  </div>
                  <NotesSearchResults
                    key={brainKey(vault)}
                    copies={notesSearchCopies(brains, vault)}
                    typed={searchText}
                    selectedPath={path}
                    linkTo={(copy, target) => linkTo({ vault: copy, path: target })}
                  />
                  {/* Hidden, not unmounted, while results show: the list keeps its open folders. */}
                  <div
                    className={cn("flex min-h-0 min-w-0 flex-1 flex-col", searching && "hidden")}
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
                      workspaceMutationId={revision}
                      hidePath={isHiddenVaultPath}
                    />
                  </div>
                </div>
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
