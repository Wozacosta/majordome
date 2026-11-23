import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { MajordomeSkill } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { useState } from "react";

import { majordomeEnvironment } from "../../state/majordome";
import { useAtomCommand } from "../../state/use-atom-command";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { MajordomeSettingsPage } from "./MajordomeSettingsPage";
import { Disclosure, Entry, EntryList, ListSkeleton, LoadFailed, Muted, Section } from "./paper";
import { skillTitle } from "./skills.logic";
import type { MajordomeVault } from "./topics.logic";
import { useMajordomeVaults } from "./useMajordomeVaults";

/** What the assistant knows how to do, and what it wrote for itself and waits to be allowed to use. */
export function SkillsPage() {
  const { activeVault, loading } = useMajordomeVaults();
  return (
    <MajordomeSettingsPage
      searchId="majordome-skills"
      intro="What your assistant knows how to do, step by step. It can write new skills for itself as it works with you; it uses one only after you say yes here."
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
  const [busy, setBusy] = useState<string | null>(null);

  const decide = async (
    name: string,
    run: () => ReturnType<typeof keepSkill> | ReturnType<typeof removeSkill>,
    done: { readonly title: string; readonly description?: string },
    failed: string,
  ) => {
    setBusy(name);
    const outcome = await run();
    setBusy(null);
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

  return (
    <>
      {!canChange ? (
        <Muted className="mt-6">
          You can look at skills from this device, but it isn't allowed to keep or remove them.
        </Muted>
      ) : null}
      {data.proposed.length > 0 ? (
        <Section label="Waiting for your yes">
          <EntryList aria-label="Waiting for your yes">
            {data.proposed.map((skill) => (
              <SkillEntry
                key={skill.name}
                skill={skill}
                aside={
                  skill.replaces ? <Badge variant="secondary">Replaces the one in use</Badge> : null
                }
                actions={
                  canChange ? (
                    <>
                      <Button
                        size="sm"
                        disabled={busy !== null}
                        onClick={() =>
                          void decide(
                            skill.name,
                            () =>
                              keepSkill({ environmentId, input: { projectId, name: skill.name } }),
                            {
                              title: `Kept: ${skillTitle(skill.name)}`,
                              description: "Your assistant uses it from its next conversation.",
                            },
                            "Could not keep that skill",
                          )
                        }
                      >
                        Keep
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy !== null}
                        onClick={() =>
                          void decide(
                            skill.name,
                            () =>
                              removeSkill({
                                environmentId,
                                input: { projectId, name: skill.name, proposed: true },
                              }),
                            { title: `Deleted: ${skillTitle(skill.name)}` },
                            "Could not delete that skill",
                          )
                        }
                      >
                        Delete
                      </Button>
                    </>
                  ) : null
                }
              />
            ))}
          </EntryList>
        </Section>
      ) : null}
      <Section label="In use">
        {data.skills.length === 0 ? (
          <Muted>
            No skills in use. Tell your assistant how you want something done "from now on" and it
            writes one for you to keep.
          </Muted>
        ) : (
          <EntryList aria-label="In use">
            {data.skills.map((skill) => (
              <SkillEntry
                key={skill.name}
                skill={skill}
                actions={
                  canChange ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy !== null}
                      onClick={() =>
                        void decide(
                          skill.name,
                          () =>
                            removeSkill({
                              environmentId,
                              input: { projectId, name: skill.name, proposed: false },
                            }),
                          {
                            title: `Stopped using: ${skillTitle(skill.name)}`,
                            description: "It waits at the top of this page; Keep brings it back.",
                          },
                          "Could not stop using that skill",
                        )
                      }
                    >
                      Stop using
                    </Button>
                  ) : null
                }
              />
            ))}
          </EntryList>
        )}
      </Section>
    </>
  );
}

function SkillEntry({
  skill,
  aside,
  actions,
}: {
  readonly skill: MajordomeSkill;
  readonly aside?: React.ReactNode;
  readonly actions: React.ReactNode;
}) {
  return (
    <Entry
      title={skillTitle(skill.name)}
      aside={aside}
      meta={skill.description === "" ? undefined : skill.description}
      actions={actions}
      data-skill={skill.name}
    >
      <Disclosure summary="Read it">
        <pre className="max-h-96 overflow-auto rounded-md bg-secondary p-3 font-mono text-xs whitespace-pre-wrap text-foreground">
          {skill.text}
        </pre>
      </Disclosure>
    </Entry>
  );
}
