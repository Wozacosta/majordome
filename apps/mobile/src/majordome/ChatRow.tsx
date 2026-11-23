import { SymbolView as ExpoSymbolView, type SFSymbol } from "expo-symbols";
import type { ReactNode } from "react";
import { View } from "react-native";
import { withUniwind } from "uniwind";

import { AppText as Text } from "../components/ui/AppText";
import { cn } from "../lib/cn";
import { chatWantsAttention, type ChatLine, type ChatLineTone } from "./chat.logic";

// The shared symbol component only takes the names upstream uses; topics wear others.
const SymbolView = withUniwind(ExpoSymbolView);

const LINE_TONES: Record<ChatLineTone, string> = {
  plain: "text-foreground-muted",
  working: "text-adaptive-sky-600-400",
  asking: "text-warning-foreground",
  problem: "text-danger-foreground",
  new: "text-foreground",
};

/** The section labels of the Chats list, drawn like upstream's "Done" shelf label. */
export function ChatListLabel(props: { readonly children: string }) {
  return (
    <View className="mb-1.5 mt-4 flex-row items-center gap-2.5 px-5">
      <Text accessibilityRole="header" className="text-xs font-t3-medium text-foreground-tertiary">
        {props.children}
      </Text>
      <View className="h-px flex-1 bg-border" />
    </View>
  );
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
  /** Small marks before the time, such as a pin. */
  readonly marks?: ReactNode;
  /** Drawn under the title in place of the line, such as what a search found. */
  readonly children?: ReactNode;
}) {
  const selected = props.selected === true;
  const attention = chatWantsAttention(props.line);
  return (
    <View className={cn("flex-row items-center gap-3", props.faded && "opacity-55")}>
      <View
        className={cn(
          "size-11 items-center justify-center rounded-full",
          props.color === undefined && "bg-subtle",
        )}
        style={props.color === undefined ? undefined : { backgroundColor: `${props.color}26` }}
      >
        {props.color === undefined ? (
          <SymbolView name={props.symbol} size={20} tintColorClassName="accent-icon-muted" />
        ) : (
          <SymbolView name={props.symbol} size={22} tintColor={props.color} />
        )}
      </View>
      <View className="min-w-0 flex-1 gap-0.5">
        <View className="flex-row items-center gap-2">
          <Text
            numberOfLines={1}
            className={cn(
              "flex-1 text-base",
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
                selected ? "text-thread-selected-foreground-muted" : "text-foreground-tertiary",
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
      </View>
    </View>
  );
}
