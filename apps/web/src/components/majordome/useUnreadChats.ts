import { useQuietThreadShells } from "../../state/entities";
import { inFlightPlaces } from "./inFlight.logic";
import { routineThreadKeys } from "./routines.logic";
import { selectUnreadChats } from "./unread.logic";
import { useMajordomeVaults } from "./useMajordomeVaults";
import { useVaultRoutines } from "./useVaultRoutines";

/**
 * The shown notes folder's chats with a reply the owner has not read, on every server that has
 * it, read from what the chat lists already hold.
 */
export function useUnreadChats() {
  const threads = useQuietThreadShells();
  const { activeVault } = useMajordomeVaults();
  const { routines } = useVaultRoutines(activeVault);
  if (activeVault === null) return [];
  return selectUnreadChats({
    threads,
    vaults: activeVault.copies,
    places: inFlightPlaces(activeVault, routineThreadKeys(routines, threads)),
  });
}
