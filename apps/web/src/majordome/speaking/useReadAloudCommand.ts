import { useGT, useLocale } from "gt-react";
import { useSyncExternalStore } from "react";

import { setReadAloudAppLanguage } from "./appLanguage";
import { useReadAloud } from "./useReadAloud";

const noSubscription = () => () => {};

/** The command palette's entry: read the newest reply on screen, or stop the one being read. */
export function useReadAloudCommand(): {
  readonly title: string;
  readonly run: () => Promise<void>;
} | null {
  const gt = useGT();
  const locale = useLocale();
  const runtime = useReadAloud();
  const reading = useSyncExternalStore(
    runtime?.controller.subscribe ?? noSubscription,
    () => runtime !== null && runtime.controller.getState().status !== "idle",
  );
  const readable = useSyncExternalStore(
    runtime?.replies.subscribe ?? noSubscription,
    () => runtime !== null && runtime.replies.latest() !== null,
  );
  if (!runtime || (!reading && !readable)) return null;
  return {
    title: reading ? gt("Stop reading aloud") : gt("Read the latest reply aloud"),
    run: () => {
      setReadAloudAppLanguage(locale);
      return runtime.toggleLatest();
    },
  };
}
