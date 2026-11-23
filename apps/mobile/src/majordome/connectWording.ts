/** The "Add a computer" screen, said for someone who has never paired anything. */
export const MAJORDOME_CONNECT = {
  scanCaption:
    "On your computer, open Majordome and go to Settings, then Phone & notifications. Press “Show the code” and point this phone at it.",
  typeItHeading: "Or type it in",
  addressPlaceholder: "k7m2xq9d.majord.link",
  codePlaceholder: "The letters under the code",
  typeItHelp:
    "The address and the letters are on the same screen of your computer. A code works once, for a few minutes.",
  confirmHeading: "Connect this phone to",
  confirmHelp:
    "This is the computer whose code you just scanned. If you don't recognise the address, close this.",
  confirmButton: "Connect",
  confirmOther: "Scan or type another code",
  fromLinkHelp:
    "Filled in from the code you scanned. Check that the address is your computer's, then press Connect.",
  cameraDeniedTitle: "Majordome can't use the camera",
  cameraDenied:
    "The camera is only used to read the code on your computer. Allow it in Settings, or type the code in instead.",
  wrongCodeTitle: "That isn't a Majordome code",
  wrongCode:
    "Scan the code Majordome shows on your computer, under Settings, then Phone & notifications.",
  accountLabel: "Sign in to your Majordome account",
  accountDescription:
    "With a Majordome account, this phone finds your computer by itself. No code to scan.",
  hostedLabel: "No computer to leave on?",
  hostedDescription: "Majordome can keep one running for you. You need an invite code.",
} as const;

const REFUSED_CODE =
  /pairing code is unknown, expired, or already used|not a one-time pairing code/i;
const NO_ANSWER = /network request failed|failed to fetch|timed out|could not connect|unreachable/i;

/**
 * Why connecting failed, as the owner can act on it. The computer's own answers are written for
 * developers and arrive untranslated; anything not recognised is shown as it came.
 */
export function connectErrorForOwner(message: string): string {
  if (REFUSED_CODE.test(message)) {
    return "That code is wrong, too old, or already used. On your computer, press “Show the code” again and use the new one.";
  }
  if (NO_ANSWER.test(message)) {
    return "Your computer didn't answer at that address. Check that it is on, that Majordome is open on it, and that the address is the one it shows.";
  }
  return message;
}

/** The Majordome account screen, for someone who signed in and expects their computer to be there. */
export const MAJORDOME_ACCOUNT = {
  noComputerTitle: "Your account has no computer yet",
  noComputer:
    "On your computer, open Majordome and go to Settings, then Your account. Sign in there with this same account and follow what it says. Then come back here.",
  checkAgain: "Check again",
  codeInstead: "Scan a code instead",
  sessionEnded: "Your sign-in ended. Sign out below, sign in again, then press Connect.",
} as const;

/**
 * Why connecting through the account failed. The account already holds the address, so there is
 * none for the owner to check.
 */
export function accountConnectErrorForOwner(message: string, name: string): string {
  if (NO_ANSWER.test(message)) {
    return `${name} didn't answer. Check that it is on and connected to the internet, then press Connect again.`;
  }
  if (REFUSED_CODE.test(message)) return `${name} took too long to answer. Press Connect again.`;
  return message;
}
