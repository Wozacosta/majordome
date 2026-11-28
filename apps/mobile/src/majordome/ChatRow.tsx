import type { SFSymbol } from "expo-symbols";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { AppText as Text } from "../components/ui/AppText";
import { cn } from "../lib/cn";
import { chatWantsAttention, type ChatLine, type ChatLineTone } from "./chat.logic";
import { needsYouLabel } from "./home.logic";
import { TopicSymbolView } from "./TopicSymbol";

export { TopicSymbolView };
const SymbolView = TopicSymbolView;

const LINE_TONES: Record<ChatLineTone, string> = {
  plain: "text-foreground-muted",
  working: "text-adaptive-sky-600-400",
  asking: "text-primary-text",
  problem: "text-danger-foreground",
  new: "text-primary-text",
};

const foldWords = (fold: { readonly count: number; readonly runs?: boolean }) =>
  fold.runs === true
    ? `${fold.count} earlier ${fold.count === 1 ? "run" : "runs"}`
    : `${fold.count} more ${fold.count === 1 ? "chat" : "chats"}`;

/** The section labels of the Chats list, drawn like upstream's "Done" shelf label. */
export function ChatListLabel(props: {
  readonly children: string;
  /** In the app's green: the chats that need the owner. */
  readonly accent?: boolean;
}) {
  return (
    <View className="mb-1.5 mt-4 flex-row items-center gap-2.5 px-5">
      <Text
        accessibilityRole="header"
        className={cn(
          "text-xs font-t3-medium",
          props.accent ? "text-primary-text" : "text-foreground-tertiary",
        )}
      >
        {props.children}
      </Text>
      <View className="h-px flex-1 bg-border" />
    </View>
  );
}

/** Over the first chat under the topics, which keep the top of the list. */
export function RecentChatsLabel() {
  return <ChatListLabel>Recent</ChatListLabel>;
}

/** Over the topics, said only when "Needs you" sits above them. */
export function TopicsLabel() {
  return <ChatListLabel>Topics</ChatListLabel>;
}

/** Over the chats that wait for the owner, with how many there are. */
export function NeedsYouLabel(props: { readonly count: number }) {
  return <ChatListLabel accent>{needsYouLabel(props.count)}</ChatListLabel>;
}

/**
 * One conversation as the Chats list draws it, topic or chat alike: a round picture, the title
 * with when it last moved, and one line saying what is going on in it.
 */
export function ChatRowContent(props: {
  readonly title: string;
  readonly symbol: SFSymbol;
  /** A topic's own colour; a plain chat has none. */
  readonly color?: string | undefined;
  readonly line: ChatLine | null;
  readonly time: string | null;
  /** The chat open beside the list on a wide screen. */
  readonly selected?: boolean;
  /** A chat marked as done. */
  readonly faded?: boolean;
  /** A topic's other chats, folded under it until its count is pressed. */
  readonly sideChats?:
    | {
        readonly count: number;
        readonly unfolded: boolean;
        readonly onToggle: () => void;
        /** A routine's fold holds its earlier runs rather than other chats. */
        readonly runs?: boolean;
      }
    | undefined;
  /** One of a topic's other chats, drawn smaller under the topic. */
  readonly nested?: boolean;
  /** Small marks before the time, such as a pin. */
  readonly marks?: ReactNode;
  /** Drawn under the title in place of the line, such as what a search found. */
  readonly children?: ReactNode;
}) {
  const selected = props.selected === true;
  const attention = chatWantsAttention(props.line);
  const nested = props.nested === true;
  const sideChats = props.sideChats;
  return (
    <View
      className={cn("flex-row items-center gap-3", props.faded && "opacity-55", nested && "pl-14")}
    >
      <View
        className={cn(
          "items-center justify-center rounded-full",
          nested ? "size-7" : "size-11",
          props.color === undefined && "bg-subtle",
        )}
        style={props.color === undefined ? undefined : { backgroundColor: `${props.color}26` }}
      >
        {props.color === undefined ? (
          <SymbolView
            name={props.symbol}
            size={nested ? 13 : 20}
            tintColorClassName="accent-icon-muted"
          />
        ) : (
          <SymbolView name={props.symbol} size={22} tintColor={props.color} />
        )}
      </View>
      <View className="min-w-0 flex-1 gap-0.5">
        <View className="flex-row items-center gap-2">
          <Text
            numberOfLines={1}
            className={cn(
              "flex-1",
              nested ? "text-sm" : "text-base",
              attention ? "font-t3-bold" : "font-t3-medium",
              selected ? "text-thread-selected-foreground" : "text-foreground",
            )}
          >
            {props.title}
          </Text>
          {props.marks}
          {props.time ? (
            <Text
              className={cn(
                "text-xs tabular-nums",
                selected
                  ? "text-thread-selected-foreground-muted"
                  : attention
                    ? "font-t3-medium text-primary-text"
                    : "text-foreground-tertiary",
              )}
            >
              {props.time}
            </Text>
          ) : null}
        </View>
        {props.children ??
          (props.line ? (
            <View className="flex-row items-center gap-2">
              <Text
                numberOfLines={1}
                className={cn(
                  "flex-1 text-sm",
                  selected ? "text-thread-selected-foreground-muted" : LINE_TONES[props.line.tone],
                )}
              >
                {props.line.words}
              </Text>
              {attention ? <View className="size-2.5 rounded-full bg-primary" /> : null}
            </View>
          ) : null)}
        {sideChats !== undefined && sideChats.count > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: sideChats.unfolded }}
            accessibilityLabel={`${foldWords(sideChats)} of ${props.title}`}
            hitSlop={10}
            onPress={sideChats.onToggle}
            className="mt-1 flex-row items-center gap-1 self-start rounded-full bg-subtle px-2.5 py-1"
          >
            <Text className="text-xs font-t3-medium text-foreground-muted">
              {foldWords(sideChats)}
            </Text>
            <SymbolView
              name={sideChats.unfolded ? "chevron.up" : "chevron.down"}
              size={9}
              tintColorClassName="accent-icon-muted"
            />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
