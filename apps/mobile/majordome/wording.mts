// The phone app's own texts, said the way Majordome says them. Same rules as the web tables in
// apps/web/vite/wording: upstream's exact whole English text, then the text Majordome shows.
// A text is swapped wherever source spells it out, so never list one that is also a route or
// screen name ("Thread", "Home", "Settings"): navigation would stop finding it.
export const MOBILE_WORDING: ReadonlyArray<readonly [upstream: string, majordome: string]> = [
  // Kept as it is: this is the title a chat is stored with until it is named, and the desktop
  // compares it. `chatTitle` in src/majordome/chat.logic.ts shows it as "New chat".
  ["New thread", "New thread"],
  // Single words, checked to be display text only (never a route or screen name).
  ["Settle", "Mark as done"],
  ["Un-settle", "Bring back"],
  ["Unsettle", "Bring back"],
  ["Settled", "Done"],
  ["Environments", "Computers"],
  ["Providers", "AI accounts"],
  ["Projects", "Notes folders"],
  ["Routes", "Addresses"],
  ["Auto-settle", "Marking chats as done"],
  ["Add environment", "Add a computer"],
  ["All environments", "All computers"],
  ["All projects", "All notes folders"],
  ["No conversation yet", "Nothing here yet"],
  [
    "Ask the agent to inspect the repo, run a command, or continue the active thread.",
    "Ask Majordome anything.",
  ],
  // Home, before anything is listed.
  ["Loading environments", "Looking for your computer"],
  ["Checking saved environments on this device.", "Checking the computers saved on this phone."],
  ["No environments connected", "Connect your computer"],
  [
    "Add an environment to load projects and start coding sessions.",
    "On your computer, open Majordome and go to Settings, then Phone & notifications. Then tap Add a computer here and scan the code shown there.",
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

  // Adding a computer, and what can go wrong.
  ["Add Environment", "Add a computer"],
  ["No environments connected yet.", "No computer connected yet."],
  ["Client not supported", "Update needed"],
  [
    "Failed to pair with the environment.",
    "Couldn't connect to your computer. Check the address and the code, then try again.",
  ],
  [
    "The pairing details are invalid.",
    "That address or code doesn't look right. Check both on your computer.",
  ],
  [
    "The environment URL is invalid.",
    "That address doesn't look right. Check it on your computer.",
  ],
  [
    "Scanned QR code did not contain a pairing URL.",
    "That code is empty. Scan the one Majordome shows on your computer.",
  ],
  [
    "Failed to fetch remote environment endpoint {url} ({cause}).",
    "Your computer didn't answer at {url}. Check that it is on and that Majordome is open on it.",
  ],
  [
    "Remote environment endpoint {url} timed out after {timeoutMs}ms.",
    "Your computer took too long to answer at {url}. Check that it is on and that Majordome is open on it.",
  ],
  [
    "Remote environment endpoint {url} returned undeclared status {status}.",
    "{url} answered, but not the way Majordome does (error {status}). Check the address.",
  ],
  [
    "Remote environment endpoint returned an invalid response from {url}.",
    "{url} answered, but not the way Majordome does. Check the address.",
  ],
  [
    "This client is not supported by this server. Update your app or use a compatible release to connect to {host}.",
    "This app and Majordome on {host} are on versions that don't work together. Update both, then try again.",
  ],
  [
    "This client requires a newer server. Update T3 Code on {host} to connect.",
    "This app needs a newer Majordome on {host}. Update it there, then try again.",
  ],
  [
    "Use compatible versions of the app and server to connect.",
    "Update this app and Majordome on your computer so they work together.",
  ],

  // Computers. Upstream's "route" is an address there, and a page of the app here.
  ["Route not found", "Page not found"],
  ["Add route", "Add an address"],
  [
    "The host refused this device's sign-in. Pair this address again with Add route.",
    "Your computer no longer recognises this phone at this address. Tap Add an address and scan a new code.",
  ],
  [
    "This connection does not have permission to manage the environment.",
    "This phone isn't allowed to manage that computer.",
  ],
  [
    "Install {product} {version}. The server will restart and reconnect. Running threads may be interrupted.",
    "Install {product} {version}. Majordome restarts on your computer and reconnects. Chats in progress may be interrupted.",
  ],

  // Settings pages Majordome keeps.
  ["Client Storage", "Saved on this phone"],
  ["Tool calls in chat", "Steps the assistant takes"],
  [
    "Hide the commands, edits, and searches agents run. Hide successful keeps failures. Zen shows only final answers. Approvals, questions, and errors always show.",
    "Hide the steps the assistant takes, such as searches and edits. Hide successful keeps failures. Zen shows only final answers. Approvals, questions, and errors always show.",
  ],
  ["While the agent is running", "While the assistant works"],
  [
    "Your message waits and runs after the current turn finishes.",
    "Your message waits until the assistant has finished.",
  ],
  [
    "Your message reaches the agent right away, changing what it is working on.",
    "The assistant reads your message right away and adjusts what it is doing.",
  ],
  [
    "Applies to the composer when a hardware keyboard is connected.",
    "Applies when a keyboard is connected to your phone.",
  ],
  ["Auto-settle inactive threads", "Mark quiet chats as done"],
  ["Auto-settle defaults differ", "Your computers mark chats as done differently"],
  ["Apply auto-settle defaults", "Use the same on all"],
  [
    "Select a project with a checkout on a connected environment.",
    "Pick a notes folder on a connected computer.",
  ],
  ["Server and provider updates", "Updates"],
  ["Check provider updates", "Look for new AI models"],
  [
    "Check installed provider CLIs for newer versions and fetch model catalog updates. When off, new models may not appear.",
    "Checks for newer versions of your AI accounts' tools and for new models. When off, new models may not appear.",
  ],

  // Routines, which upstream calls tasks: so does a new chat, so the word has no rule.
  ["Check for issues", "Morning summary"],
  ["One thread, fresh session", "One chat, starting fresh each run"],
  ["Saving task", "Saving routine"],
  [
    "Wait for the task to finish saving before leaving.",
    "Wait for the routine to finish saving before leaving.",
  ],
  [
    "No environments match the current filters. Change the filters to create a task.",
    "No computers match the current filters. Change the filters to create a routine.",
  ],
  [
    "This environment runs an older {product}. Update it to schedule a one-time task, or pick another schedule.",
    "This computer runs an older {product}. Update it to run a routine once, or pick another schedule.",
  ],
  ["Incomplete task", "Incomplete routine"],
  [
    "Add a name, prompt, project, model, valid schedule, and checkout path if needed.",
    "Add a name, what to do, a notes folder, a model and a valid schedule.",
  ],
  ["Could not save task", "Could not save routine"],
  ["This task no longer exists.", "This routine no longer exists."],
  [
    "This task previously ran more than once per minute. Saving requires an interval of at least 1 minute.",
    "This routine used to run more than once per minute. Saving requires an interval of at least 1 minute.",
  ],
  ["Task enabled", "Routine enabled"],
  ["Create task", "Create routine"],
  ["Could not run task", "Could not run routine"],
  ["Could not update task", "Could not update routine"],
  ["Could not delete task", "Could not delete routine"],
  ["Loading tasks…", "Loading routines…"],
  ["No tasks in this project.", "No routines in this notes folder."],
  ["Delete task?", "Delete routine?"],
];
