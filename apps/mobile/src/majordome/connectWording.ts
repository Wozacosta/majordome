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
  connecting: "Connecting to your computer…",
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
  // Says the server exists, never how to get one: shown wherever Apple does not sell it.
  hostedLabel: "No computer to leave on?",
  hostedDescription:
    "Majordome can also run on a Majordome server that is always on. If your account has one, sign in and this phone finds it.",
} as const;

const REFUSED_CODE =
  /pairing code is unknown, expired, or already used|not a one-time pairing code/i;
// The last two are those same answers as the build rewords them (majordome/wording.mts): the
// rewording runs first, so in the app these are the sentences that arrive.
const NO_ANSWER =
  /network request failed|failed to fetch|timed out|could not connect|unreachable|didn't answer at|took too long to answer at/i;

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
  stillNoComputer:
    "Still nothing. Check that Majordome on your computer is signed in with this same account, then check again.",
  codeInstead: "Scan a code instead",
  sessionEnded: "Your sign-in ended. Sign out below, sign in again, then press Connect.",
  connected: "This phone is connected to it.",
  connectAgain: "Connect again",
  deleteTitle: "Delete my account",
  deleteDetail:
    "Your Majordome account is removed for good. Your notes are not touched: they stay on your computer, and this phone stays connected to the computers it already has.",
  deleteWithServer:
    "Your Majordome account is removed for good. Your Majordome server and the notes on it are deleted now, and its subscription ends. Notes on your own computer are not touched.",
  deleteWithAppleServer:
    "Your Majordome account is removed for good. Your Majordome server and the notes on it are deleted now. Its subscription is not cancelled by this: only you can cancel it, in this iPhone's Settings, under your name, then Subscriptions. Notes on your own computer are not touched.",
  deleteConfirm: "Delete",
  deleteFailed: "The account could not be deleted. Sign out, sign in again, then try once more.",
  signOut: "Sign out",
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

const CANCEL_PLACE = "this iPhone's Settings, under your name, then Subscriptions";

/** The first screen of a phone that knows no computer. */
export const MAJORDOME_WELCOME = {
  headline: "A second brain that keeps working",
  headlineEnd: "while you are away.",
  spoken: "A second brain that keeps working while you are away.",
  what: "Your notes, plus the AI you already pay for. It reads them, runs your routines, and asks before touching anything sensitive.",
  returning: "Let's connect to your brain",
  signIn: "Sign in",
  signInDetail: "This phone finds your computers",
  scan: "Scan a code",
  scanDetail: "Majordome on your computer shows one",
  newHere: "I'm new here",
  computer: "Use your computer",
  computerDetail: "Free app for Mac",
  server: "Get a Majordome server",
  serverDetail: "Always on, no computer needed",
} as const;

/**
 * The welcome's account row. Someone signed in is never asked to sign in: the row names their
 * account, and offers the computer it lists when there is one.
 */
export function welcomeAccountRow(account: {
  readonly signedIn: boolean;
  readonly email: string | null;
  /** The names of the computers the account lists. */
  readonly computers: ReadonlyArray<string>;
}): { readonly title: string; readonly detail: string; readonly main: boolean } {
  if (!account.signedIn) {
    return { title: MAJORDOME_WELCOME.signIn, detail: MAJORDOME_WELCOME.signInDetail, main: true };
  }
  const detail = account.email ?? "Signed in";
  const [first] = account.computers;
  if (first === undefined) return { title: "Your account", detail, main: false };
  return {
    title: account.computers.length === 1 ? `Connect to ${first}` : "Connect your computers",
    detail,
    main: true,
  };
}

/** Starting from nothing with a computer: where to get Majordome for it, then its code. */
export const MAJORDOME_USE_COMPUTER = {
  title: "Use your computer",
  site: "majord.me",
  url: "https://majord.me/download",
  steps: [
    "On your Mac, open",
    "Download Majordome and open it.",
    "In its Settings, open Phone & notifications and press “Show the code”.",
  ],
  send: "Send the link to your Mac",
  scan: "Scan the code",
} as const;

/** Getting a Majordome server from the iPhone app. Shown only where Apple sells it. */
export const MAJORDOME_SERVER = {
  getLabel: "Get a Majordome server",
  getDescription:
    "No computer to leave on? A Majordome server is always on, so Majordome keeps working while your computer is off.",
  title: "An always-on server",
  headline: "Majordome, always on",
  what: "Routines run while your computer is off. You sign in to your own Claude plan.",
  own: {
    name: "Your own server",
    recommended: "Recommended",
    price: "About €5 a month, paid to whoever you rent from",
    what: "You rent any Linux server and run one command. It is yours, and private to your devices.",
    guide: "Read the guide",
    guideUrl: "https://majord.me/own-server",
  },
  hosted: {
    name: "A Majordome server",
    what: "Nothing to rent or install. Ready in half a minute.",
  },
  renews: `A Majordome server renews by itself until you cancel, in ${CANCEL_PLACE}.`,
  buy: "Subscribe",
  signIn: "Sign in",
  signedIn: "Signed in",
  restore: "Restore purchases",
  manage: "Manage subscription",
  connect: "Connect this phone to it",
  terms: "Terms",
  privacy: "Privacy",
  checking: "Checking your account…",
  buying: "Waiting for Apple…",
  confirming: "Confirming your purchase…",
  restoring: "Looking for your purchase…",
  making: "Making your server. This takes about half a minute.",
  hasServer: "This account already has a Majordome server.",
  full: "Majordome isn't taking new servers right now. Nothing was bought. Try again later.",
  awaitingApproval:
    "The purchase is waiting to be approved. Your server is made once it is: open Majordome again then.",
  nothingToRestore: "This Apple account has no Majordome server subscription to restore.",
  otherAccount:
    "This Apple account already pays for a server on another Majordome account. Sign in with that one to use it.",
  alreadySubscribed: `This account already has a server and a subscription for it, so this purchase was not added. You can cancel it in ${CANCEL_PLACE}.`,
  alreadyConnected: "This phone is already connected to your server.",
  notConfirmed:
    "Apple took the purchase, but Majordome could not confirm it yet. Nothing is lost: press Restore purchases in a few minutes.",
  storeFailed: "The purchase did not go through. Try again in a few minutes.",
  signedOut: "Your sign-in ended. Sign in again, then try once more.",
  signInToConnect: "Sign in to your Majordome account, then try again.",
} as const;
