import { useNavigation } from "@react-navigation/native";
import { voiceDownloadMegabytes } from "@t3tools/client-runtime/speaking/voice-catalog";
import { NetworkStateType, useNetworkState } from "expo-network";
import { useGT } from "gt-react-native";
import { useEffect, useSyncExternalStore } from "react";

import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { FitSheet } from "../../components/ui/FitSheet";
import { Progress } from "../../components/ui/Progress";
import { SheetHeader } from "../../components/ui/SheetHeader";
import { readAloud } from "./platform";

const noSubscription = () => () => {};
const ABSENT = { status: "absent" } as const;

/** First use of the voice: its size, one button, and the progress of the download. */
export function VoiceDownloadSheet() {
  const gt = useGT();
  const navigation = useNavigation();
  const network = useNetworkState();
  const state = useSyncExternalStore(
    readAloud?.store.subscribe ?? noSubscription,
    () => readAloud?.store.getState() ?? ABSENT,
  );
  const ready = state.status === "ready";

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the sheet has nothing left to offer once the files are on the phone
  useEffect(() => {
    if (ready) navigation.goBack();
  }, [ready, navigation]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a reply waiting for the download is forgotten when the sheet is dismissed
  useEffect(() => () => readAloud?.dismissDownload(), []);

  const megabytes = voiceDownloadMegabytes();
  return (
    <FitSheet
      // Android's default suits rows that bring their own padding; this sheet is plain text.
      contentContainerClassName="gap-4 px-5 pt-2"
      header={
        <SheetHeader
          title={gt("Voice")}
          onClose={() => {
            readAloud?.store.cancel();
            navigation.goBack();
          }}
        />
      }
    >
      {state.status === "downloading" ? (
        <>
          <Progress
            value={state.received / state.total}
            label={gt("Downloading the voice")}
            className="pt-2"
          />
          <Text className="text-sm text-foreground-muted">
            {gt("{received} of {megabytes} MB", {
              received: Math.floor((megabytes * state.received) / state.total),
              megabytes,
            })}
          </Text>
        </>
      ) : (
        <>
          <Text
            className={
              state.status === "failed"
                ? "text-sm text-danger-foreground"
                : "text-sm text-foreground-muted"
            }
          >
            {state.status !== "failed"
              ? gt("{megabytes} MB, downloaded once.", { megabytes })
              : state.reason === "verification"
                ? gt("The download was damaged. Try again.")
                : gt("The download stopped. Try again.")}
          </Text>
          <Button
            fullWidth
            tone="primary"
            label={
              network.type === NetworkStateType.CELLULAR
                ? gt("Download on mobile data")
                : gt("Download")
            }
            onPress={() => void readAloud?.download()}
          />
        </>
      )}
    </FitSheet>
  );
}
