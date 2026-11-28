import { resetRootStack, type RootStackNavigation } from "../lib/root-stack-reset";

type RouteLike = { readonly name: string; readonly key?: string; readonly params?: object };

/**
 * The root stack showing the Today page over the chat list. It takes the place of whatever was
 * open above the list, as a chat picked from the list does, so Back returns to the list. Home and
 * a Today page already there keep their keys, so opening it twice doesn't rebuild either.
 */
export function todayNavigationState<State extends { readonly routes: readonly RouteLike[] }>(
  state: State,
) {
  const home = state.routes.find((route) => route.name === "Home") ?? { name: "Home" };
  const today = state.routes.find((route) => route.name === "Today") ?? { name: "Today" };
  return { ...state, index: 1, routes: [home, today] };
}

/** Opens the Today page from the chat list; `navigation` is what `openSettings` takes. */
export function openToday(navigation: RootStackNavigation): void {
  resetRootStack(navigation, todayNavigationState);
}
