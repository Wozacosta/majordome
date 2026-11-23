/** How long a pressed "Sign in" still counts: a sign-in through the browser takes minutes. */
export const SIGN_IN_ASKED_FOR_MS = 30 * 60_000;

/**
 * Whether to add the connected servers to the account now. Only a sign-in the owner asked for
 * here adds them: a window that opens already signed in, or a server the owner removed since,
 * is left alone.
 */
export function addServersAfterSignIn(input: {
  /** When "Sign in" was last pressed and not yet acted on, or null. */
  readonly askedAt: number | null;
  readonly now: number;
  readonly signedIn: boolean;
  /** Whether the app has loaded the servers it is connected to. */
  readonly catalogReady: boolean;
}): "add" | "wait" | "never" {
  const { askedAt } = input;
  if (askedAt === null) return "never";
  const age = input.now - askedAt;
  if (age < 0 || age > SIGN_IN_ASKED_FOR_MS) return "never";
  return input.signedIn && input.catalogReady ? "add" : "wait";
}
