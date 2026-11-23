// The phone app's own texts, said the way Majordome says them. Same rules as the web tables in
// apps/web/vite/wording: upstream's exact whole English text, then the text Majordome shows.
export const MOBILE_WORDING: ReadonlyArray<readonly [upstream: string, majordome: string]> = [
  // Home, before anything is listed.
  ["Loading environments", "Looking for your computer"],
  ["Checking saved environments on this device.", "Checking the computers saved on this phone."],
  ["No environments connected", "No computer connected yet"],
  [
    "Add an environment to load projects and start coding sessions.",
    "Add the computer Majordome runs on to see your day and your chats.",
  ],
  ["Environment unavailable", "Your computer can't be reached"],
  [
    "The saved environment is offline. Check the URL or start the environment, then retry.",
    "Majordome isn't answering there. Check that the computer is on, then try again.",
  ],
  ["Connecting to environment", "Connecting to your computer"],
  ["Loading projects and threads from the saved environment.", "Loading your chats."],
  ["Loading threads", "Loading chats"],
  ["No projects found", "No notes folder yet"],
  [
    "The connected environment did not report any projects.",
    "Open Majordome on your computer and choose a notes folder.",
  ],
  ["No threads yet", "No chats yet"],
  [
    "Create a task to start a new coding runtime in one of your connected projects.",
    "Start a chat to ask Majordome something.",
  ],
];
