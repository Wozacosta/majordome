import { useAtomValue } from "@effect/atom-react";
import { useEffect, type ReactNode } from "react";
import { View } from "react-native";

import { AppText as Text } from "../components/ui/AppText";
import { useWorkspaceState } from "../state/workspace";
import { newChatStart, type NewChatStart } from "./newChat.logic";
import { loadTodayStore, todayStoreAtom } from "./todayStore";
import { MajordomeNewChatTopics } from "./TopicsSection";
import { useVault } from "./useVault";

/** Where a new chat starts, from the notes folder this phone knows or last saw. */
export function useNewChatStart(resumesDraft: boolean): NewChatStart {
  const store = useAtomValue(todayStoreAtom);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads the phone's saved copy of the notes folder, in case Today was never opened
  useEffect(() => {
    void loadTodayStore();
  }, []);
  const { vault } = useVault(store);
  const { state } = useWorkspaceState();
  return newChatStart({
    vault,
    resumesDraft,
    stillLoading:
      store === null ||
      state.isLoadingConnections ||
      (!state.hasLoadedShellSnapshot &&
        state.hasConnectingEnvironment &&
        state.connectionError === null),
  });
}

/** What a new chat shows above the message box. */
export function MajordomeNewChatHero(props: {
  readonly connected: boolean;
  /** The computer picker, when there is more than one computer to choose from. */
  readonly computerChoice: ReactNode;
  readonly notice: ReactNode;
  /** The draft being written, whose words follow into a topic touched here. */
  readonly draftKey: string | null;
}) {
  return (
    <View className="items-center gap-2 px-8" testID="new-task-hero">
      <Text className="text-center text-2xl font-t3-medium tracking-tight text-foreground">
        What's on your mind?
      </Text>
      <Text className="text-center text-foreground-muted">
        Ask anything, or tell me what to remember.
      </Text>
      {props.computerChoice}
      {props.connected ? null : (
        <Text textRole="footnote" className="pt-2 text-center text-foreground-muted">
          Your computer can't be reached right now. Write your message anyway: it is sent as soon as
          the computer is back.
        </Text>
      )}
      {props.notice}
      {props.connected ? <MajordomeNewChatTopics draftKey={props.draftKey} /> : null}
    </View>
  );
}

/** Shown in place of a new chat while the notes folder is unknown. */
export function MajordomeNewChatUnavailable(props: { readonly looking: boolean }) {
  return (
    <View className="flex-1 items-center justify-center bg-screen px-8">
      {props.looking ? (
        <Text className="text-center text-foreground-muted">Looking for your notes…</Text>
      ) : (
        <>
          <Text textRole="title" className="text-center font-t3-bold text-foreground">
            Your notes can't be found
          </Text>
          <Text className="mt-2 text-center text-foreground-muted">
            Check that your computer is on. If Majordome is new there, open it and choose a notes
            folder first.
          </Text>
        </>
      )}
    </View>
  );
}
