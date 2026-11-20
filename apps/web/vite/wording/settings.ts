import type { Wording } from "./index";

export const SETTINGS_WORDING: Wording = [
  // The sentence above a settings page that says what the page applies to.
  ["Applying settings for", "For"],
  ["across", "on"],
  ["All projects", "All notes folders"],
  ["All environments", "All computers"],
  ["Unavailable project", "Unavailable notes folder"],
  ["Unavailable environment", "Unavailable computer"],
  ["No environments", "No computers"],
  ["Search projects", "Search notes folders"],
  ["Search environments", "Search computers"],
  ["Project scope", "Notes folder"],
  ["Environment scope", "Computer"],
  ["Show all environments", "Show all computers"],
  ["Open all environments", "Open all computers"],

  // Why a row cannot be changed, and where its value comes from.
  [
    "This connection lacks permission to change settings on {environments}.",
    "This device is not allowed to change settings on {environments}.",
  ],
  [
    "This connection lacks permission to change settings on the selected environment.",
    "This device is not allowed to change settings on the selected computer.",
  ],
  [
    "This connection lacks permission to change settings on the primary environment.",
    "This device is not allowed to change settings on this computer.",
  ],
  [
    "Reconnect the selected environment to change this setting.",
    "Reconnect the selected computer to change this setting.",
  ],
  [
    "Environment-wide setting. Select an environment to change it.",
    "This setting is for the whole computer. Pick All notes folders above to change it.",
  ],
  [
    "Saved on this device. Select All projects to change it.",
    "Saved on this device. Pick All notes folders above to change it.",
  ],
  ["Mixed across selected environments", "Differs between the selected computers"],
  ["Overridden for this project", "Set for this notes folder"],
  ["Inherited from environment", "Same as the computer's setting"],
  ["Inherited from {environment}", "Same as on {environment}"],
  ["Set on the environment", "Set on this computer"],
  ["This environment is no longer available.", "This computer is no longer available."],
  ["This project is no longer available.", "This notes folder is no longer available."],

  // General.
  ["Thread notifications", "Chat notifications"],
  [
    "System alerts when a thread finishes, fails, or needs input or approval. Applies to this device while T3 Code is open.",
    "System alerts when a chat finishes or needs you. Applies to this device while T3 Code is open.",
  ],
  [
    "Show a toast when another thread finishes, fails, or needs input or approval while this app has focus.",
    "Show a message inside T3 Code when another chat finishes or needs you.",
  ],
  ["Ask before unpinning a thread from the pinned section.", "Ask before unpinning a chat."],
  [
    "Require a second click on the inline archive action before a thread is archived.",
    "Ask for a second click before a chat is archived.",
  ],
  ["Ask before deleting a thread and its chat history.", "Ask before deleting a chat."],
  ["Confirm thread unpinning", "Confirm unpinning a chat"],
  ["Confirm thread archiving", "Confirm archiving a chat"],
  ["Confirm thread deletion", "Confirm deleting a chat"],

  // Appearance.
  [
    "Choose what the thread details card shows. You can also right-click the card.",
    "Choose what the chat details card shows. You can also right-click the card.",
  ],
  ["Reset thread details to default", "Reset chat details to default"],
  ["Thread details: {enabled} of {total} on", "Chat details: {enabled} of {total} on"],

  // Chat.
  [
    "Hide the commands, edits, and searches agents run. Hide successful keeps failures. Zen shows only final answers. Approvals, questions, and errors always show.",
    "Hide the steps the assistant takes, such as searches and edits. Hide successful keeps failures. Zen shows only final answers. Approvals, questions, and errors always show.",
  ],
  [
    "Queue follow-ups while the agent runs or steer the current run. Press {modifier} + Enter for single-line prompts or {modifier} + Shift + Enter for multiline prompts to do the opposite for one message.",
    "Queue your next messages while the assistant works, or have it read them right away. Press {modifier} + Enter for single-line messages or {modifier} + Shift + Enter for multiline messages to do the opposite for one message.",
  ],
  [
    "Queue follow-ups while the agent runs or steer the current run. Press {modifier} + Shift + Enter to do the opposite for one message.",
    "Queue your next messages while the assistant works, or have it read them right away. Press {modifier} + Shift + Enter to do the opposite for one message.",
  ],
  [
    "Queue follow-ups while the agent runs or steer the current run. Press {modifier} + Enter to do the opposite for one message.",
    "Queue your next messages while the assistant works, or have it read them right away. Press {modifier} + Enter to do the opposite for one message.",
  ],
  [
    "What a screen reader hears from the open thread: a turn starting, needing you, and ending. Status and messages adds what the agent writes before its last message. Everything adds each step.",
    "What a screen reader hears from the open chat: the assistant starting, needing you, and finishing. Status and messages adds what the assistant writes before its last message. Everything adds each step.",
  ],
  [
    "Start the window title with the thread's status, like Needs approval, and its name, so screen readers read them first when you switch apps. Taskbars, shared screens, and time trackers see it too.",
    "Start the window title with the chat's status, like Needs approval, and its name, so screen readers read them first when you switch apps. Taskbars, shared screens, and time trackers see it too.",
  ],
  [
    "Text appears once the agent finishes its turn.",
    "Text appears once the assistant has finished.",
  ],

  // Chats.
  ["New threads", "New chats"],
  [
    "Default model for new threads. Projects can override it.",
    "The AI model new chats start with.",
  ],
  [
    "Default model for new threads, selected automatically. Projects can override it.",
    "The AI model new chats start with, chosen automatically.",
  ],
  [
    "Model for new threads in this project.",
    "The AI model new chats in this notes folder start with.",
  ],
  [
    "Used for new threads when the default model's provider is out of usage.",
    "Used for new chats when the default model's AI account has reached its limit.",
  ],
  [
    "Default permissions for new threads. Projects can override them.",
    "What the assistant may do without asking in new chats.",
  ],
  [
    "Permissions for new threads in this project.",
    "What the assistant may do without asking in new chats in this notes folder.",
  ],
  ["No providers available", "No AI account is set up"],
  [
    "Automatically resume threads when their usage limits reset. You can cancel auto-resume in each thread.",
    "Continue chats automatically when their usage limits reset. You can cancel this in each chat.",
  ],
  [
    "Snooze threads until their usage limits reset. Enable auto-resume to continue the agent after the reset.",
    "Snooze chats until their usage limits reset. Turn on “Resume after usage limits” to have the assistant continue after the reset.",
  ],
  [
    "For thread titles and other generated text. Source control has its own setting. Text generators from Providers also appear here.",
    "For chat titles and other short texts T3 Code writes for you.",
  ],
  [
    "Connect an environment to choose its text generation model.",
    "Connect a computer to choose its text generation model.",
  ],
  ["No text generation providers available.", "No AI account can write these texts yet."],
  ["Thread title instructions", "Chat title instructions"],

  // Browser.
  ["Agent browser access", "Let the assistant use the browser"],
  [
    "Allow agents to use the shared browser. Projects can override it.",
    "Allow the assistant to open and use the built-in browser.",
  ],
  [
    "Allow agents in this project to use the shared browser. Applies when the agent session next starts.",
    "Allow the assistant to use the built-in browser in this notes folder. Applies the next time the assistant starts.",
  ],

  // AI accounts.
  ["Add provider", "Add an AI account"],
  [
    "Reconnect this device to set up its provider, or select another device.",
    "Reconnect this device to set up its AI account, or select another device.",
  ],
  [
    "Connect an execution environment before configuring providers.",
    "Connect a computer before setting up AI accounts.",
  ],
  ["Reading connected execution environments.", "Looking for connected computers."],

  // Computers.
  ["This machine", "This computer"],
  ["Add environment", "Add a computer"],
  ["No saved remote environments", "No other computers yet"],
  [
    "Click “Add environment” to pair another environment.",
    "Press “Add a computer” to connect another computer running T3 Code.",
  ],
  [
    "Click “Add environment” to pair another environment, or connect one from T3 Connect.",
    "Press “Add a computer” to connect another computer running T3 Code.",
  ],
  ["Primary environment", "Main computer"],
  ["No environment selected", "No computer selected"],
  [
    "Connect an environment to view its settings and access.",
    "Connect a computer to see its settings and who can reach it.",
  ],
  ["Local environment", "Use this computer"],
  [
    "Run agents on this computer. Turn off to use T3 Code only with remote environments.",
    "The assistant works on this computer. Turn off to use T3 Code only with your other computers.",
  ],
  [
    "Turned off. Agents only run in remote environments.",
    "Turned off. The assistant only works on your other computers.",
  ],
  ["Linked environments", "Linked computers"],

  // Maintenance.
  ["Provider update checks", "Check for AI updates"],
  [
    "Check installed provider CLIs for newer available versions and fetch model catalog updates. When off, new models may not appear.",
    "Check for newer versions of the AI tools on this computer and for new models. When off, new models may not appear.",
  ],
  ["Check provider versions", "Check for AI updates"],
  ["Continue threads after restarts", "Continue chats after restarts"],
  [
    "Automatically resume interrupted threads after an update, crash, or machine restart on the selected environments.",
    "Automatically continue interrupted chats after an update, a crash, or a restart of the computer.",
  ],
  [
    "All selected connected environments must support restart continuation.",
    "Every selected computer must support this.",
  ],
  ["Keep awake while agents work", "Keep awake while the assistant works"],
  [
    "Stop the computer from going to sleep while agents are working, and let it sleep once they finish. Closing a laptop lid still puts it to sleep.",
    "Stop the computer from going to sleep while the assistant is working, and let it sleep once it finishes. Closing a laptop lid still puts it to sleep.",
  ],
  [
    "Reset keep awake while agents work to default",
    "Reset keep awake while the assistant works to default",
  ],
  [
    "Inspect processes, resource use, and logs on this environment.",
    "Inspect processes, resource use, and logs on this computer.",
  ],
  [
    "Inspect processes, resource use, and logs on one environment at a time.",
    "Inspect processes, resource use, and logs on one computer at a time.",
  ],

  // Labs.
  [
    "Share a thread with a guest who watches it live in a browser and sends messages you approve. Sign in to T3 Connect to use guest links.",
    "Share a chat with a guest who watches it live in a browser and sends messages you approve. Sign in to T3 Connect to use guest links.",
  ],
  [
    "Show a predicted next message in the empty composer after a Claude or Codex turn. Tab uses it. Each is an extra cached request on your plan. Needs Codex 0.165+. Claude threads update on restart.",
    "Show a predicted next message in the empty message box after the assistant answers. Tab uses it. Each is an extra cached request on your plan. Needs Codex 0.165+. Claude chats update on restart.",
  ],

  // Archived chats.
  ["Archived threads", "Archived chats"],
  ["Loading archived threads", "Loading archived chats"],
  ["Could not load archived threads", "Could not load archived chats"],
  ["No archived threads", "No archived chats"],
  ["Archived threads will appear here.", "Archived chats will appear here."],
  ["Checking connected environments.", "Checking connected computers."],
  ["Failed to unarchive thread", "Could not unarchive the chat"],
  ["Archived thread action failed", "That did not work"],

  // Notes folders.
  [
    "Choose a project to manage its name, icon, checkouts and actions.",
    "Choose a notes folder to change its name or icon, or to stop using it.",
  ],
  [
    "Add a project from the sidebar to configure it here.",
    "Open a notes folder to set it up here.",
  ],
  [
    "Can't find a setting? Keep this project picked above and hop to any other settings page.",
    "Looking for another setting? Keep this notes folder picked above and open any other settings page.",
  ],
  ["This connection cannot change this project.", "This device cannot change this notes folder."],
  [
    "The shared name for this project group in the sidebar and thread lists.",
    "The name T3 Code shows for this notes folder.",
  ],
  ["Project name", "Notes folder name"],
  ["Project icon", "Icon"],
  ["Choose a project icon", "Choose an icon"],
  ["Choose a project icon file", "Choose an icon file"],
  ["Reset project name to default", "Reset the name to default"],
  ["Reset project icon to default", "Reset the icon to default"],
  ["Project title cannot be empty", "The name cannot be empty"],
  ["Failed to rename project", "Could not rename the notes folder"],
  ["Failed to update project icon", "Could not change the icon"],
  [
    "Hides the project from project pickers. Threads and files are kept.",
    "Hides this notes folder from lists. Its chats and files are kept.",
  ],
  [
    "Hidden from project pickers. Threads and files are kept.",
    "Hidden from lists. Its chats and files are kept.",
  ],
  ["Failed to archive project", "Could not archive the notes folder"],

  // Removing a notes folder deletes its chats and leaves the files, so both are said.
  ["Remove project", "Stop using this folder"],
  ["Remove this project everywhere", "Stop using this folder everywhere"],
  ["Remove all entries", "Stop using it everywhere"],
  ["Remove checkout", "Stop using it on this computer"],
  ["Failed to remove project", "Could not stop using this folder"],
  [
    "Deletes the project entry and its threads. Files on disk are not touched.",
    "T3 Code forgets this folder and deletes its chats. Your files stay on disk.",
  ],
  [
    "{count, plural, other {Deletes all {count} checkout entries and their threads on every machine. Files on disk are not touched.}}",
    "{count, plural, other {T3 Code forgets all {count} copies of this folder, on every computer, and deletes their chats. Your files stay on disk.}}",
  ],
  [
    "Deletes the selected machine's checkout entries and their threads. Other machines and files on disk are not touched.",
    "T3 Code forgets this folder on the selected computer and deletes its chats there. Your other computers are not touched, and your files stay on disk.",
  ],
  [
    '{count, plural, one {Remove project "{label}" and delete its {count} thread?} other {Remove project "{label}" and delete its {count} threads?}}',
    '{count, plural, one {Stop using "{label}" and delete its {count} chat?} other {Stop using "{label}" and delete its {count} chats?}}',
  ],
  ['Remove project "{label}"?', 'Stop using "{label}"?'],
  [
    '{count, plural, one {Remove checkout "{label}" and delete its {count} thread?} other {Remove checkout "{label}" and delete its {count} threads?}}',
    '{count, plural, one {Stop using this copy of "{label}" and delete its {count} chat?} other {Stop using this copy of "{label}" and delete its {count} chats?}}',
  ],
  ['Remove checkout "{label}"?', 'Stop using this copy of "{label}"?'],
  ["Path: {path}", "Folder: {path}"],
  ["Environment: {environment}", "Computer: {environment}"],
  [
    "This removes {count} grouped project entries.",
    "T3 Code will forget {count} copies of this folder.",
  ],
  [
    "Those threads and any archived threads are deleted from T3 Code. Provider sessions are kept.",
    "Those chats and any archived chats are deleted from T3 Code.",
  ],
  [
    "Any archived threads are deleted from T3 Code. Provider sessions are kept.",
    "Any archived chats are deleted from T3 Code.",
  ],
  ["This removes only the project entries, not the files on disk.", "Your files stay on disk."],
  [
    "Other entries in this grouped project are unaffected.",
    "Other copies of this folder are not touched, and your files stay on disk.",
  ],
];
