import { Button } from "../ui/button";
import { useTopicActions } from "./TopicHeaderActions";
import { TopicGlyph } from "./TopicIcon";
import type { MajordomeVault } from "./topics.logic";
import { useOpenTopic } from "./useOpenTopic";

/** On Today while the notes have no topic at all: the ready-made ones, one click from a start. */
export function TodayFirstTopics({ vault }: { readonly vault: MajordomeVault }) {
  const openTopic = useOpenTopic(vault);
  const actions = useTopicActions(vault, {
    onCreated: async (topic) => {
      await openTopic(
        { ...topic, threadEnvironmentId: vault.environmentId },
        { justCreated: true },
      );
    },
  });
  const ready = vault.readyTopics ?? [];
  return (
    <>
      {vault.topics.length === 0 && ready.length > 0 ? (
        <section className="mt-8" aria-label="Start a topic">
          <h2 className="mb-2 text-2xs font-semibold uppercase tracking-widest text-primary">
            Start a topic
          </h2>
          <div className="flex flex-wrap gap-2">
            {ready.map((topic) => (
              <Button
                key={topic.id}
                type="button"
                size="sm"
                variant="outline"
                title={topic.description}
                onClick={() => actions.openDialog({ kind: "create", readyMade: topic.id })}
              >
                <TopicGlyph icon={topic.icon} />
                {topic.title}
              </Button>
            ))}
          </div>
        </section>
      ) : null}
      {actions.dialogs}
    </>
  );
}
