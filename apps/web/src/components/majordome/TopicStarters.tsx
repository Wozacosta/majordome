import type { EnvironmentId, ThreadId } from "@t3tools/contracts";

import { Button } from "../ui/button";
import { type ThreadTopic, topicOfThread } from "./topicFiles.logic";
import { TOPIC_CHIPS } from "./TopicStarters.logic";
import { useMajordomeVaults } from "./useMajordomeVaults";

/** The topic whose main chat this is, as the Files card resolves it; null for any other chat. */
export function useTopicChat(
  environmentId: EnvironmentId | null,
  threadId: ThreadId | null,
): ThreadTopic | null {
  const { copies } = useMajordomeVaults();
  return environmentId === null || threadId === null
    ? null
    : topicOfThread(copies, environmentId, threadId);
}

/** Quiet ways to pick a topic's chat back up. Hidden, the row keeps its height. */
export function TopicStarterChips(props: {
  readonly shown: boolean;
  /** `send` is true for a whole question, which goes off at once. */
  readonly onPick: (text: string, send: boolean) => void;
}) {
  return (
    <div
      data-topic-chips={props.shown ? "shown" : "reserved"}
      aria-hidden={props.shown ? undefined : true}
      inert={props.shown ? undefined : true}
      className={
        props.shown ? "flex flex-wrap gap-2 px-1 pb-2" : "invisible flex flex-wrap gap-2 px-1 pb-2"
      }
    >
      {TOPIC_CHIPS.map((chip) => (
        <Button
          key={chip.label}
          type="button"
          size="xs"
          variant="outline"
          onClick={() => props.onPick(chip.text, chip.send)}
        >
          {chip.label}
        </Button>
      ))}
    </div>
  );
}
