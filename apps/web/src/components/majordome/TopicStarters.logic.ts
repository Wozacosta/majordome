/** What the empty message box of a topic's main chat says. */
export function topicComposerPlaceholder(name: string): string {
  return `Message about ${name}, or tell me what to remember`;
}

/** Ways into a topic's first message: each puts the start of a sentence in the message box. */
export function topicWelcomeStarters(name: string) {
  return [
    { label: "Tell it the situation", text: `Here's where things stand with ${name}: ` },
    { label: "Add a document", text: `I'm adding a document about ${name}: ` },
    { label: "Set a regular check-in", text: `Every week, check in with me about ${name} and ` },
  ] as const;
}

/** Offered above the message box of a topic's chat that is already under way. */
export const TOPIC_CHIPS = [
  { label: "Where are we?", text: "Where are we?" },
  { label: "What's next?", text: "What's next?" },
  { label: "Remind me…", text: "Remind me to " },
] as const;

/**
 * Whether the chips show above a chat's message box. "reserved" keeps their row's height while
 * they are hidden, so typing a first letter or the assistant starting does not move the chat.
 */
export function topicChipsState(input: {
  readonly isTopicChat: boolean;
  readonly hasMessages: boolean;
  readonly boxEmpty: boolean;
  readonly working: boolean;
  /** A question, an approval or anything else that owns the message box. */
  readonly boxTaken: boolean;
}): "none" | "reserved" | "shown" {
  if (!input.isTopicChat || !input.hasMessages) return "none";
  return input.boxEmpty && !input.working && !input.boxTaken ? "shown" : "reserved";
}

/** The first lines of a topic's standing, for the strip folded to one line. */
export function standingFirstLine(text: string): string {
  return (
    text
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line !== "") ?? ""
  );
}

/** Folded when the owner said so for this topic; otherwise only where the window is narrow. */
export function standingCollapsed(
  choices: Readonly<Record<string, boolean>>,
  topicId: string,
  narrow: boolean,
): boolean {
  return choices[topicId] ?? narrow;
}
