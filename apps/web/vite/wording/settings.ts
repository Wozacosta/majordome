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
  ["Prompt font", "Message box font"],
  ["Reset prompt font to default", "Reset message box font to default"],
  ["Prompt font size", "Message box font size"],
  [
    "Only the box you write prompts in. Mono works well here.",
    "Only the box you write your messages in.",
  ],
  [
    "Set how wide messages and the composer can grow on large screens.",
    "Set how wide messages and the message box can grow on large screens.",
  ],

  // Chat.
  ["Composer", "Message box"],
  ["Rich text composer", "Formatting as you type"],
  ["Reset rich text composer to default", "Reset formatting as you type to default"],
  [
    "Show formatted Markdown as you type.",
    "Show bold text, lists and other formatting while you write.",
  ],
  [
    "Choose when Enter sends a prompt or inserts a new line",
    "Choose when Enter sends your message or starts a new line",
  ],
  [
    "{modifierLabel} + Enter for multiline prompts",
    "{modifierLabel} + Enter for messages of several lines",
  ],
  ["Follow-ups", "While the assistant works"],
  ["Follow-up behavior", "Messages you send meanwhile"],
  ["Reset follow-up behavior to default", "Reset messages you send meanwhile to default"],
  ["Tool calls in chat", "Steps the assistant takes"],
  ["Reset tool calls in chat to default", "Reset steps the assistant takes to default"],
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
    "Snooze chats until their usage limits reset. Turn on “Continue when usage limits reset” to have the assistant continue after the reset.",
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
  ["Project defaults and overrides", "Notes folder defaults"],
  ["Fallback model", "Backup model"],
  ["Reset fallback model to default", "Reset backup model to default"],
  ["Fallback model not saved", "Backup model not saved"],
  [
    "Automatic defaults differ. Select one environment or choose a shared model to edit effort.",
    "The automatic choices differ. Select one computer or choose a model they share to edit effort.",
  ],
  [
    "Defaults differ. Select one environment or choose a shared model to edit effort.",
    "The choices differ. Select one computer or choose a model they share to edit effort.",
  ],
  ["Resume after usage limits", "Continue when usage limits reset"],
  ["Snooze until limits reset", "Snooze until usage limits reset"],

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
  ["Agent access", "Assistant access"],
  [
    "Where links in the chat and terminal open. Hold ⌘ or Ctrl while clicking a link to open it in your default browser either way.",
    "Where links in a chat open. Hold ⌘ or Ctrl while clicking a link to open it in your usual browser either way.",
  ],
  [
    "What the address bar searches when you type something that isn't a URL.",
    "What the address bar searches when you type something that isn't a web address.",
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
  ["Reconnect {label} to set up its providers.", "Reconnect {label} to set up its AI accounts."],
  [
    "Connect an environment to set up its providers.",
    "Connect a computer to set up its AI accounts.",
  ],
  ["Loading provider settings", "Loading AI accounts"],
  ["Provider settings are unavailable", "AI accounts are unavailable"],
  ["Checking what this session is allowed to change.", "Checking what this device may change."],
  ["Waiting for {environment}''s configuration.", "Waiting for {environment}."],
  ["Limited permissions", "You can look but not change"],
  [
    "This session can view {environment}''s providers but can't change their settings.",
    "This device can see the AI accounts on {environment} but cannot change them.",
  ],
  ["No providers configured.", "No AI account is set up yet."],
  [
    "This provider instance is no longer available on this device.",
    "This AI account is no longer on this device.",
  ],
  ["Refresh provider status", "Check the AI accounts again"],
  ["Refreshing providers", "Checking the AI accounts"],
  ["Device that runs this provider.", "The computer this AI account runs on."],
  ["Authentication request expired", "Signing in took too long"],
  ["The authentication request expired.", "Signing in took too long."],
  [
    "Refresh the provider and start the authentication flow again.",
    "Check the AI accounts again, then sign in once more.",
  ],
  ["Could not continue authentication", "Could not finish signing in"],
  ["Remove the {provider} provider instance?", "Remove this {provider} account?"],
  ["Reset the {provider} provider to its defaults?", "Reset {provider} to its defaults?"],
  ["Could not update provider instance", "Could not save the change"],
  ["Could not delete provider instance", "Could not remove the account"],
  ["Could not reset provider instance", "Could not reset the account"],
  ["Reset {provider} provider settings to default", "Reset {provider} settings to default"],

  // AI accounts: the two optional sections below the accounts.
  ["Usage providers", "Usage from a shared hub"],
  ["No hubs configured.", "Nothing here. Most people do not need this."],
  ["Text generators", "Another AI for short texts"],
  ["No text generators yet", "None yet. Most people do not need one."],
  [
    "Add a model API to write thread titles, commit messages, and other short text without starting a coding agent.",
    "Add another AI service to write chat titles and other short texts, instead of your main AI account.",
  ],
  ["Add generator", "Add a service"],
  ["Add a text generator", "Add an AI service for short texts"],
  [
    "Writes thread titles, commit messages, and other short text without starting a coding agent. Your API key is stored on this environment.",
    "Writes chat titles and other short texts. Your key is stored on this computer.",
  ],
  ["Thread titles and other generated text", "Chat titles and other short texts"],

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
  ["Turn off local environment?", "Stop using this computer?"],
  ["Turn on local environment?", "Use this computer?"],
  [
    "T3 Code will restart without running a server on this computer. Any agents and terminals running here will stop, and other devices will no longer be able to connect to this computer. Your projects, history, and remote environments are unaffected.",
    "T3 Code will restart and stop working on this computer. Anything the assistant is doing here will stop, and your other devices will no longer be able to connect to this computer. Your notes folders, chats, and other computers are not affected.",
  ],
  [
    "T3 Code will restart and start running a server on this computer again.",
    "T3 Code will restart and work on this computer again.",
  ],
  ["Add Environment", "Add a computer"],
  [
    "Pair another environment to this client.",
    "Connect another computer running T3 Code to this device.",
  ],
  ["Enter a backend host and pairing code.", "Type the computer's address and its code."],
  [
    "Paste a full pairing URL here to fill both fields automatically.",
    "Paste a full link here to fill both fields.",
  ],
  ["Environment connected", "Computer connected"],
  [
    "The environment is saved and will reconnect on app startup.",
    "The computer is saved and reconnects when the app starts.",
  ],
  ["No linked environments", "No linked computers"],
  ["Could not load linked environments", "Could not load linked computers"],
  ["Loading linked environments…", "Loading linked computers…"],
  [
    "Link another machine running T3 Code, such as a VPS, so agents here can launch and drive threads there.",
    "Link another computer running T3 Code, such as your always-on server, so the assistant here can start and follow chats there.",
  ],
  ["Link an environment", "Link a computer"],
  [
    "Agents here can then launch, message and wait on threads there. It appears under Authorized clients in that environment's Sharing & access, where it can be revoked.",
    "The assistant here can then start and follow chats there. This computer appears under Devices that can connect in the other computer's Sharing & access, where you can remove it.",
  ],
  ["Could not link the environment", "Could not link the computer"],
  ["Expired. Link it again with a new pairing code.", "Expired. Link it again with a new code."],
  ["What agents here may do there", "What the assistant here may do there"],
  ["Same on all machines", "Same on all computers"],

  // Sharing & access.
  ["Environment icon", "Computer icon"],
  ["More actions for this machine", "More actions for this computer"],
  ["Authorized clients", "Devices that can connect"],
  [
    "This connection can create access links but cannot view authorized clients.",
    "This device can create links for other devices but cannot see the list.",
  ],
  ["Create pairing link", "Connect another device"],
  [
    "Generate a one-time link that another device can use to pair with this backend as an authorized client.",
    "Make a link that works once. Open it on another device to connect that device to this computer.",
  ],
  ["Client label (optional)", "Name for the device (optional)"],
  ["Limit what the paired client can do.", "Limit what that device can do."],
  ["No pairing links or client sessions.", "No device is connected yet."],
  ["Create a new link to share from this client.", "Create a new link to share from this device."],
  ["Use in another app (MCP)", "Use in another app"],
  ["Reach this machine via", "Reach this computer through"],
  [
    "These permissions apply to this client’s current connection.",
    "This is what this device may do on this connection.",
  ],
  ["Limited to this machine.", "Only this computer can connect."],
  ["Exposed on all interfaces.", "Other devices on your network can connect."],
  [
    "Exposed on all interfaces. Pairing links use {host}.",
    "Other devices on your network can connect. Links use {host}.",
  ],
  [
    "Only this machine can connect. Restart with a non-loopback host for remote pairing.",
    "Only this computer can connect. To let other devices in, change how T3 Code is started on it.",
  ],
  [
    "Remote access is already configured. Change network exposure where the server starts.",
    "Other devices can already connect. To change that, change how T3 Code is started on that computer.",
  ],
  [
    "This connection cannot view or change network exposure.",
    "This device cannot see or change this setting.",
  ],
  ["Network exposure information is unavailable.", "This information is unavailable."],
  [
    "Network exposure changes restart the backend and must be controlled where the server process is launched.",
    "Changing this restarts T3 Code, and it can only be changed where T3 Code is started.",
  ],
  [
    "Let your other devices connect to T3 Code over the network. Pair devices to give them access. T3 Code will restart.",
    "Let your other devices connect to T3 Code over your network. Connect each device with a link to give it access. T3 Code will restart.",
  ],
  ["Publish agent activity", "Send the assistant's activity to your phone"],

  // Passwords and keys.
  ["Secrets", "Passwords and keys"],
  ["Secret sources", "Where passwords and keys are kept"],
  ["Add secret source", "Add a place for passwords and keys"],
  ["No secret sources yet.", "Nothing set up yet."],
  [
    "Add the Mac Keychain, an encrypted file, 1Password or another place, then pick it next to a key or token field instead of pasting the value.",
    "Add the Mac Keychain, an encrypted file, 1Password or another place. Then, wherever T3 Code asks for a key or password, you can pick it from there instead of pasting it.",
  ],
  [
    "Connect to a server to manage where its key and token fields read secrets from.",
    "Connect to a computer to choose where it keeps passwords and keys.",
  ],

  // Voice.
  [
    "This environment can’t transcribe audio: {reason}.",
    "This computer can’t transcribe audio: {reason}.",
  ],
  ["Waiting for the environment to connect", "Waiting for the computer to connect"],
  ["On an environment", "On a computer"],
  ["Chosen environment (unavailable)", "Chosen computer (unavailable)"],
  ["unavailable environment", "unavailable computer"],
  [
    "The provider detects your language automatically.",
    "The service detects your language automatically.",
  ],
  [
    "Path to a model file or folder already on this environment",
    "Path to a model file or folder already on this computer",
  ],

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
  ["Reset provider update checks to default", "Reset checking for AI updates to default"],
  [
    "Reset continue threads after restarts to default",
    "Reset continuing chats after restarts to default",
  ],
  ["Background activity", "Background checks"],
  ["Background Activity", "Background checks"],
  ["Reset background activity to default", "Reset background checks to default"],
  ["Background activity profile", "How often to check in the background"],
  ["Configure background activity", "Fine-tune background checks"],
  ["Configure advanced background activity", "Fine-tune background checks"],
  ["Advanced (one environment)", "Advanced (one computer)"],
  [
    "This shared policy gates background work such as Git refreshes and provider health probes after their individual intervals elapse.",
    "Decides when T3 Code may check on your AI accounts and other things in the background.",
  ],
  [
    "Pauses probes for idle clients, locked hosts, or low power mode.",
    "Pauses background checks while you are away, the computer is locked, or it is saving power.",
  ],
  [
    "Allows scoped background probes while any subscribed client remains connected.",
    "Keeps checking in the background while any of your devices is connected.",
  ],
  [
    "Also pauses background probes when the host or client is on battery.",
    "Also pauses background checks when the computer or your device runs on battery.",
  ],
  ["Artifacts and logs", "Old captures and logs"],
  ["Delete old browser artifacts", "Delete old browser captures"],
  ["Delete old rotated logs", "Delete old log files"],
  [
    "Delete inactive rotated log files after this many days. Current logs are kept.",
    "Delete old log files after this many days. Current logs are kept.",
  ],
  ["Mixed across selected machines", "Differs between the selected computers"],
  [
    "Update the selected environments to use storage cleanup, or choose a machine that supports it.",
    "Update T3 Code on the selected computers to use cleanup, or choose a computer that supports it.",
  ],
  ["Diagnostics", "Troubleshooting"],
  ["View diagnostics", "Open troubleshooting"],
  [
    "Connect an environment to see diagnostics.",
    "Connect a computer to see troubleshooting details.",
  ],

  // Labs.
  ["Beta", "Early features"],
  ["Guest links", "Share a chat with a guest"],
  ["Suggest next prompt", "Suggest my next message"],
  [
    "Share a thread with a guest who watches it live in a browser and sends messages you approve. Sign in to T3 Connect to use guest links.",
    "Share a chat with a guest who watches it live in a browser and sends messages you approve. Sign in to T3 Connect to use guest links.",
  ],
  [
    "Show a predicted next message in the empty composer after a Claude or Codex turn. Tab uses it. Each is an extra cached request on your plan. Needs Codex 0.165+. Claude threads update on restart.",
    "Show a predicted next message in the empty message box after the assistant answers. Tab uses it. Each is an extra cached request on your plan. Needs Codex 0.165+. Claude chats update on restart.",
  ],

  // About.
  ["Update track", "Which updates to get"],
  [
    "Switches this app and every connected machine whose database the target release supports.",
    "Applies to this app and to your connected computers that can take those updates.",
  ],
  [
    "{count, plural, one {{count} machine still runs {track}.} other {{count} machines still run {track}.}}",
    "{count, plural, one {{count} computer still runs {track}.} other {{count} computers still run {track}.}}",
  ],
  ["Switches the hosted app release channel.", "Chooses which version of the web app you get."],
  [
    "This environment is managed by {organization}. Some settings and features follow its policy.",
    "This computer is managed by {organization}. Some settings follow its rules.",
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
