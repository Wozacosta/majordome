/**
 * The welcome a new notes folder's owner gets once, on the computer or the phone: what to call
 * them, then how Majordome works in three short cards. Both clients show these words.
 */

export interface WelcomeCard {
  readonly key: "name" | "tell" | "topics" | "routines";
  readonly title: string;
  readonly body: string;
}

export const WELCOME_NAME_PLACEHOLDER = "A name or a nickname";
export const WELCOME_SKIP_LABEL = "Skip";
export const WELCOME_NEXT_LABEL = "Next";
export const WELCOME_DONE_LABEL = "Got it";

const NAME_CARD: WelcomeCard = {
  key: "name",
  title: "Welcome. What should I call you?",
  body: "I'm your assistant. I keep your notes and work from them.",
};

const TOUR: ReadonlyArray<WelcomeCard> = [
  {
    key: "tell",
    title: "Tell me anything",
    body: "Ask a question or say what to remember. I answer, and keep what matters in your notes.",
  },
  {
    key: "topics",
    title: "Topics for what goes on",
    body: "A move, your taxes, a trip: give it a topic, one chat with its own notes.",
  },
  {
    key: "routines",
    title: "I work while you're away",
    body: "A morning brief, a weekly review, a reminder. Ask me to set one up.",
  },
];

/** The cards to show: the name is asked only when the notes do not have one yet. */
export function welcomeCards(name: string | null): ReadonlyArray<WelcomeCard> {
  if (name === null) return [NAME_CARD, ...TOUR];
  const [first, ...rest] = TOUR;
  return first === undefined
    ? []
    : [{ ...first, title: `Welcome, ${name}. ${first.title}` }, ...rest];
}
