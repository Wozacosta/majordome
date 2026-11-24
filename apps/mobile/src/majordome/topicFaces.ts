import type { MajordomeTopicIcon } from "@t3tools/contracts";
import type { TopicTone } from "@t3tools/shared/majordomeTopicIcons";
import type { SFSymbol } from "expo-symbols";

import type { FinishedTopic } from "./topic.logic";
import type { TopicRow } from "./today.logic";

/** The desktop's topic icons as the iPhone's own symbols. */
export const TOPIC_SYMBOLS: Record<MajordomeTopicIcon, SFSymbol> = {
  hash: "number",
  dumbbell: "dumbbell.fill",
  footprints: "figure.walk",
  wallet: "creditcard.fill",
  receipt: "doc.text.fill",
  bitcoin: "bitcoinsign.circle.fill",
  plane: "airplane",
  "heart-pulse": "heart.fill",
  "book-open": "book.fill",
  languages: "character.bubble.fill",
  briefcase: "briefcase.fill",
  home: "house.fill",
  utensils: "fork.knife",
  music: "music.note",
  code: "chevron.left.forwardslash.chevron.right",
  "pen-line": "pencil.line",
  users: "person.2.fill",
  leaf: "leaf.fill",
  car: "car.fill",
  lightbulb: "lightbulb.fill",
};

export const TONE_COLORS: Record<TopicTone, string> = {
  amber: "#f59e0b",
  orange: "#f97316",
  rose: "#f43f5e",
  pink: "#ec4899",
  fuchsia: "#d946ef",
  violet: "#8b5cf6",
  indigo: "#6366f1",
  sky: "#0ea5e9",
  cyan: "#06b6d4",
  teal: "#14b8a6",
  emerald: "#10b981",
  lime: "#84cc16",
};

/** The topics as the Chats list needs them, shared by its rows, its header and its footer. */
export interface ChatTopics {
  /** The topics drawn on their conversation's own row, by thread id. */
  readonly byThread: ReadonlyMap<string, TopicRow>;
  /** The topics with no row among the chats yet, listed above them. */
  readonly apart: ReadonlyArray<TopicRow>;
  /** Every topic's id, in the topics' own order. */
  readonly order: ReadonlyArray<string>;
  readonly finished: ReadonlyArray<FinishedTopic>;
  /** How many topics there are in all, whatever a search keeps. */
  readonly total: number;
  /** The topic being opened or changed, which waits for the server. */
  readonly busy: string | null;
  /** The topics whose other chats are shown under them; folded until asked. */
  readonly unfolded: ReadonlySet<string>;
  readonly toggleSideChats: (topicId: string) => void;
  /** The chats that are a routine's, by thread id, with the routine's name. */
  readonly routineOf: ReadonlyMap<string, string>;
  readonly hiddenRoutines: ReadonlyArray<string>;
  readonly setRoutineHidden: (title: string, hidden: boolean) => void;
  readonly open: (topic: { readonly id: string; readonly threadId: string | null }) => void;
  readonly startSideChat: (topic: { readonly id: string }) => void;
  readonly setFinished: (
    topic: { readonly id: string; readonly title: string },
    finished: boolean,
  ) => void;
}
