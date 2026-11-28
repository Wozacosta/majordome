import type { Wording } from "./index";

export const ONBOARDING_WORDING: Wording = [
  // The code opens majord.me/open (links.ts): nothing to get from a store.
  ["Scan with your phone to get the app.", "Scan with your phone to open Majordome on it."],
  // Welcome page: installing or signing in to the assistant.
  ["Preparing command...", "Starting…"],
  ["Could not open the setup terminal.", "That did not start. Press Retry."],
  [
    "This connection cannot control terminals.",
    "This device cannot install or sign in for you. Do it on the computer Majordome runs on.",
  ],
  [
    "This connection cannot manage agents.",
    "This device cannot change which AI Majordome uses. Do it on the computer Majordome runs on.",
  ],
  ["Set up an agent", "Set up an AI"],

  // Pairing page.
  ["Pairing with this environment", "Connecting this device"],
  ["Validating the pairing link and preparing your session.", "Checking the link. One moment."],
  [
    "Invalid pairing token. Check the token and try again.",
    "That code did not work. Codes work once and expire; press “Show the code” again on your computer.",
  ],
  ["Enter a pairing token to continue.", "Type the code from your computer to continue."],
  [
    "Timed out waiting for authenticated session after bootstrap.",
    "Connecting took too long. Press “Show the code” again on your computer and type the new code.",
  ],
  ["Authentication failed.", "Could not connect. Try again."],
];
