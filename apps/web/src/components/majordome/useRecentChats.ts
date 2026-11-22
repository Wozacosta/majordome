import { useQuietThreadShells } from "../../state/entities";
import { usePendingAssistantThreadKeys } from "./pendingAssistantThreads";
import { routineThreadKeys } from "./routines.logic";
import { selectRecentThreads, topicThreadKeys } from "./topics.logic";
import { useMajordomeVaults } from "./useMajordomeVaults";
import { useVaultRoutines } from "./useVaultRoutines";

/**
 * The shown notes folder's chats that belong to no topic: not a topic's chat or one listed under
 * it, not the assistant's own, and not a routine's, which are reached from where they belong.
 */
export function useRecentChats() {
  const threads = useQuietThreadShells();
  const { activeVault, copies } = useMajordomeVaults();
  const pending = usePendingAssistantThreadKeys();
  const { routines } = useVaultRoutines(activeVault);
  return selectRecentThreads(threads, {
    vault: activeVault,
    topicKeys: new Set([
      ...topicThreadKeys(copies),
      ...pending,
      ...routineThreadKeys(routines, threads),
    ]),
  });
}
