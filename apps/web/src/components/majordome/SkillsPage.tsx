import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { AsyncResult } from "effect/reactivity";
import { ChevronRightIcon, SearchIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { majordomeEnvironment } from "../../state/majordome";
import { useAtomCommand } from "../../state/use-atom-command";
import ChatMarkdown from "../ChatMarkdown";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { toastManager } from "../ui/toast";
import { MajordomeSettingsPage } from "./MajordomeSettingsPage";
import { ListSkeleton, LoadFailed, Muted, ROW_ACTION_CLASS, Section } from "./paper";
import {
  SKILL_SOURCE_LABELS,
  SKILL_STATE_LABELS,
  type SkillRow,
  type SkillSourceFilter,
  skillRows,
  skillsView,
} from "./skills.logic";
import type { MajordomeVault } from "./topics.logic";
import { useMajordomeVaults } from "./useMajordomeVaults";

const FOCUS_RING =
  "outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

/** What the assistant knows how to do, and what it wrote for itself and waits to be allowed to use. */
export function SkillsPage() {
  const { activeVault, loading } = useMajordomeVaults();
  return (
    <MajordomeSettingsPage
      searchId="majordome-skills"
      intro="Your assistant uses a skill it wrote only after you say yes here."
      outline={false}
    >
      {activeVault !== null ? (
        <VaultSkills key={activeVault.key} vault={activeVault} />
      ) : loading ? (
        <Section>
          <ListSkeleton />
        </Section>
      ) : (
        <Section>
          <Muted>Open a notes folder to see its skills.</Muted>
        </Section>
      )}
    </MajordomeSettingsPage>
  );
}

function VaultSkills({ vault }: { readonly vault: MajordomeVault }) {
  const { environmentId, projectId } = vault;
  const skillsAtom = majordomeEnvironment.skills({ environmentId, input: { projectId } });
  const result = useAtomValue(skillsAtom);
  const retry = useAtomRefresh(skillsAtom);
  const canChange = useAtomValue(majordomeEnvironment.keepSkill.permissionAtom(environmentId));
  const keepSkill = useAtomCommand(majordomeEnvironment.keepSkill, {
    label: "keep skill",
    reportFailure: false,
  });
  const removeSkill = useAtomCommand(majordomeEnvironment.removeSkill, {
    label: "remove skill",
    reportFailure: false,
  });
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<SkillSourceFilter>("all");
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());

  const decide = async (
    run: () => ReturnType<typeof keepSkill> | ReturnType<typeof removeSkill>,
    done: { readonly title: string; readonly description?: string },
    failed: string,
  ) => {
    setBusy(true);
    const outcome = await run();
    setBusy(false);
    if (outcome._tag === "Success") {
      toastManager.add({ type: "success", ...done });
    } else if (!isAtomCommandInterrupted(outcome)) {
      const error = squashAtomCommandFailure(outcome);
      toastManager.add({
        type: "error",
        title: failed,
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };
  const keep = (skill: SkillRow) =>
    void decide(
      () => keepSkill({ environmentId, input: { projectId, name: skill.name } }),
      {
        title: `${skill.state === "off" ? "In use again" : "Kept"}: ${skill.title}`,
        description: "Your assistant uses it from its next chat.",
      },
      "Could not keep that skill",
    );
  const remove = (skill: SkillRow) =>
    void decide(
      () =>
        removeSkill({
          environmentId,
          input: { projectId, name: skill.name, proposed: skill.state !== "inUse" },
        }),
      skill.state === "inUse"
        ? {
            title: `Stopped using: ${skill.title}`,
            description: "It is under Off on this page; Use again brings it back.",
          }
        : { title: `Deleted: ${skill.title}` },
      skill.state === "inUse" ? "Could not stop using that skill" : "Could not delete that skill",
    );

  const data = AsyncResult.getOrElse(result, () => null);
  if (data === null) {
    return (
      <Section>
        {result._tag === "Failure" ? (
          <LoadFailed onRetry={retry}>Couldn't load the skills.</LoadFailed>
        ) : (
          <ListSkeleton />
        )}
      </Section>
    );
  }

  const rows = skillRows(data);
  if (rows.length === 0) {
    return (
      <Section>
        <Muted>
          No skills yet. Tell your assistant how you want something done "from now on" and it writes
          one for you to keep.
        </Muted>
      </Section>
    );
  }
  const view = skillsView(rows, { query, source });

  return (
    <>
      {!canChange ? (
        <Muted className="mt-6">
          You can look at skills from this device, but it isn't allowed to keep or remove them.
        </Muted>
      ) : null}
      <div className="mt-6 flex flex-col gap-2">
        <InputGroup>
          <InputGroupAddon>
            <SearchIcon aria-hidden className="size-3.5" />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            name="skills-search"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== "Escape" || query === "") return;
              event.preventDefault();
              // Settings closes on Escape; the first one only empties the search.
              event.stopPropagation();
              setQuery("");
            }}
            placeholder="Search skills"
            aria-label="Search skills"
            spellCheck={false}
            size="sm"
          />
        </InputGroup>
        {view.tabs.length > 0 ? (
          <div
            role="tablist"
            aria-label="Where skills come from"
            className="-mx-1 flex gap-1 overflow-x-auto px-1 [scrollbar-width:none]"
          >
            {view.tabs.map((tab) => (
              <button
                key={tab.source}
                type="button"
                role="tab"
                aria-selected={view.source === tab.source}
                onClick={() => setSource(tab.source)}
                className={cn(
                  "flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-sm text-muted-foreground hover:text-foreground aria-selected:bg-accent aria-selected:font-medium aria-selected:text-foreground",
                  FOCUS_RING,
                )}
              >
                {tab.source === "all" ? "All" : SKILL_SOURCE_LABELS[tab.source]}{" "}
                <span className="text-xs font-normal text-muted-foreground tabular-nums">
                  {tab.count}
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {view.hiddenWaiting > 0 ? (
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2">
          <p role="status" className="min-w-0 flex-1 basis-40 text-sm text-foreground">
            {view.hiddenWaiting} waiting for your yes {view.hiddenWaiting === 1 ? "is" : "are"} not
            shown.
          </p>
          <Button
            size="xs"
            variant="outline"
            onClick={() => {
              setQuery("");
              setSource("all");
            }}
          >
            Show all
          </Button>
        </div>
      ) : null}
      {view.groups.length === 0 ? (
        <Section>
          <Muted className="border-t border-border py-3">No skills match.</Muted>
        </Section>
      ) : (
        view.groups.map((group) => (
          <Section
            key={group.state}
            label={SKILL_STATE_LABELS[group.state]}
            action={<span className="tabular-nums">{group.rows.length}</span>}
          >
            <ul aria-label={SKILL_STATE_LABELS[group.state]} className="m-0 list-none p-0">
              {group.rows.map((skill) => (
                <SkillEntry
                  key={skill.key}
                  skill={skill}
                  open={open.has(skill.key)}
                  onToggle={() => {
                    const next = new Set(open);
                    if (!next.delete(skill.key)) next.add(skill.key);
                    setOpen(next);
                  }}
                  actions={
                    !canChange ? null : skill.state === "inUse" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => remove(skill)}
                      >
                        Stop using
                      </Button>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          variant={skill.state === "waiting" ? "default" : "outline"}
                          disabled={busy}
                          onClick={() => keep(skill)}
                        >
                          {skill.state === "waiting" ? "Keep" : "Use again"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => remove(skill)}
                        >
                          Delete
                        </Button>
                      </>
                    )
                  }
                />
              ))}
            </ul>
          </Section>
        ))
      )}
    </>
  );
}

function SkillEntry({
  skill,
  open,
  onToggle,
  actions,
}: {
  readonly skill: SkillRow;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly actions: React.ReactNode;
}) {
  return (
    <li className="border-t border-border" data-skill={skill.name} data-state={skill.state}>
      <div className="flex items-start gap-2 py-1.5">
        <button
          type="button"
          aria-expanded={open}
          aria-label={`${open ? "Close" : "Read"} ${skill.title}`}
          onClick={onToggle}
          className={cn(
            ROW_ACTION_CLASS,
            "flex min-w-0 flex-1 cursor-pointer items-start gap-2 py-1.5 text-left",
          )}
        >
          <ChevronRightIcon
            aria-hidden
            className={cn("mt-0.5 size-4 shrink-0 text-muted-foreground", open && "rotate-90")}
          />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-sm font-medium text-foreground">{skill.title}</span>
              {skill.replaces ? <Badge variant="secondary">Replaces the one in use</Badge> : null}
              {skill.source === "other" ? null : (
                <Badge variant="outline">{SKILL_SOURCE_LABELS[skill.source]}</Badge>
              )}
            </span>
            {skill.description === "" ? null : (
              <span
                className={cn(
                  "text-xs text-muted-foreground",
                  !open && "line-clamp-2 sm:line-clamp-1",
                )}
              >
                {skill.description}
              </span>
            )}
          </span>
        </button>
        {actions ? <div className="flex shrink-0 items-center gap-1 pt-0.5">{actions}</div> : null}
      </div>
      {open ? (
        <div className="flex flex-col gap-3 pb-4 ps-6">
          <ChatMarkdown text={skill.text} cwd={undefined} className="text-sm" />
          <p className="font-mono text-2xs break-all text-muted-foreground">{skill.path}</p>
        </div>
      ) : null}
    </li>
  );
}
