import {
  type Announcements,
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { restrictToFirstScrollableAncestor, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  MAJORDOME_READING_KINDS,
  type MajordomeReadingItem,
  type MajordomeReadingKind,
  type MajordomeReadingSubject,
  type MajordomeSaveReadingSubjectsInput,
  type MajordomeUpdateReadingItemInput,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import * as Schema from "effect/Schema";
import {
  AlarmClockIcon,
  BookOpenIcon,
  CheckIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  ClockIcon,
  EllipsisIcon,
  FileTextIcon,
  FolderGit2Icon,
  FolderIcon,
  FootprintsIcon,
  GraduationCapIcon,
  GripVerticalIcon,
  HeadphonesIcon,
  LightbulbIcon,
  LinkIcon,
  ListFilterIcon,
  type LucideIcon,
  MessageCircleQuestionIcon,
  NotebookPenIcon,
  PencilIcon,
  RefreshCwIcon,
  PlayIcon,
  PlusIcon,
  StarIcon,
  SunriseIcon,
  TargetIcon,
  TrashIcon,
  XIcon,
} from "lucide-react";
import { type FormEvent, type ReactElement, type ReactNode, useState } from "react";

import { isElectron } from "../../env";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useNowMinute } from "../../hooks/useNowMinute";
import { cn } from "../../lib/utils";
import { majordomeEnvironment } from "../../state/majordome";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { Input } from "../ui/input";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "../ui/menu";
import { ScrollArea } from "../ui/scroll-area";
import { SidebarInset } from "../ui/sidebar";
import { Spinner } from "../ui/spinner";
import { Textarea } from "../ui/textarea";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import { Toggle } from "../ui/toggle";
import { Toggle as ViewToggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { useAskAssistant } from "./AssistantDock";
import {
  EntryList,
  ListSkeleton,
  LoadFailed,
  Muted,
  PageHeader,
  Surface,
  SwitchLabel,
} from "./paper";
import {
  NO_SUBJECT,
  askAboutReadingMessage,
  canReorderReading,
  filterReadingItems,
  nextReadingItems,
  orderReadingItems,
  parseReadingMinutes,
  placeReadingItem,
  presentReadingKinds,
  READING_KIND_LABELS,
  READING_KIND_NAMES,
  type ReadingSnoozeChoice,
  readingAddedWords,
  readingBackOnWords,
  readingFocusWords,
  readingLengthWords,
  readingMoreWords,
  readingSnoozeDate,
  readingSubjectOf,
  readingTagCounts,
  readingTimeLeftWords,
  searchReadingItems,
  splitSnoozedReading,
  splitTrashedReading,
  withReadingTag,
} from "./readingList.logic";
import type { MajordomeVault } from "./topics.logic";
import { useMajordomeVaults } from "./useMajordomeVaults";

const HIDE_FINISHED = Schema.Boolean;
const VIEW = Schema.Literals(["next", "everything"]);
const SNOOZE_CHOICES: ReadonlyArray<readonly [ReadingSnoozeChoice, string]> = [
  ["tomorrow", "Tomorrow"],
  ["week", "Next week"],
  ["month", "In a month"],
];
const TAG_CHIPS_SHOWN = 8;
const KIND_ICONS: Readonly<Record<MajordomeReadingKind, LucideIcon>> = {
  article: FileTextIcon,
  video: PlayIcon,
  paper: GraduationCapIcon,
  repo: FolderGit2Icon,
  podcast: HeadphonesIcon,
  doc: BookOpenIcon,
  other: LinkIcon,
};
// A short move starts the drag, so a plain click on the handle does nothing.
const MOUSE_DRAG = { activationConstraint: { distance: 6 } };
// A held finger drags; a swipe still scrolls the list.
const TOUCH_DRAG = { activationConstraint: { delay: 250, tolerance: 8 } };
const KEYBOARD_DRAG = { coordinateGetter: sortableKeyboardCoordinates };
const DRAG_MODIFIERS = [restrictToVerticalAxis, restrictToFirstScrollableAncestor];
const MOVE_HELP = "Drag to move, or press Space, then the arrow keys, then Space again";
const MOVE_INSTRUCTIONS = {
  draggable:
    "To move this row, press Space, use the up and down arrows, then press Space again to put it down. Escape cancels.",
};

/** A name that shows when the pointer rests on a button that is only an icon. */
function Tip({ label, children }: { readonly label: string; readonly children: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipPopup>{label}</TooltipPopup>
    </Tooltip>
  );
}

type Patch = Omit<MajordomeUpdateReadingItemInput, "projectId" | "itemId">;

/**
 * The page's own picture when it has one, else an icon for what kind of thing it is. The picture
 * comes straight from its site, without saying which page asked for it.
 */
function ItemTile({
  item,
  dimmed,
  large = false,
}: {
  readonly item: MajordomeReadingItem;
  readonly dimmed: boolean;
  readonly large?: boolean;
}) {
  const size = large ? "h-16 w-24 sm:h-20 sm:w-32" : "h-9 w-12 sm:h-10 sm:w-16";
  // Keyed by address, so a picture that failed is tried again once the link is looked up anew.
  const [failed, setFailed] = useState<string | null>(null);
  const KindIcon = KIND_ICONS[item.kind];
  if (item.image !== undefined && failed !== item.image) {
    return (
      <img
        src={item.image}
        alt={READING_KIND_LABELS[item.kind]}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(item.image ?? null)}
        className={cn("shrink-0 rounded-md bg-muted object-cover", size, dimmed && "opacity-60")}
      />
    );
  }
  return (
    <span
      role="img"
      aria-label={READING_KIND_LABELS[item.kind]}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground",
        size,
        dimmed && "opacity-60",
      )}
    >
      <KindIcon className={large ? "size-6" : "size-4"} />
    </span>
  );
}

/** What was saved to read, watch or listen to later, kept in the notes folder. */
export function ReadingListPage() {
  const { activeVault, loading } = useMajordomeVaults();
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <WorkspacePageHeader electron={isElectron} className="border-b border-border" />
        <ScrollArea className="min-h-0 flex-1">
          <div className="mx-auto flex w-full max-w-3xl flex-col px-5 pt-6 pb-12 sm:px-6">
            <PageHeader
              title="Reading list"
              intro={
                activeVault === null && !loading
                  ? "Open a notes folder to keep a reading list in it."
                  : "Links to read, watch or listen to later. Paste one to save it."
              }
            />
            {activeVault === null ? null : (
              <VaultReadingList key={activeVault.key} vault={activeVault} />
            )}
          </div>
        </ScrollArea>
      </div>
    </SidebarInset>
  );
}

/** True when the command failed for a reason worth telling; the toast is already shown. */
function reportFailure(result: AtomCommandResult<unknown, unknown>, title: string): boolean {
  if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return false;
  const error = squashAtomCommandFailure(result);
  toastManager.add({
    type: "error",
    title,
    description: error instanceof Error ? error.message : String(error),
  });
  return true;
}

const rowElementId = (itemId: string) => `reading-${itemId}`;

function VaultReadingList({ vault }: { readonly vault: MajordomeVault }) {
  const { environmentId, projectId } = vault;
  const listAtom = majordomeEnvironment.readingItems({ environmentId, input: { projectId } });
  const result = useAtomValue(listAtom);
  const retry = useAtomRefresh(listAtom);
  const canChange = useAtomValue(majordomeEnvironment.addReadingItem.permissionAtom(environmentId));
  const quiet = { reportFailure: false } as const;
  const addItem = useAtomCommand(majordomeEnvironment.addReadingItem, {
    label: "save to reading list",
    ...quiet,
  });
  const updateItem = useAtomCommand(majordomeEnvironment.updateReadingItem, {
    label: "change reading list",
    ...quiet,
  });
  const reorderItems = useAtomCommand(majordomeEnvironment.reorderReadingItems, {
    label: "reorder reading list",
    ...quiet,
  });
  const removeItem = useAtomCommand(majordomeEnvironment.removeReadingItem, {
    label: "remove from reading list",
    ...quiet,
  });
  const restoreItem = useAtomCommand(majordomeEnvironment.restoreReadingItem, {
    label: "put back on reading list",
    ...quiet,
  });
  const saveSubjects = useAtomCommand(majordomeEnvironment.saveReadingSubjects, {
    label: "change reading list subjects",
    ...quiet,
  });
  const askAssistant = useAskAssistant();
  const now = new Date(`${useNowMinute()}:00.000Z`);
  const sensors = useSensors(
    useSensor(MouseSensor, MOUSE_DRAG),
    useSensor(TouchSensor, TOUCH_DRAG),
    useSensor(KeyboardSensor, KEYBOARD_DRAG),
  );

  const [kind, setKind] = useState<MajordomeReadingKind | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [subject, setSubject] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [allTags, setAllTags] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [deleting, setDeleting] = useState<MajordomeReadingItem | null>(null);
  const [hideFinished, setHideFinished] = useLocalStorage(
    "majordome:reading-list-hide-finished",
    true,
    HIDE_FINISHED,
  );
  const [view, setView] = useLocalStorage("majordome:reading-list-view", "everything", VIEW);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  /** Rows whose tags and summary the owner's AI is still writing. */
  const [describing, setDescribing] = useState<ReadonlyArray<string>>([]);
  // The order just chosen, shown until the list read from the server changes from `from`:
  // dropping it as soon as the save answers would show the old order for a moment.
  const [pendingOrder, setPendingOrder] = useState<{
    readonly order: ReadonlyArray<string>;
    readonly from: string;
  } | null>(null);

  const data = AsyncResult.getOrElse(result, () => null);
  const saved = data?.items ?? [];
  const subjects = data?.subjects ?? [];
  const idsKey = saved.map((item) => item.id).join("\n");
  const order =
    pendingOrder !== null && pendingOrder.from === idsKey
      ? pendingOrder.order
      : saved.map((item) => item.id);
  const items = order.flatMap((id) => saved.find((item) => item.id === id) ?? []);

  // Snoozed against the minute that ticks, so an item is back by itself once its day starts.
  const { kept, trashed } = splitTrashedReading(items);
  const { awake, snoozed } = splitSnoozedReading(kept, now);
  const { next, later } = nextReadingItems(kept, now, subjects);
  const inView = hideFinished ? awake.filter((item) => item.doneAt === undefined) : awake;
  const kinds = presentReadingKinds(inView);
  const tags = readingTagCounts(inView);
  // A kind or tag whose last row left the view is no longer a filter anyone can see or clear.
  const filters = {
    kind: kind !== null && kinds.includes(kind) ? kind : null,
    tag: tag !== null && tags.some((entry) => entry.tag === tag) ? tag : null,
    subject:
      subject === NO_SUBJECT || subjects.some((entry) => entry.id === subject) ? subject : null,
    hideFinished,
  };
  const narrowed =
    filters.kind !== null ||
    filters.tag !== null ||
    filters.subject !== null ||
    query.trim() !== "";
  const shown = orderReadingItems(filterReadingItems(searchReadingItems(awake, query), filters));
  const snoozedShown = filterReadingItems(searchReadingItems(snoozed, query), filters);
  const unfinished = shown.filter((item) => item.doneAt === undefined);
  const finished = shown.filter((item) => item.doneAt !== undefined);
  const reorderable = canChange && canReorderReading(filters, query) && unfinished.length > 1;
  const timeLeft = readingTimeLeftWords(shown);

  const update = async (item: MajordomeReadingItem, patch: Patch) => {
    const outcome = await updateItem({
      environmentId,
      input: { projectId, itemId: item.id, ...patch },
    });
    return !reportFailure(outcome, `Could not change “${item.title}”`);
  };

  const snooze = async (item: MajordomeReadingItem, choice: ReadingSnoozeChoice) => {
    const until = readingSnoozeDate(choice, now);
    if (!(await update(item, { snoozedUntil: until }))) return;
    const toastId = toastManager.add({
      type: "success",
      title: `Snoozed, ${readingBackOnWords(until, now)}`,
      description: item.title,
      actionProps: {
        children: "Undo",
        onClick: () => {
          toastManager.close(toastId);
          void update(item, { snoozedUntil: null });
        },
      },
    });
  };

  const finish = async (item: MajordomeReadingItem) => {
    if (!(await update(item, { done: true }))) return;
    const toastId = toastManager.add({
      type: "success",
      title: "Finished",
      description: item.title,
      actionProps: {
        children: "Undo",
        onClick: () => {
          toastManager.close(toastId);
          void update(item, { done: false });
        },
      },
    });
  };

  /** "Done a bit": where they got to is kept, and the item is out of the way until tomorrow. */
  const doneABit = async (item: MajordomeReadingItem, progress: string) => {
    const until = readingSnoozeDate("tomorrow", now);
    const saved = await update(item, {
      progress: progress === "" ? null : progress,
      snoozedUntil: until,
    });
    if (saved) {
      toastManager.add({
        type: "success",
        title: `Kept your place, ${readingBackOnWords(until, now)}`,
        description: item.title,
      });
    }
    return saved;
  };

  const putSubjects = async (wanted: MajordomeSaveReadingSubjectsInput["subjects"]) => {
    const outcome = await saveSubjects({
      environmentId,
      input: { projectId, subjects: [...wanted] },
    });
    return !reportFailure(outcome, "Could not change your subjects");
  };

  const describe = async (itemId: string) => {
    setDescribing((ids) => [...ids, itemId]);
    await updateItem({ environmentId, input: { projectId, itemId, enrich: true } });
    setDescribing((ids) => ids.filter((id) => id !== itemId));
  };

  const reorder = async (next: ReadonlyArray<string>) => {
    if (next.join("\n") === order.join("\n")) return;
    setPendingOrder({ order: next, from: idsKey });
    const outcome = await reorderItems({ environmentId, input: { projectId, itemIds: [...next] } });
    if (reportFailure(outcome, "Could not reorder your reading list")) setPendingOrder(null);
  };

  const putBack = (item: MajordomeReadingItem) =>
    restoreItem({ environmentId, input: { projectId, itemId: item.id } }).then((undone) =>
      reportFailure(undone, `Could not put “${item.title}” back`),
    );

  const remove = async (item: MajordomeReadingItem) => {
    const outcome = await removeItem({ environmentId, input: { projectId, itemId: item.id } });
    if (reportFailure(outcome, `Could not remove “${item.title}”`)) return;
    if (outcome._tag !== "Success") return;
    const toastId = toastManager.add({
      type: "success",
      title: "Moved to the Trash",
      description: item.title,
      actionProps: {
        children: "Undo",
        onClick: () => {
          toastManager.close(toastId);
          void putBack(item);
        },
      },
    });
  };

  // The server deletes for good what is removed while already in the Trash.
  const deleteForGood = async (item: MajordomeReadingItem) => {
    const outcome = await removeItem({ environmentId, input: { projectId, itemId: item.id } });
    reportFailure(outcome, `Could not delete “${item.title}”`);
  };

  const showExisting = (item: MajordomeReadingItem) => {
    toastManager.add({
      type: "info",
      title: "That link is already on your list",
      description: item.title,
    });
    setHighlighted(item.id);
    document.getElementById(rowElementId(item.id))?.scrollIntoView({ block: "nearest" });
    setTimeout(() => setHighlighted((current) => (current === item.id ? null : current)), 2500);
  };

  const actions = (item: MajordomeReadingItem) => ({
    item,
    canChange,
    subjects,
    describing: describing.includes(item.id),
    onUpdate: (patch: Patch) => update(item, patch),
    onSnooze: (choice: ReadingSnoozeChoice) => void snooze(item, choice),
    onDoneABit: (progress: string) => doneABit(item, progress),
    onFinished: () => void finish(item),
    onRemove: () => void remove(item),
    onAsk: askAssistant === null ? null : () => askAssistant(askAboutReadingMessage(item)),
  });
  const row = (item: MajordomeReadingItem, draggable: boolean) => (
    <ReadingRow
      key={item.id}
      {...actions(item)}
      now={now}
      snoozed={snoozed.includes(item)}
      draggable={draggable}
      handleGap={reorderable}
      highlighted={highlighted === item.id}
    />
  );
  const moreWords = readingMoreWords(later);
  const focusWords = readingFocusWords(kept, now, subjects);
  const filterCount = (filters.kind === null ? 0 : 1) + (filters.tag === null ? 0 : 1);
  const titleOf = (id: string | number) =>
    saved.find((item) => item.id === String(id))?.title ?? "the row";
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${titleOf(active.id)}.`,
    onDragOver: ({ active, over }) =>
      over === null ? undefined : `${titleOf(active.id)} is now where ${titleOf(over.id)} was.`,
    onDragEnd: ({ active, over }) =>
      over === null
        ? `${titleOf(active.id)} is back where it was.`
        : `${titleOf(active.id)} was put down where ${titleOf(over.id)} was.`,
    onDragCancel: ({ active }) => `Cancelled. ${titleOf(active.id)} is back where it was.`,
  };

  return (
    <>
      {canChange ? (
        <AddReadingItem
          onAdd={async (text) => {
            const outcome = await addItem({ environmentId, input: { projectId, text } });
            if (
              outcome._tag === "Success" &&
              !outcome.value.duplicate &&
              outcome.value.item.url !== null
            ) {
              // Not waited for: the row is there already, and its tags and summary arrive when
              // the owner's AI answers. No answer leaves the row as it is.
              void describe(outcome.value.item.id);
            }
            return outcome;
          }}
          onDuplicate={showExisting}
        />
      ) : (
        <Muted className="mt-6">
          You can look at the reading list from this device, but it isn't allowed to change it.
        </Muted>
      )}
      {data === null ? (
        result._tag === "Failure" ? (
          <LoadFailed className="mt-8" onRetry={retry}>
            Couldn't load your reading list.
          </LoadFailed>
        ) : (
          <div className="mt-8">
            <ListSkeleton />
          </div>
        )
      ) : items.length === 0 ? (
        <Muted className="mt-8 border-t border-border py-3">
          Nothing saved yet.{" "}
          {canChange ? "Paste a link above and it will be here when you have time." : null}
        </Muted>
      ) : (
        <>
          <div className="mt-4">
            <ToggleGroup
              aria-label="What to show"
              value={[view]}
              onValueChange={(chosen) => {
                const value = chosen[0];
                if (value === "next" || value === "everything") setView(value);
              }}
            >
              <ViewToggle value="next">Next</ViewToggle>
              <ViewToggle value="everything">Everything</ViewToggle>
            </ToggleGroup>
          </div>
          {view === "next" ? (
            <>
              {focusWords === null ? null : (
                <FocusLine
                  words={focusWords}
                  subjects={subjects}
                  canChange={canChange}
                  onSave={putSubjects}
                />
              )}
              {next.length === 0 ? (
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border py-3">
                  <Muted className="flex-1 basis-48">
                    Nothing left to do for now.
                    {snoozed.length === 0
                      ? null
                      : ` ${snoozed.length} snoozed ${snoozed.length === 1 ? "item comes" : "items come"} back later.`}
                  </Muted>
                  <Button size="xs" variant="outline" onClick={() => setView("everything")}>
                    See everything
                  </Button>
                </div>
              ) : (
                <ul
                  aria-label="Next on your list"
                  className="mt-3 flex list-none flex-col gap-3 p-0"
                >
                  {next.map((item) => (
                    <NextCard key={item.id} {...actions(item)} />
                  ))}
                </ul>
              )}
              {moreWords !== null ? (
                <div className="mt-3">
                  <Button size="xs" variant="ghost-muted" onClick={() => setView("everything")}>
                    {moreWords}
                    <ChevronRightIcon />
                  </Button>
                </div>
              ) : null}
            </>
          ) : (
            <>
              <div className="mt-4">
                <Input
                  nativeInput
                  type="search"
                  size="sm"
                  aria-label="Search your reading list"
                  placeholder="Search titles, sites, tags and notes"
                  maxLength={200}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              <SubjectsBar
                subjects={subjects}
                selected={filters.subject}
                canChange={canChange}
                counts={(id) => kept.filter((item) => item.subjectId === id).length}
                onSelect={setSubject}
                onSave={putSubjects}
              />
              <div className="mt-1 flex flex-wrap items-center gap-0.5">
                {/* On a phone the kinds and tags wait behind this one button. */}
                <div className="sm:hidden">
                  <Button
                    size="xs"
                    variant="outline"
                    aria-expanded={filtersOpen}
                    onClick={() => setFiltersOpen(!filtersOpen)}
                  >
                    <ListFilterIcon />
                    {filterCount === 0 ? "Filter" : `Filter (${filterCount})`}
                  </Button>
                </div>
                <div
                  className={cn(
                    "order-2 basis-full flex-wrap items-center gap-0.5 sm:order-1 sm:flex sm:basis-auto",
                    filtersOpen ? "flex" : "hidden",
                  )}
                >
                  <Chip pressed={filters.kind === null} onPressedChange={() => setKind(null)}>
                    All
                  </Chip>
                  {kinds.map((entry) => (
                    <Chip
                      key={entry}
                      pressed={filters.kind === entry}
                      onPressedChange={(pressed) => setKind(pressed ? entry : null)}
                    >
                      {READING_KIND_LABELS[entry]}
                    </Chip>
                  ))}
                </div>
                {/* A switch, not a chip: a chip on its own gives no way to tell on from off. */}
                <SwitchLabel className="order-1 ms-auto min-h-8 text-xs text-muted-foreground sm:order-2">
                  <Switch checked={hideFinished} onCheckedChange={setHideFinished} />
                  Hide finished
                </SwitchLabel>
              </div>
              <div
                className={cn(
                  "mt-1 flex-wrap items-center gap-0.5 empty:hidden sm:flex",
                  filtersOpen ? "flex" : "hidden",
                )}
              >
                {(allTags ? tags : tags.slice(0, TAG_CHIPS_SHOWN)).map((entry) => (
                  <Chip
                    key={entry.tag}
                    pressed={filters.tag === entry.tag}
                    onPressedChange={(pressed) => setTag(pressed ? entry.tag : null)}
                  >
                    #{entry.tag}
                  </Chip>
                ))}
                {tags.length > TAG_CHIPS_SHOWN ? (
                  <Button size="xs" variant="ghost-muted" onClick={() => setAllTags(!allTags)}>
                    {allTags ? "Fewer tags" : `+${tags.length - TAG_CHIPS_SHOWN} more`}
                  </Button>
                ) : null}
              </div>
              {timeLeft !== null ? <Muted className="mt-3 text-xs">{timeLeft}</Muted> : null}
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                modifiers={DRAG_MODIFIERS}
                accessibility={{ announcements, screenReaderInstructions: MOVE_INSTRUCTIONS }}
                onDragEnd={({ active, over }: DragEndEvent) => {
                  if (over !== null) {
                    void reorder(placeReadingItem(items, String(active.id), String(over.id)));
                  }
                }}
              >
                {shown.length === 0 ? (
                  <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border py-3">
                    <Muted className="flex-1 basis-48">
                      {narrowed
                        ? "Nothing matches. Clear the search and filters to see everything."
                        : awake.length === 0
                          ? "Everything here is snoozed for now."
                          : "Everything here is finished. Turn off “Hide finished” to see it again."}
                    </Muted>
                    {narrowed ? (
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => {
                          setKind(null);
                          setTag(null);
                          setSubject(null);
                          setQuery("");
                        }}
                      >
                        Clear filters
                      </Button>
                    ) : null}
                  </div>
                ) : (
                  <SortableContext
                    items={unfinished.map((item) => item.id)}
                    strategy={verticalListSortingStrategy}
                    disabled={!reorderable}
                  >
                    <EntryList aria-label="Reading list" className="mt-3">
                      {unfinished.map((item) => row(item, reorderable))}
                      {finished.map((item) => row(item, false))}
                    </EntryList>
                  </SortableContext>
                )}
                {snoozedShown.length === 0 ? null : (
                  <Collapsible>
                    <CollapsibleTrigger className="group -mx-2 mt-3 inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                      <ChevronRightIcon
                        className="size-3.5 transition-transform group-data-[panel-open]:rotate-90"
                        aria-hidden
                      />
                      Snoozed ({snoozedShown.length})
                    </CollapsibleTrigger>
                    <CollapsiblePanel>
                      <EntryList aria-label="Snoozed" className="mt-1">
                        {snoozedShown.map((item) => row(item, false))}
                      </EntryList>
                    </CollapsiblePanel>
                  </Collapsible>
                )}
              </DndContext>
              {trashed.length === 0 ? null : (
                <Collapsible>
                  <CollapsibleTrigger className="group -mx-2 mt-3 inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                    <ChevronRightIcon
                      className="size-3.5 transition-transform group-data-[panel-open]:rotate-90"
                      aria-hidden
                    />
                    Trash ({trashed.length})
                  </CollapsibleTrigger>
                  <CollapsiblePanel>
                    <EntryList aria-label="Trash" className="mt-1">
                      {trashed.map((item) => (
                        <TrashRow
                          key={item.id}
                          item={item}
                          canChange={canChange}
                          onPutBack={() => void putBack(item)}
                          onDelete={() => setDeleting(item)}
                        />
                      ))}
                    </EntryList>
                  </CollapsiblePanel>
                </Collapsible>
              )}
              <AlertDialog
                open={deleting !== null}
                onOpenChange={(open) => {
                  if (!open) setDeleting(null);
                }}
              >
                <AlertDialogPopup>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete “{deleting?.title}” for good?</AlertDialogTitle>
                    <AlertDialogDescription>
                      It leaves your reading list and the Trash. This cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogClose render={<Button variant="outline" />}>
                      Keep it in the Trash
                    </AlertDialogClose>
                    <Button
                      variant="destructive"
                      onClick={() => {
                        const gone = deleting;
                        if (gone === null) return;
                        setDeleting(null);
                        void deleteForGood(gone);
                      }}
                    >
                      Delete for good
                    </Button>
                  </AlertDialogFooter>
                </AlertDialogPopup>
              </AlertDialog>
            </>
          )}
        </>
      )}
    </>
  );
}

function Chip(props: {
  readonly pressed: boolean;
  readonly onPressedChange: (pressed: boolean) => void;
  readonly children: ReactNode;
}) {
  return <Toggle size="xs" variant="pill" {...props} />;
}

/**
 * The subjects to narrow the list by, with the way to add one and, for the one chosen, to put it
 * in focus, rename it or delete it.
 */
function SubjectsBar({
  subjects,
  selected,
  canChange,
  counts,
  onSelect,
  onSave,
}: {
  readonly subjects: ReadonlyArray<MajordomeReadingSubject>;
  readonly selected: string | null;
  readonly canChange: boolean;
  /** How many saved things are filed under a subject. */
  readonly counts: (subjectId: string) => number;
  readonly onSelect: (subject: string | null) => void;
  readonly onSave: (subjects: MajordomeSaveReadingSubjectsInput["subjects"]) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState<"add" | "rename" | null>(null);
  const [deleting, setDeleting] = useState<MajordomeReadingSubject | null>(null);
  const chosen = subjects.find((subject) => subject.id === selected);
  if (subjects.length === 0 && !canChange) return null;

  const change = async (
    subject: MajordomeReadingSubject,
    patch: Partial<MajordomeReadingSubject>,
  ) => onSave(subjects.map((entry) => (entry.id === subject.id ? { ...entry, ...patch } : entry)));

  return (
    <div className="mt-2 flex flex-wrap items-center gap-0.5">
      {subjects.map((subject) => (
        <Chip
          key={subject.id}
          pressed={selected === subject.id}
          onPressedChange={(pressed) => onSelect(pressed ? subject.id : null)}
        >
          {subject.focus === true ? <TargetIcon aria-label="In focus" /> : null}
          {subject.name}
        </Chip>
      ))}
      {subjects.length === 0 ? null : (
        <Chip
          pressed={selected === NO_SUBJECT}
          onPressedChange={(pressed) => onSelect(pressed ? NO_SUBJECT : null)}
        >
          No subject
        </Chip>
      )}
      {!canChange ? null : editing === "add" ? (
        <div className="w-56">
          <InlineEdit
            label="New subject"
            placeholder="Subject, such as Rust"
            initial=""
            onCancel={() => setEditing(null)}
            onSave={(name) => {
              if (name === "") setEditing(null);
              else void onSave([...subjects, { name }]).then((saved) => saved && setEditing(null));
            }}
          />
        </div>
      ) : editing === "rename" && chosen !== undefined ? (
        <div className="w-56">
          <InlineEdit
            label="Subject name"
            initial={chosen.name}
            onCancel={() => setEditing(null)}
            onSave={(name) => {
              if (name === "" || name === chosen.name) setEditing(null);
              else void change(chosen, { name }).then((saved) => saved && setEditing(null));
            }}
          />
        </div>
      ) : (
        <>
          {chosen === undefined ? null : (
            <Menu>
              <MenuTrigger
                render={
                  <Button
                    size="icon-xs"
                    variant="ghost-muted"
                    aria-label={`More for the subject ${chosen.name}`}
                  />
                }
              >
                <EllipsisIcon />
              </MenuTrigger>
              <MenuPopup align="start">
                <MenuItem onClick={() => void change(chosen, { focus: chosen.focus !== true })}>
                  <TargetIcon />
                  {chosen.focus === true ? "Take out of focus" : "Put in focus"}
                </MenuItem>
                <MenuItem onClick={() => setEditing("rename")}>
                  <PencilIcon />
                  Rename
                </MenuItem>
                <MenuSeparator />
                <MenuItem variant="destructive" onClick={() => setDeleting(chosen)}>
                  <TrashIcon />
                  Delete subject
                </MenuItem>
              </MenuPopup>
            </Menu>
          )}
          <Button size="xs" variant="ghost-muted" onClick={() => setEditing("add")}>
            <PlusIcon />
            Subject
          </Button>
        </>
      )}
      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete the subject “{deleting?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting === null || counts(deleting.id) === 0
                ? "Nothing is filed under it."
                : `What is filed under it (${counts(deleting.id)}) stays on your list, under no subject.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Keep it</AlertDialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                const gone = deleting;
                if (gone === null) return;
                void onSave(subjects.filter((entry) => entry.id !== gone.id)).then((saved) => {
                  if (saved) setDeleting(null);
                });
              }}
            >
              Delete subject
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </div>
  );
}

/** What the Next view is the top of, with the subjects to put in or out of focus. */
function FocusLine({
  words,
  subjects,
  canChange,
  onSave,
}: {
  readonly words: string;
  readonly subjects: ReadonlyArray<MajordomeReadingSubject>;
  readonly canChange: boolean;
  readonly onSave: (subjects: MajordomeSaveReadingSubjectsInput["subjects"]) => Promise<boolean>;
}) {
  // One change at a time: a second sent before the first is read back would undo it.
  const [saving, setSaving] = useState(false);
  return (
    // The button comes first so it stays put while ticking changes the words beside it.
    <div className="mt-3 flex items-start gap-2">
      {canChange ? (
        <Menu>
          <MenuTrigger render={<Button size="xs" variant="outline" />}>
            <TargetIcon />
            {subjects.some((subject) => subject.focus === true) ? "Change" : "Choose"}
          </MenuTrigger>
          <MenuPopup align="start">
            <MenuGroup>
              <MenuGroupLabel>Subjects in focus</MenuGroupLabel>
              {subjects.map((subject) => (
                <MenuCheckboxItem
                  key={subject.id}
                  checked={subject.focus === true}
                  disabled={saving}
                  onCheckedChange={(checked) => {
                    setSaving(true);
                    void onSave(
                      subjects.map((entry) =>
                        entry.id === subject.id ? { ...entry, focus: checked } : entry,
                      ),
                    ).then(() => setSaving(false));
                  }}
                >
                  {subject.name}
                </MenuCheckboxItem>
              ))}
            </MenuGroup>
          </MenuPopup>
        </Menu>
      ) : null}
      <Muted className="min-w-0 flex-1 pt-0.5 text-xs">{words}</Muted>
    </div>
  );
}

function AddReadingItem({
  onAdd,
  onDuplicate,
}: {
  readonly onAdd: (
    text: string,
  ) => Promise<
    AtomCommandResult<{ readonly item: MajordomeReadingItem; readonly duplicate: boolean }, unknown>
  >;
  readonly onDuplicate: (item: MajordomeReadingItem) => void;
}) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (text === "" || busy) return;
    setBusy(true);
    const outcome = await onAdd(text);
    setBusy(false);
    if (reportFailure(outcome, "Could not save that")) return;
    if (outcome._tag !== "Success") return;
    // Whatever was typed while it saved stays.
    setDraft((current) => (current.trim() === text ? "" : current));
    if (outcome.value.duplicate) onDuplicate(outcome.value.item);
  };

  return (
    <form className="mt-6 flex items-center gap-2" onSubmit={(event) => void submit(event)}>
      <div className="min-w-0 flex-1">
        <Input
          nativeInput
          aria-label="Paste a link or type a title"
          placeholder="Paste a link or type a title"
          maxLength={2000}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      </div>
      <Button type="submit" disabled={draft.trim() === ""} aria-busy={busy}>
        {busy ? <Spinner /> : null}
        Add
      </Button>
    </form>
  );
}

type Editing = "title" | "length" | "note" | "tag" | "why" | "progress" | null;

/** What a row and a Next card are both handed for one item. */
interface ItemActions {
  readonly item: MajordomeReadingItem;
  readonly canChange: boolean;
  readonly subjects: ReadonlyArray<MajordomeReadingSubject>;
  readonly describing: boolean;
  readonly onUpdate: (patch: Patch) => Promise<boolean>;
  readonly onSnooze: (choice: ReadingSnoozeChoice) => void;
  /** Keeps where they got to (empty for nowhere worth saying) and snoozes it until tomorrow. */
  readonly onDoneABit: (progress: string) => Promise<boolean>;
  /** Marks it finished and offers to undo that. */
  readonly onFinished: () => void;
  readonly onRemove: () => void;
  readonly onAsk: (() => void) | null;
}

/** The title, summary, note and tags of an item, each with its field while it is being changed. */
function ItemText({
  item,
  canChange,
  subjects,
  describing,
  onUpdate,
  onDoneABit,
  editing,
  onEditing,
  length = null,
  phoneMeta = null,
  large = false,
}: Pick<
  ItemActions,
  "item" | "canChange" | "subjects" | "describing" | "onUpdate" | "onDoneABit"
> & {
  readonly editing: Editing;
  readonly onEditing: (editing: Editing) => void;
  /** Said beside the source, where the item has no column of its own for it. */
  readonly length?: string | null;
  /** Said beside the source on a phone only, where the row's own column for it is hidden. */
  readonly phoneMeta?: string | null;
  readonly large?: boolean;
}) {
  const done = item.doneAt !== undefined;
  const source = [readingSubjectOf(item, subjects)?.name, item.site, length].filter(Boolean);
  const save = async (patch: Patch) => {
    if (await onUpdate(patch)) onEditing(null);
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      {editing === "title" ? (
        <InlineEdit
          label="Title"
          initial={item.title}
          onCancel={() => onEditing(null)}
          onSave={(text) => (text === "" ? onEditing(null) : void save({ title: text }))}
        />
      ) : (
        <p
          className={cn(
            "min-w-0 font-medium wrap-break-word text-foreground",
            large ? "text-base" : "text-sm",
            done && "text-muted-foreground line-through",
          )}
        >
          {item.url === null ? (
            item.title
          ) : (
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            >
              {item.title}
            </a>
          )}
        </p>
      )}
      {editing === "why" ? (
        <InlineEdit
          label="Why read it"
          placeholder="One line on what it gives you"
          initial={item.why ?? ""}
          onCancel={() => onEditing(null)}
          onSave={(text) => void save({ why: text === "" ? null : text })}
        />
      ) : item.why ? (
        <p className={cn("wrap-break-word text-foreground", large ? "text-sm" : "text-xs")}>
          <span className="text-muted-foreground">Why: </span>
          {item.why}
        </p>
      ) : null}
      {item.summary !== undefined ? (
        <p className={cn("wrap-break-word text-muted-foreground", large ? "text-sm" : "text-xs")}>
          {item.summary}
        </p>
      ) : describing ? (
        <p role="status" className="text-xs text-muted-foreground">
          Adding tags and a summary…
        </p>
      ) : null}
      {editing === "note" ? (
        <InlineEdit
          multiline
          label="Note"
          placeholder="What you want to remember from it"
          initial={item.notes ?? ""}
          onCancel={() => onEditing(null)}
          onSave={(text) => void save({ notes: text === "" ? null : text })}
        />
      ) : item.notes ? (
        <p className="border-l-2 border-border pl-2 text-xs whitespace-pre-wrap wrap-break-word text-muted-foreground">
          {item.notes}
        </p>
      ) : null}
      {editing === "progress" ? (
        <InlineEdit
          label="Where you got to"
          placeholder="Where you got to, so you can pick up from there"
          initial={item.progress ?? ""}
          onCancel={() => onEditing(null)}
          onSave={(text) =>
            void onDoneABit(text).then((saved) => (saved ? onEditing(null) : undefined))
          }
        />
      ) : item.progress ? (
        <p className="text-xs wrap-break-word text-muted-foreground">Got to: {item.progress}</p>
      ) : null}
      {editing === "length" ? (
        <InlineEdit
          label="Length in minutes"
          placeholder="Minutes"
          inputMode="numeric"
          initial={item.minutes === undefined ? "" : String(Math.round(item.minutes))}
          onCancel={() => onEditing(null)}
          onSave={(text) => {
            const minutes = parseReadingMinutes(text);
            if (minutes !== undefined) void save({ minutes });
          }}
        />
      ) : null}
      <div className="flex flex-wrap items-center gap-1.5">
        {source.length === 0 ? null : (
          <span className="me-1 text-xs text-muted-foreground">{source.join(" · ")}</span>
        )}
        {phoneMeta ? (
          <span className="me-1 text-xs text-muted-foreground tabular-nums sm:hidden">
            {phoneMeta}
          </span>
        ) : null}
        {item.tags.map((tag) => (
          <Badge key={tag} variant="secondary">
            {tag}
            {canChange ? (
              <Button
                size="icon-tiny"
                variant="ghost-muted"
                aria-label={`Remove the tag ${tag}`}
                onClick={() => void onUpdate({ tags: item.tags.filter((entry) => entry !== tag) })}
              >
                <XIcon />
              </Button>
            ) : null}
          </Badge>
        ))}
        {!canChange ? null : editing === "tag" ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const typed = new FormData(event.currentTarget).get("tag");
              const next = withReadingTag(item.tags, typeof typed === "string" ? typed : "");
              if (next === null) onEditing(null);
              else void save({ tags: next });
            }}
          >
            <div className="w-28">
              <Input
                nativeInput
                autoFocus
                size="compact"
                name="tag"
                aria-label={`New tag for ${item.title}`}
                placeholder="Tag"
                maxLength={40}
                onBlur={() => onEditing(null)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") onEditing(null);
                }}
              />
            </div>
          </form>
        ) : (
          <Tip label="Add a tag">
            <Button
              size="icon-micro"
              variant="ghost-muted"
              aria-label={`Add a tag to ${item.title}`}
              onClick={() => onEditing("tag")}
            >
              <PlusIcon />
            </Button>
          </Tip>
        )}
      </div>
    </div>
  );
}

function ItemMenu({
  item,
  canChange,
  subjects,
  snoozed,
  onEditing,
  onUpdate,
  onSnooze,
  onRemove,
  onAsk,
}: Omit<ItemActions, "describing" | "onDoneABit"> & {
  readonly snoozed: boolean;
  readonly onEditing: (editing: Editing) => void;
}) {
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            size="icon-xs"
            variant="ghost-muted"
            aria-label={`More for ${item.title}`}
            disabled={!canChange}
          />
        }
      >
        <EllipsisIcon />
      </MenuTrigger>
      <MenuPopup align="end">
        <MenuItem onClick={() => onEditing("note")}>
          <NotebookPenIcon />
          {item.notes ? "Edit note" : "Add a note"}
        </MenuItem>
        <MenuItem onClick={() => onEditing("why")}>
          <LightbulbIcon />
          {item.why ? "Edit why" : "Say why"}
        </MenuItem>
        {item.doneAt !== undefined || snoozed ? null : (
          <MenuItem onClick={() => onEditing("progress")}>
            <FootprintsIcon />
            Done a bit…
          </MenuItem>
        )}
        {item.doneAt !== undefined ? null : snoozed ? (
          <MenuItem onClick={() => void onUpdate({ snoozedUntil: null })}>
            <SunriseIcon />
            Wake it now
          </MenuItem>
        ) : (
          <MenuSub>
            <MenuSubTrigger>
              <AlarmClockIcon />
              Snooze…
            </MenuSubTrigger>
            <MenuSubPopup>
              {SNOOZE_CHOICES.map(([choice, label]) => (
                <MenuItem key={choice} onClick={() => onSnooze(choice)}>
                  {label}
                </MenuItem>
              ))}
            </MenuSubPopup>
          </MenuSub>
        )}
        {subjects.length === 0 ? null : (
          <MenuSub>
            <MenuSubTrigger>
              <FolderIcon />
              Subject
            </MenuSubTrigger>
            <MenuSubPopup>
              <MenuRadioGroup
                value={readingSubjectOf(item, subjects)?.id ?? NO_SUBJECT}
                onValueChange={(chosen) =>
                  void onUpdate({ subjectId: chosen === NO_SUBJECT ? null : String(chosen) })
                }
              >
                <MenuRadioItem value={NO_SUBJECT} closeOnClick>
                  No subject
                </MenuRadioItem>
                {subjects.map((subject) => (
                  <MenuRadioItem key={subject.id} value={subject.id} closeOnClick>
                    {subject.name}
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </MenuSubPopup>
          </MenuSub>
        )}
        <MenuSub>
          <MenuSubTrigger>
            <PencilIcon />
            Edit details
          </MenuSubTrigger>
          <MenuSubPopup>
            <MenuItem onClick={() => onEditing("title")}>
              <PencilIcon />
              Rename
            </MenuItem>
            <MenuItem onClick={() => onEditing("length")}>
              <ClockIcon />
              Change length
            </MenuItem>
            {item.url === null ? null : (
              <MenuItem onClick={() => void onUpdate({ lookUp: true, enrich: true })}>
                <RefreshCwIcon />
                Look it up again
              </MenuItem>
            )}
            <MenuSeparator />
            <MenuGroup>
              <MenuGroupLabel>Kind</MenuGroupLabel>
              <MenuRadioGroup
                value={item.kind}
                onValueChange={(chosen) => {
                  const kind = MAJORDOME_READING_KINDS.find((entry) => entry === chosen);
                  if (kind !== undefined && kind !== item.kind) void onUpdate({ kind });
                }}
              >
                {MAJORDOME_READING_KINDS.map((kind) => (
                  <MenuRadioItem key={kind} value={kind} closeOnClick>
                    {READING_KIND_NAMES[kind]}
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </MenuGroup>
          </MenuSubPopup>
        </MenuSub>
        {onAsk !== null ? (
          <>
            <MenuSeparator />
            <MenuItem onClick={onAsk}>
              <MessageCircleQuestionIcon />
              Ask the assistant about this
            </MenuItem>
          </>
        ) : null}
        <MenuSeparator />
        <MenuItem variant="destructive" onClick={onRemove}>
          <TrashIcon />
          Remove
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}

function ReadingRow({
  now,
  snoozed,
  draggable,
  handleGap,
  highlighted,
  ...actions
}: ItemActions & {
  readonly now: Date;
  /** Waiting for its day, in the Snoozed group. */
  readonly snoozed: boolean;
  readonly draggable: boolean;
  /** Keeps a row without a handle in line with the rows that have one. */
  readonly handleGap: boolean;
  readonly highlighted: boolean;
}) {
  const { item, canChange, onUpdate, onFinished } = actions;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled: !draggable,
  });
  const [editing, setEditing] = useState<Editing>(null);
  const done = item.doneAt !== undefined;
  const length = readingLengthWords(item);
  const when = snoozed
    ? readingBackOnWords(item.snoozedUntil ?? "", now)
    : readingAddedWords(item.addedAt, now);

  return (
    <li
      id={rowElementId(item.id)}
      data-reading-id={item.id}
      data-dragging={isDragging ? "" : undefined}
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "relative flex items-start gap-3 border-t border-border py-3",
        highlighted && "bg-accent/60",
        isDragging &&
          "z-10 rounded-lg border-transparent bg-background shadow-lg ring-1 ring-border",
      )}
    >
      {draggable ? (
        <span className="-mx-1.5 flex h-9 shrink-0 items-center">
          <Tip label={MOVE_HELP}>
            <Button
              size="icon-xs"
              variant="ghost-muted"
              {...attributes}
              {...listeners}
              aria-label={`Move ${item.title}`}
            >
              <GripVerticalIcon />
            </Button>
          </Tip>
        </span>
      ) : handleGap ? (
        <span aria-hidden className="-mx-1.5 w-6 shrink-0" />
      ) : null}
      <ItemTile item={item} dimmed={done || snoozed} />
      <ItemText
        {...actions}
        phoneMeta={[length, when].filter(Boolean).join(" · ")}
        editing={editing}
        onEditing={setEditing}
      />
      <div className="flex shrink-0 items-center gap-1">
        <div className="me-1 hidden flex-col items-end text-xs text-muted-foreground tabular-nums sm:flex">
          {length !== null ? <span>{length}</span> : null}
          <span>{when}</span>
        </div>
        <Tip label={item.starred === true ? "Take the star off" : "Star: you would recommend it"}>
          <Button
            size="icon-xs"
            variant="ghost-muted"
            aria-label={`Star ${item.title}`}
            aria-pressed={item.starred === true}
            disabled={!canChange}
            onClick={() => void onUpdate({ starred: item.starred !== true })}
          >
            <StarIcon className={item.starred === true ? "fill-warning text-warning" : undefined} />
          </Button>
        </Tip>
        <ItemMenu {...actions} snoozed={snoozed} onEditing={setEditing} />
        <Tip label={done ? "Finished. Bring it back" : "Mark as finished"}>
          <Button
            size="icon-xs"
            variant="ghost-muted"
            aria-label={`Finished: ${item.title}`}
            aria-pressed={done}
            disabled={!canChange}
            onClick={() => (done ? void onUpdate({ done: false }) : onFinished())}
          >
            <CircleCheckIcon className={done ? "text-success" : undefined} />
          </Button>
        </Tip>
      </div>
    </li>
  );
}

/** Something removed: it can be put back, or deleted for good. */
function TrashRow({
  item,
  canChange,
  onPutBack,
  onDelete,
}: {
  readonly item: MajordomeReadingItem;
  readonly canChange: boolean;
  readonly onPutBack: () => void;
  readonly onDelete: () => void;
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border py-3">
      <ItemTile item={item} dimmed />
      <div className="flex min-w-0 flex-1 basis-40 flex-col gap-0.5">
        <p className="min-w-0 text-sm wrap-break-word text-muted-foreground">{item.title}</p>
        {item.site ? <span className="text-xs text-muted-foreground">{item.site}</span> : null}
      </div>
      {canChange ? (
        <div className="flex shrink-0 items-center gap-1.5">
          <Button size="xs" variant="outline" onClick={onPutBack}>
            Put back
          </Button>
          <Button size="xs" variant="destructive-outline" onClick={onDelete}>
            Delete for good
          </Button>
        </div>
      ) : null}
    </li>
  );
}

/** One of the first things to do, with room to breathe and the answers that matter. */
function NextCard(actions: ItemActions) {
  const { item, canChange, onFinished, onSnooze } = actions;
  const [editing, setEditing] = useState<Editing>(null);

  return (
    <li id={rowElementId(item.id)} data-reading-id={item.id}>
      <Surface className="flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <ItemTile item={item} dimmed={false} large />
          <ItemText
            {...actions}
            large
            length={readingLengthWords(item)}
            editing={editing}
            onEditing={setEditing}
          />
          <ItemMenu {...actions} snoozed={false} onEditing={setEditing} />
        </div>
        {canChange ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={onFinished}>
              <CheckIcon />
              Finished
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing("progress")}>
              Done a bit
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onSnooze("tomorrow")}>
              Not now
            </Button>
          </div>
        ) : null}
      </Surface>
    </li>
  );
}

/** A field in a row with its Save and Cancel; Escape cancels. */
function InlineEdit({
  label,
  initial,
  placeholder,
  inputMode,
  multiline = false,
  onSave,
  onCancel,
}: {
  readonly label: string;
  readonly initial: string;
  readonly placeholder?: string;
  readonly inputMode?: "numeric";
  readonly multiline?: boolean;
  /** Given what was typed, trimmed. */
  readonly onSave: (text: string) => void;
  readonly onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const field = {
    autoFocus: true,
    "aria-label": label,
    placeholder,
    value: draft,
    onKeyDown: (event: { readonly key: string }) => {
      if (event.key === "Escape") onCancel();
    },
  };
  return (
    <form
      className={cn("flex gap-2", multiline ? "flex-col" : "flex-wrap items-center")}
      onSubmit={(event) => {
        event.preventDefault();
        onSave(draft.trim());
      }}
    >
      {multiline ? (
        <Textarea
          {...field}
          size="sm"
          rows={2}
          maxLength={4000}
          onChange={(event) => setDraft(event.target.value)}
        />
      ) : (
        <div className="min-w-0 flex-1 basis-32">
          <Input
            nativeInput
            {...field}
            size="sm"
            inputMode={inputMode}
            maxLength={500}
            onChange={(event) => setDraft(event.target.value)}
          />
        </div>
      )}
      <div className="flex shrink-0 items-center gap-1.5">
        <Button type="submit" size="xs">
          Save
        </Button>
        <Button type="button" size="xs" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
