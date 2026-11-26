import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { AssetResource, EnvironmentId } from "@t3tools/contracts";
import { topicFileDate } from "@t3tools/shared/majordomeTopicFiles";
import { Link, useNavigate } from "@tanstack/react-router";
import { AsyncResult } from "effect/reactivity";
import {
  FolderIcon,
  LibraryIcon,
  MessageSquareIcon,
  NotebookTextIcon,
  SearchIcon,
} from "lucide-react";
import { type ReactNode, useState } from "react";

import { useAssetUrlState } from "../../assets/assetUrls";
import { isElectron } from "../../env";
import { useNowMinute } from "../../hooks/useNowMinute";
import { cn } from "../../lib/utils";
import { useRightPanelStore } from "../../rightPanelStore";
import { useProjects } from "../../state/entities";
import { majordomeEnvironment, vaultLibrariesAtom } from "../../state/majordome";
import { buildThreadRouteParams } from "../../threadRoutes";
import { ExpandedImageDialogHost, openExpandedImagePreview } from "../chat/ExpandedImageDialog";
import { Button } from "../ui/button";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { ScrollArea } from "../ui/scroll-area";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SidebarInset } from "../ui/sidebar";
import { Skeleton } from "../ui/skeleton";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import {
  LIBRARY_TYPE_LABELS,
  libraryBadge,
  type LibraryItem,
  libraryItems,
  type LibraryPlace,
  type LibraryType,
  libraryView,
  libraryWhere,
} from "./library.logic";
import { notesLink } from "./notes.logic";
import { LoadFailed, Muted, PageTitle } from "./paper";
import { TopicIconBadge } from "./TopicIcon";
import type { MajordomeVault, VaultTopic } from "./topics.logic";
import { useMajordomeVaults } from "./useMajordomeVaults";

/** The picture viewer is keyed by a chat; the Library's own key keeps a chat's from showing here. */
const LIBRARY_VIEWER_KEY = "majordome:library";
/** How many files are drawn at once; each picture among them asks its server for an address. */
const PAGE_SIZE = 60;

const TYPE_LABEL = new Map<LibraryType | "all", string>([["all", "All"], ...LIBRARY_TYPE_LABELS]);

const BADGE_TONE: Record<LibraryType, string> = {
  image: "bg-violet-500/15 text-violet-600 dark:bg-violet-400/15 dark:text-violet-300",
  document: "bg-rose-500/15 text-rose-600 dark:bg-rose-400/15 dark:text-rose-300",
  code: "bg-sky-500/15 text-sky-600 dark:bg-sky-400/15 dark:text-sky-300",
  spreadsheet: "bg-emerald-500/15 text-emerald-600 dark:bg-emerald-400/15 dark:text-emerald-300",
  media: "bg-amber-500/15 text-amber-600 dark:bg-amber-400/15 dark:text-amber-300",
  other: "bg-muted text-muted-foreground",
};

const FOCUS_RING =
  "outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

/** Everything kept in the notes folder that is not a note, and everything attached to a chat. */
export function LibraryPage() {
  const { activeVault, loading } = useMajordomeVaults();
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <WorkspacePageHeader electron={isElectron} className="border-b border-border" />
        {activeVault !== null ? (
          <VaultLibrary key={activeVault.key} vault={activeVault} />
        ) : loading ? null : (
          <NothingHere>No notes folder yet</NothingHere>
        )}
      </div>
      <ExpandedImageDialogHost threadKey={LIBRARY_VIEWER_KEY} />
    </SidebarInset>
  );
}

function NothingHere({ children }: { readonly children: ReactNode }) {
  return (
    <Empty size="compact">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <LibraryIcon />
        </EmptyMedia>
        <EmptyTitle>{children}</EmptyTitle>
      </EmptyHeader>
    </Empty>
  );
}

function VaultLibrary({ vault }: { readonly vault: MajordomeVault }) {
  const now = Date.parse(`${useNowMinute()}:00Z`);
  const projects = useProjects();
  // The shown copy first: it answers for the notes folder, the others for their chats.
  const copies = [
    { environmentId: vault.environmentId, projectId: vault.projectId },
    ...vault.copies.filter(
      (copy) => copy.environmentId !== vault.environmentId || copy.projectId !== vault.projectId,
    ),
  ];
  const results = useAtomValue(
    vaultLibrariesAtom(JSON.stringify(copies.map((copy) => [copy.environmentId, copy.projectId]))),
  );
  const retry = useAtomRefresh(
    majordomeEnvironment.library({
      environmentId: vault.environmentId,
      input: { projectId: vault.projectId },
    }),
  );
  const [query, setQuery] = useState("");
  const [place, setPlace] = useState<LibraryPlace>("all");
  const [type, setType] = useState<LibraryType | "all">("all");
  const [pages, setPages] = useState(1);

  const own = results[0];
  const answers = results.map((result) =>
    result === undefined ? null : AsyncResult.getOrElse(result, () => null),
  );
  if (answers[0] == null) {
    return (
      <Frame>
        {own?._tag === "Failure" ? (
          <LoadFailed className="mt-4" onRetry={retry}>
            Couldn't load your files.
          </LoadFailed>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-3 @lg/files:grid-cols-3" aria-hidden>
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="h-20 w-full" />
            ))}
          </div>
        )}
      </Frame>
    );
  }

  // A server that cannot be reached leaves its chats' files out; the rest still shows.
  const items = libraryItems(
    copies.flatMap((copy, index) => {
      const answer = answers[index];
      return answer == null ? [] : [{ ...copy, files: answer.files }];
    }),
    vault.topics,
  );
  const total = answers.reduce((sum, answer) => sum + (answer?.total ?? 0), 0);
  if (items.length === 0) return <NothingHere>No files yet</NothingHere>;

  const view = libraryView(items, vault.topics, { query, place, type });
  const shown = view.shown.slice(0, pages * PAGE_SIZE);
  const topicOf = (id: string | null) => vault.topics.find((topic) => topic.id === id);
  const placeName = (candidate: LibraryPlace) =>
    candidate === "all"
      ? "All files"
      : candidate === "none"
        ? "Not in a topic"
        : (topicOf(candidate.slice("topic:".length))?.title ?? "");
  const choose = (change: () => void) => {
    change();
    setPages(1);
  };
  const workspaceRootOf = (item: LibraryItem) =>
    projects.find(
      (project) => project.environmentId === item.environmentId && project.id === item.projectId,
    )?.workspaceRoot ?? null;

  return (
    <Frame
      filters={
        <div className="flex gap-2 @2xl/library:flex-col @2xl/library:gap-3">
          <div className="min-w-0 flex-1">
            <InputGroup>
              <InputGroupAddon>
                <SearchIcon aria-hidden className="size-3.5" />
              </InputGroupAddon>
              <InputGroupInput
                type="search"
                name="library-search"
                value={query}
                onChange={(event) => {
                  const next = event.currentTarget.value;
                  choose(() => setQuery(next));
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Escape" || query === "") return;
                  event.preventDefault();
                  choose(() => setQuery(""));
                }}
                placeholder="Search files"
                aria-label="Search files"
                spellCheck={false}
                size="sm"
              />
            </InputGroup>
          </div>
          {view.places.length > 1 ? (
            <>
              {/* The same choice twice: a menu where the page is narrow, a list beside it where not. */}
              <div className="max-w-[45%] shrink-0 @2xl/library:hidden">
                <Select
                  value={view.place}
                  onValueChange={(next) => choose(() => setPlace(next as LibraryPlace))}
                >
                  <SelectTrigger size="sm" aria-label="Topic">
                    <SelectValue>{placeName(view.place)}</SelectValue>
                  </SelectTrigger>
                  <SelectPopup>
                    {view.places.map((candidate) => (
                      <SelectItem key={candidate.place} value={candidate.place}>
                        {placeName(candidate.place)} · {candidate.count}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </div>
              <ul
                className="m-0 hidden list-none flex-col gap-px p-0 @2xl/library:flex"
                aria-label="Files by topic"
              >
                {view.places.map((candidate) => {
                  const topic =
                    candidate.place === "all" || candidate.place === "none"
                      ? undefined
                      : topicOf(candidate.place.slice("topic:".length));
                  return (
                    <li key={candidate.place}>
                      <button
                        type="button"
                        aria-pressed={view.place === candidate.place}
                        onClick={() => choose(() => setPlace(candidate.place))}
                        className={cn(
                          "flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-sm text-foreground hover:bg-accent/60 aria-pressed:bg-accent aria-pressed:font-medium",
                          FOCUS_RING,
                        )}
                      >
                        {topic !== undefined ? (
                          <TopicIconBadge
                            topic={topic}
                            statusDotClass={null}
                            className="size-5 rounded-md [&_svg]:size-3"
                          />
                        ) : (
                          <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">
                            {candidate.place === "all" ? (
                              <LibraryIcon className="size-4" />
                            ) : (
                              <FolderIcon className="size-4" />
                            )}
                          </span>
                        )}
                        <span className="min-w-0 flex-1 truncate">
                          {placeName(candidate.place)}
                        </span>{" "}
                        <span className="shrink-0 text-xs font-normal text-muted-foreground tabular-nums">
                          {candidate.count}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}
        </div>
      }
    >
      {view.shown.length === 0 ? (
        <NothingHere>No files match</NothingHere>
      ) : (
        <>
          <div
            role="tablist"
            aria-label="Kinds of file"
            className="-mx-1 mt-3 flex gap-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none]"
          >
            {view.tabs.map((tab) => (
              <button
                key={tab.type}
                type="button"
                role="tab"
                aria-selected={view.type === tab.type}
                onClick={() => choose(() => setType(tab.type))}
                className={cn(
                  "flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-sm text-muted-foreground hover:text-foreground aria-selected:bg-accent aria-selected:font-medium aria-selected:text-foreground",
                  FOCUS_RING,
                )}
              >
                {TYPE_LABEL.get(tab.type)}{" "}
                <span className="text-xs font-normal text-muted-foreground tabular-nums">
                  {tab.count}
                </span>
              </button>
            ))}
          </div>
          <ul
            aria-label="Files"
            className="m-0 mt-3 grid list-none auto-rows-[5rem] grid-cols-2 gap-3 p-0 @lg/files:grid-cols-3 @3xl/files:grid-cols-4 @5xl/files:grid-cols-5"
          >
            {shown.map((item) => (
              <LibraryFile
                key={item.key}
                item={item}
                topic={topicOf(item.topicId)}
                where={libraryWhere(item, vault.topics)}
                when={topicFileDate(item.at, now)}
                workspaceRoot={workspaceRootOf(item)}
              />
            ))}
          </ul>
          {view.shown.length > shown.length ? (
            <div className="mt-6 flex justify-center">
              <Button variant="outline" size="sm" onClick={() => setPages(pages + 1)}>
                Show more
              </Button>
            </div>
          ) : total > items.length ? (
            <Muted className="mt-6 text-center text-xs">
              The newest {items.length} of {total} files.
            </Muted>
          ) : null}
        </>
      )}
    </Frame>
  );
}

/**
 * The page's layout: the title over the filters over the files where it is narrow; the filters
 * as a column beside the title and the files where there is room.
 */
function Frame({
  filters,
  children,
}: {
  readonly filters?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="@container/library">
        <div className="mx-auto grid w-full max-w-7xl grid-cols-1 gap-x-8 px-4 pt-6 pb-12 sm:px-6 @2xl/library:grid-cols-[13rem_minmax(0,1fr)]">
          <PageTitle className="@2xl/library:col-start-2 @2xl/library:row-start-1">
            Library
          </PageTitle>
          <div className="mt-4 min-w-0 @2xl/library:sticky @2xl/library:top-6 @2xl/library:col-start-1 @2xl/library:row-span-2 @2xl/library:row-start-1 @2xl/library:mt-1 @2xl/library:self-start">
            {filters}
          </div>
          <div className="@container/files min-w-0 @2xl/library:col-start-2 @2xl/library:row-start-2">
            {children}
          </div>
        </div>
      </div>
    </ScrollArea>
  );
}

const CARD_CLASS =
  "flex size-full min-w-0 cursor-pointer flex-col justify-between rounded-xl border border-border bg-card p-2.5 text-left hover:bg-accent/50";

function LibraryFile({
  item,
  topic,
  where,
  when,
  workspaceRoot,
}: {
  readonly item: LibraryItem;
  readonly topic: VaultTopic | undefined;
  readonly where: string;
  readonly when: string;
  readonly workspaceRoot: string | null;
}) {
  const navigate = useNavigate();
  const { origin } = item;
  const inNotes = notesLink({
    projectId: item.projectId,
    environmentId: item.environmentId,
    ...(origin.kind === "notes" ? { path: origin.path } : {}),
    from: "library",
  });
  const chat =
    origin.kind === "chat"
      ? scopeThreadRef(item.environmentId, origin.threadId)
      : topic !== undefined && topic.threadId !== null
        ? scopeThreadRef(topic.threadEnvironmentId, topic.threadId)
        : null;
  const cameFrom =
    chat === null ? null : (
      <Button
        size="icon-xs"
        variant="outline"
        aria-label={
          origin.kind === "chat" ? `Go to the chat of ${item.name}` : `Go to ${topic?.title}`
        }
        title={origin.kind === "chat" ? "Go to the chat" : `Go to ${topic?.title}`}
        render={<Link to="/$environmentId/$threadId" params={buildThreadRouteParams(chat)} />}
      >
        <MessageSquareIcon />
      </Button>
    );
  // Shown on hover or keyboard focus; always where there is no pointer to hover.
  const actions = (extra?: ReactNode) =>
    cameFrom === null && extra === undefined ? null : (
      <span className="absolute right-1.5 bottom-1.5 flex items-center gap-1 pointer-fine:opacity-0 pointer-fine:group-focus-within/file:opacity-100 pointer-fine:group-hover/file:opacity-100">
        {extra}
        {cameFrom}
      </span>
    );

  const resource: AssetResource | null = !item.thumbnail
    ? null
    : origin.kind === "chat"
      ? { _tag: "attachment", attachmentId: origin.attachmentId }
      : workspaceRoot === null
        ? null
        : {
            _tag: "draft-workspace-file",
            cwd: workspaceRoot,
            path: `${workspaceRoot.replace(/[\\/]+$/, "")}/${origin.path}`,
          };
  if (resource !== null) {
    return (
      <Picture
        item={item}
        environmentId={item.environmentId}
        resource={resource}
        actionCount={(cameFrom === null ? 0 : 1) + (origin.kind === "notes" ? 1 : 0)}
        actions={actions(
          origin.kind === "notes" ? (
            <Button
              size="icon-xs"
              variant="outline"
              aria-label={`Open ${item.name} in Notes`}
              title="Open in Notes"
              render={<Link {...inNotes} />}
            >
              <NotebookTextIcon />
            </Button>
          ) : undefined,
        )}
        fallback={
          <FileCard
            item={item}
            where={where}
            when={when}
            hasActions={cameFrom !== null}
            render={(props) =>
              origin.kind === "notes" ? <Link {...inNotes} {...props} /> : <div {...props} />
            }
          />
        }
      />
    );
  }

  const openInChat = () => {
    if (origin.kind !== "chat") return;
    const ref = scopeThreadRef(item.environmentId, origin.threadId);
    // Beside its chat, as a file opens when it is clicked in the conversation.
    useRightPanelStore.getState().openAttachment(ref, {
      type: "file",
      id: origin.attachmentId,
      name: item.name,
      mimeType: origin.mimeType,
      sizeBytes: item.sizeBytes,
    });
    void navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(ref) });
  };
  return (
    <li className="group/file relative min-w-0">
      <FileCard
        item={item}
        where={where}
        when={when}
        hasActions={cameFrom !== null}
        render={(props) =>
          origin.kind === "notes" ? (
            <Link {...inNotes} {...props} />
          ) : (
            <button type="button" onClick={openInChat} {...props} />
          )
        }
      />
      {actions()}
    </li>
  );
}

/** A file that is not shown as a picture: what kind it is, its name, where it is from and when. */
function FileCard({
  item,
  where,
  when,
  hasActions,
  render,
}: {
  readonly item: LibraryItem;
  readonly where: string;
  readonly when: string;
  readonly hasActions: boolean;
  /** The element the whole card is: a link to Notes, or a button that opens the chat. */
  readonly render: (props: {
    readonly className: string;
    readonly "data-library-file": string;
    readonly children: ReactNode;
  }) => ReactNode;
}) {
  return render({
    className: cn(CARD_CLASS, FOCUS_RING),
    "data-library-file": item.name,
    children: (
      <>
        <span className="flex min-w-0 items-start gap-2.5">
          <span
            aria-hidden
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-md font-mono text-3xs font-semibold tracking-tight",
              BADGE_TONE[item.type],
            )}
          >
            {libraryBadge(item.name)}
          </span>
          <span className="line-clamp-2 min-w-0 flex-1 text-sm leading-tight font-medium wrap-break-word text-foreground">
            {item.name}
          </span>
        </span>
        {/* Where there is no pointer to hover, the card's own action is always at the line's end. */}
        <span
          className={cn(
            "truncate text-xs text-muted-foreground",
            hasActions && "pointer-coarse:pe-7",
          )}
        >
          {[where, when].filter((part) => part !== "").join(" · ")}
        </span>
      </>
    ),
  });
}

/** A picture as itself, two rows tall; a card instead when this connection cannot be given it. */
function Picture({
  item,
  environmentId,
  resource,
  actionCount,
  actions,
  fallback,
}: {
  readonly item: LibraryItem;
  readonly environmentId: EnvironmentId;
  readonly resource: AssetResource;
  /** How many buttons sit over the end of the name, so the name stops short of them. */
  readonly actionCount: number;
  readonly actions: ReactNode;
  readonly fallback: ReactNode;
}) {
  const url = useAssetUrlState(environmentId, resource);
  const [broken, setBroken] = useState(false);
  if (url._tag === "Failure" || broken) {
    return (
      <li className="group/file relative min-w-0">
        {fallback}
        {actions}
      </li>
    );
  }
  const src = url._tag === "Success" ? url.url : null;
  return (
    <li className="group/file relative row-span-2 min-w-0">
      <button
        type="button"
        aria-label={`Open ${item.name}`}
        data-library-file={item.name}
        disabled={src === null}
        onClick={() => {
          if (src === null) return;
          openExpandedImagePreview(LIBRARY_VIEWER_KEY, {
            images: [
              {
                src,
                name: item.name,
                actionsSource: {
                  kind: "image",
                  name: item.name,
                  src,
                  asset: { environmentId, resource },
                },
              },
            ],
            index: 0,
          });
        }}
        className={cn(
          "relative block size-full cursor-pointer overflow-hidden rounded-xl border border-border bg-muted",
          FOCUS_RING,
        )}
      >
        {src === null ? null : (
          <img
            src={src}
            alt=""
            loading="lazy"
            decoding="async"
            className="size-full object-cover"
            onError={() => setBroken(true)}
          />
        )}
        <span
          className={cn(
            "pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent ps-2.5 pt-6 pb-2 text-left text-xs font-medium text-white pointer-fine:opacity-0 pointer-fine:group-focus-within/file:opacity-100 pointer-fine:group-hover/file:opacity-100",
            actionCount === 0 ? "pe-2.5" : actionCount === 1 ? "pe-9" : "pe-16",
          )}
        >
          {item.name}
        </span>
      </button>
      {actions}
    </li>
  );
}
