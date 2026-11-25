// The phone app's own texts, said the way Majordome says them. Same rules as the web tables in
// apps/web/vite/wording: upstream's exact whole English text, then the text Majordome shows.
// A text is swapped wherever source spells it out, so never list one that is also a route or
// screen name ("Thread", "Home", "Settings"): navigation would stop finding it.
type Wording = ReadonlyArray<readonly [upstream: string, majordome: string]>;

const kept = (texts: readonly string[]): Wording => texts.map((text) => [text, text] as const);

/**
 * Texts code looks things up by, so they stay as upstream spells them: a swapped key or stored
 * value stops matching what the unswapped side (the computer, packages/contracts) sends.
 */
export const MOBILE_KEPT: Wording = kept([
  // The title a chat is stored with until it is named, which the desktop compares.
  // `chatTitle` in src/majordome/chat.logic.ts shows it as "New chat".
  "New thread",
  // Keys of the table that translates packages/contracts' stage labels (contractLabels.ts).
  "Start agent",
  // A tool's label, joined into the key of its sentences (t3ToolSentences.ts).
  "linked environments",
  // Keys of the tool names table (t3McpToolPresentationCopy.ts), looked up by a name built
  // from unswapped parts.
  "List scheduled tasks",
  "Update a scheduled task",
  "Delete a scheduled task",
  "Run a scheduled task",
  "Create T3 threads",
  "Start a T3 thread",
  "List T3 threads",
  "Read a T3 thread",
  "Send to a T3 thread",
  "Wait for a T3 thread",
  "Interrupt a T3 thread",
  "Hand off thread to a git worktree",
  "Get thread worktree status",
  "Read thread configuration",
  "Use thread model settings",
  "Use thread transfers",
  "Fork this thread",
  "Merge thread context",
  "Search thread content",
  "Read thread transfers",
  "Organize a thread",
  "Update T3 thread metadata",
  "Read environment preferences",
  "List linked environments",
  "Ask to link an environment",
  "Forget a linked environment",
  "Update environment preferences",
  "Launch a project thread",
  "List projects",
  "Read a project",
  "Register a project",
  "Update a project",
  "Delete a project",
]);

export const MOBILE_WORDING: Wording = [
  ...MOBILE_KEPT,
  // Where Settings > About > Legal opens. majord.me answers upstream's page names (site/vercel.json).
  ["https://t3.codes", "https://majord.me"],
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

  // Computers, and one computer's page.
  ["Could not update environment", "Couldn't save the changes"],
  ["The environment could not be updated.", "Check the name and the address, then try again."],
  ["Reconnect environment", "Try connecting again"],
  ["Remove environment", "Remove this computer"],
  ["Remove from this device?", "Remove this computer?"],
  [
    "Forget {name} and its cached threads on this device. Switch it off instead to keep it saved.",
    "This phone forgets {name} and the chats it kept from it. Nothing is deleted on the computer, and you can add it again with a new code.",
  ],
  [
    "Forget {name} and its cached threads on this device.",
    "This phone forgets {name} and the chats it kept from it. Nothing is deleted on the computer.",
  ],
  [
    "This environment is no longer saved on this device.",
    "This computer was removed from this phone.",
  ],
  ["Connect this environment to manage it.", "Connect to this computer to see its details."],
  ["Update environment?", "Update Majordome there?"],
  ["Opens environment settings", "Opens your computers"],

  // Connection states, where upstream's own text still shows.
  ["You are offline", "This phone is offline"],
  ["This device is offline", "This phone is offline"],
  ["{environment} is unavailable", "{environment} can't be reached"],
  ["{environment} is disconnected", "Not connected to {environment}"],
  ["Waiting for approval on the host", "Waiting for you to approve this phone on your computer"],
  [
    "Waiting for {environment} to approve this device",
    "Waiting for you to approve this phone on {environment}",
  ],

  // Settings pages Majordome keeps.
  [
    "This session can view {environment}''s providers but can't change their settings.",
    "This phone can see the AI accounts on {environment} but isn't allowed to change them.",
  ],
  [
    "Configure a provider with in-app sign-in in web or desktop Settings.",
    "Sign in to an AI account from Majordome on your computer, under Settings.",
  ],
  [
    "No in-app sign-in advertised. Follow the provider's docs to finish setup.",
    "This AI account can't be signed in to from here. Follow its instructions to finish.",
  ],
  ["Could not open the provider docs.", "Could not open the instructions."],
  [
    "This removes offline threads, server metadata, and cached branches for this environment. The saved connection and credentials stay intact.",
    "This removes the chats this phone kept from this computer to show them offline. The connection stays, and nothing is deleted on the computer.",
  ],
  ["Clear all client caches?", "Clear everything kept on this phone?"],
  [
    "This removes offline data for every environment. Connections, credentials, account data, and app preferences stay intact.",
    "This removes what this phone kept from every computer to show it offline. Your computers and settings stay, and nothing is deleted on the computers.",
  ],
  ["Environment caches", "Kept from each computer"],
  [
    "Offline cache records will appear here after environments are used.",
    "What this phone keeps to work offline appears here once a computer is connected.",
  ],
  [
    "Clearing caches never removes environment connections, credentials, account data, or appearance preferences.",
    "Clearing never removes your computers, sign-ins or settings.",
  ],
  [
    "Client storage is temporarily unavailable. Try again after restarting the app.",
    "This page can't be read right now. Restart the app and try again.",
  ],
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
  [
    "Runs share one thread, each in a fresh session without earlier runs' context. The first run starts the thread. Deleting it also deletes this task.",
    "Every run writes in the same chat and starts fresh, without remembering earlier runs. The first run starts the chat. Deleting that chat also deletes this routine.",
  ],
  [
    "Runs share one thread, each in a fresh session without earlier runs' context. Deleting it also deletes this task.",
    "Every run writes in the same chat and starts fresh, without remembering earlier runs. Deleting that chat also deletes this routine.",
  ],
  [
    "{reason} Switch the task to a timer, or turn it off, to save it.",
    "{reason} Switch the routine to a timer, or turn it off, to save it.",
  ],
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
  // The conversation screen.
  ["Stop agent", "Stop"],
  ["Resume thread", "Send waiting messages"],
  ["Queue", "Send after this reply"],
  ["Steer", "Send now"],
  ["Steer now", "Send now"],
  ["Restart turn", "Start over with this message"],
  ["Run after the current turn", "Sent once this reply is finished"],
  ["Interrupt what the agent is doing", "Majordome reads it right away"],
  ["Start the turn over with this message", "Stops this reply and answers this instead"],
  ["Add attachment", "Add a photo or file"],
  ["Choose Files", "Choose files"],
  ["Starting the task…", "Starting the chat…"],
  [
    "This connection cannot control this task. You can still edit your draft.",
    "This phone can't send messages to that computer. You can still write your message.",
  ],
  ["Could not start task", "Couldn't start the chat"],
  ["Your prompt was kept in the project draft.", "Your message was kept."],
  ["Edit task", "Edit message"],
  [
    "Your next message starts a fresh session. The agent won't see earlier messages in this thread.",
    "Your next message starts afresh: Majordome won't see the earlier messages in this chat.",
  ],
  ["Keep the current session", "Keep the conversation going"],
  ["New session", "Started afresh"],
  [
    "{count, plural, one {Ran {count} command} other {Ran {count} commands}}",
    "{count, plural, one {Did {count} step} other {Did {count} steps}}",
  ],
  [
    "{count, plural, one {Read {count} file} other {Read {count} files}}",
    "{count, plural, one {Read {count} note} other {Read {count} notes}}",
  ],
  [
    "{count, plural, one {Changed {count} file} other {Changed {count} files}}",
    "{count, plural, one {Updated {count} note} other {Updated {count} notes}}",
  ],
  [
    "{count, plural, one {Searched code {count} time} other {Searched code {count} times}}",
    "{count, plural, one {Searched your notes} other {Searched your notes {count} times}}",
  ],
  [
    "{count, plural, one {Used {count} tool} other {Used {count} tools}}",
    "{count, plural, one {Did {count} other step} other {Did {count} other steps}}",
  ],
  [
    "{count, plural, one {Created {count} thread} other {Created {count} threads}}",
    "{count, plural, one {Started {count} chat} other {Started {count} chats}}",
  ],
  ["{preview}, tool call failed", "{preview}, didn't work"],
  ["Load earlier activity", "Show earlier messages"],
  ["Loading earlier activity…", "Loading earlier messages…"],
  ["Not responding to Stop", "Still stopping…"],
  ["Force stop", "Stop anyway"],
  ["Force stop the agent?", "Stop anyway?"],
  ["Turn stopped; the agent is still shutting down", "Stopped. Majordome is still finishing up."],
  ["Find a model", "Search"],
  ["Model unavailable", "This AI isn't available"],
  [
    "Set up this provider on web or desktop, or select another model.",
    "Set up this AI account on your computer, or pick another one.",
  ],
  ["Model unavailable. Open model settings.", "This AI isn't available. Pick another."],
  ["No available models", "No AI account is set up yet. Add one on your computer."],
  ["Thread unavailable", "This chat isn't available"],
  [
    "This thread was deleted or is no longer available.",
    "This chat was deleted or can't be found any more.",
  ],
  [
    "This thread is not available in the current mobile snapshot.",
    "This chat isn't on this phone yet. Reconnect to your computer to load it.",
  ],
  ["Messages not cached", "Messages not on this phone yet"],
  [
    "Reconnect this environment to load the conversation.",
    "Reconnect to your computer to load the conversation.",
  ],
  ["Could not load conversation", "Couldn't load this chat"],
  ["Retrying connection…", "Reconnecting…"],
  ["Awaiting device approval", "Waiting for approval on your computer"],
  ["Manage environments", "Manage computers"],
  ["Opening thread…", "Opening chat…"],
  ["Usage limit reached.", "Your AI account has reached its limit."],
  [
    "Usage limit reached. Retry after {resetTime}.",
    "Your AI account has reached its limit. Try again after {resetTime}.",
  ],
  ["Delete thread?", "Delete this chat?"],
  [
    "“{title}” will be permanently deleted, including its terminal history.",
    "“{title}” will be deleted for good.",
  ],
];
