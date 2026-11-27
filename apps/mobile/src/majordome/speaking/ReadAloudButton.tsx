import { useGT, useLocale } from "gt-react-native";
import { memo, useEffect, useSyncExternalStore } from "react";
import { Pressable, type ColorValue } from "react-native";

import { SymbolView } from "../../components/ui/AppSymbol";
import { readAloud, setReadAloudAppLanguage } from "./platform";

const noSubscription = () => () => {};

/** "Read aloud" under a reply; "Stop" while that reply is being read. */
export const ReadAloudButton = memo(function ReadAloudButton(props: {
  /** Identifies the reply across the chats on this phone. */
  readonly replyKey: string;
  readonly markdown: string;
  readonly tintColor: ColorValue;
  readonly buttonSize: number;
  readonly iconSize: number;
}) {
  const gt = useGT();
  const locale = useLocale();
  const active = useSyncExternalStore(
    readAloud?.controller.subscribe ?? noSubscription,
    () => readAloud?.controller.isActive(props.replyKey) ?? false,
  );
  if (!readAloud) return null;
  const { controller } = readAloud;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        active ? gt("Stop", { $context: "stop reading aloud" }) : gt("Read aloud")
      }
      hitSlop={8}
      onPress={() => {
        setReadAloudAppLanguage(locale);
        void controller.toggle({ key: props.replyKey, markdown: props.markdown });
      }}
      style={({ pressed }) => ({
        width: props.buttonSize,
        height: props.buttonSize,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 9,
        opacity: pressed ? 0.52 : 1,
      })}
    >
      <SymbolView
        name={active ? "stop.fill" : "speaker.wave.2"}
        size={props.iconSize + 1}
        tintColor={props.tintColor}
        type="monochrome"
      />
    </Pressable>
  );
});

/** The key of a reply in a chat; `useStopReadAloudOnLeave` recognises its chat by the prefix. */
export const readAloudReplyKey = (chatKey: string, replyId: string) => `${chatKey}:${replyId}`;

/** Mounted by a chat: a reply of that chat stops being read when the chat is left. */
export function useStopReadAloudOnLeave(chatKey: string): void {
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the native voice outlives the screen; leaving the chat must silence it
  useEffect(
    () => () => {
      const state = readAloud?.controller.getState();
      if (state && state.status !== "idle" && state.key.startsWith(`${chatKey}:`)) {
        readAloud?.controller.stop();
      }
    },
    [chatKey],
  );
}
