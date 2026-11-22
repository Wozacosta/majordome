import { Button } from "../ui/button";
import type { ThreadTopic } from "./topicFiles.logic";
import { TopicIconBadge } from "./TopicIcon";
import { topicWelcomeStarters } from "./TopicStarters.logic";

/** The first screen of a topic's chat, before anything has been said in it. */
export function TopicWelcome(props: {
  readonly found: ThreadTopic;
  /** The message box's height, so the welcome sits in the space above it. */
  readonly bottomInset: number;
  /** Puts the start of a sentence in the message box, without sending it. */
  readonly onStart: (text: string) => void;
}) {
  const { topic } = props.found;
  return (
    <div
      data-topic-welcome={topic.id}
      className="chat-composer-lane pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden"
      style={{ paddingBottom: props.bottomInset }}
    >
      <div className="pointer-events-auto flex w-full max-w-md flex-col items-center gap-3 py-6 text-center">
        <TopicIconBadge topic={topic} statusDotClass={null} className="size-12 [&_svg]:size-6" />
        <h1 className="font-normal text-2xl text-foreground tracking-tight">{topic.title}</h1>
        <p className="text-sm text-muted-foreground">
          This is where you and the assistant keep everything about {topic.title}.
        </p>
        <div className="mt-1 flex flex-wrap justify-center gap-2">
          {topicWelcomeStarters(topic.title).map((starter) => (
            <Button
              key={starter.label}
              type="button"
              size="sm"
              variant="outline"
              onClick={() => props.onStart(starter.text)}
            >
              {starter.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
