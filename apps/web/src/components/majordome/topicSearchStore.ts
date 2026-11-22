import { create } from "zustand";

/** Whether the "Go to a topic" search is showing; a store so the command palette can open it. */
export const useTopicSearchStore = create<{ readonly open: boolean }>(() => ({ open: false }));

export function setTopicSearchOpen(open: boolean | ((shown: boolean) => boolean)): void {
  useTopicSearchStore.setState((state) => ({
    open: typeof open === "function" ? open(state.open) : open,
  }));
}
