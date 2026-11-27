# Majordome and T3 Code

Majordome is a fork of [T3 Code](https://github.com/pingdotgg/t3code). T3 Code is an app for
running coding agents on your projects. Majordome uses the same engine for the rest of your life:
your notes, your errands, your reading, your paperwork.

This page lists what is Majordome's own. Keep it current: a change that adds, removes or hides
something T3 Code does not have gets a line here, in the same commit as its `CHANGELOG.md` entry.
The landing page and the README show a short version of this list.

## In one table

|                   | T3 Code                                   | Majordome                                            |
| ----------------- | ----------------------------------------- | ---------------------------------------------------- |
| Made for          | Developers running coding agents          | Anyone, for notes and everyday life                  |
| You work in       | Projects: folders of code                 | One folder of Markdown notes, split into topics      |
| The sidebar lists | Projects and their threads                | Today, To-dos, Reading list, Routines, your topics   |
| What it remembers | Each thread's history                     | Your notes, and a memory note it reads every time    |
| Words on screen   | Git, pull requests, terminals, worktrees  | History, Undo this, Back up, Your phone              |
| On your phone     | T3's iOS and Android apps, via T3 Connect | The same app on your Home Screen, nothing to install |
| Account           | A T3 account for T3 Connect               | None                                                 |

## What Majordome adds

### Your notes

- **A notes folder as the memory.** Plain Markdown in a folder you own. An Obsidian vault works as
  it is, and "Open in Obsidian" is one click away.
- **Notes you can read, edit and search** inside the app, including the text inside every note.
  [Searching your notes](./user/notes-search.md)
- **A memory note** the assistant reads at the start of every conversation, with today's and
  yesterday's daily notes, and a nightly "Tidy my memory" routine that keeps what will still matter.
  [Memory](./user/memory.md)
- **A note about you** (`me.md`): your name, contact details, work and household, for forms,
  bookings and letters. Every conversation starts with your name and contact details, the
  assistant fills the note as you mention things, and passport, tax and bank numbers stay out of
  it, encrypted with your saved keys. The welcome page asks what to call you and what you want
  help with first. [About you](./user/about-you.md)
- **The notes layout and skills from [obrain](../packages/obrain)**, which lives in this
  repository and is published to npm as `obrain`.

### Pages for everyday life

- **A strip of page icons you choose.** The pages sit as icons down the left of the sidebar. Pin
  the ones you use; the rest wait under the three dots.
- **Today:** your day, the to-dos due, and what changed in your notes lately. Under the box where
  you start a chat, the chats that need you and the ones the assistant is working on.
- **To-dos:** every checkbox from every note in one list. Tick one and it is ticked in its note.
- **Reading list:** links, videos and podcasts for later, with a Next view of three things, snooze,
  subjects, and tags and a summary written for you. [Reading list](./user/reading-list.md)
- **Library:** every file kept with your notes and every file attached in a chat on one page, by
  kind and by topic, with pictures shown as themselves.
- **Usage by routine and by topic:** T3 Code's usage page says what each AI and model used.
  Majordome's also says what each routine and each topic used, sets apart what was used outside
  Majordome, and shows the plan's limits as gauges above the totals. [Usage](./user/usage.md)
- **Topics:** one continuing conversation per part of life (Money, Meals, Trips), tied to its own
  folder of notes, with its files, to-dos and routines beside it. Ready-made topics to start from.
- **Chats under a topic are tabs,** with a "Where things stand" strip above them and one-tap replies
  when the assistant ends with an offer.
- **Unread chats in one place:** an Unread group at the top of the sidebar while something is
  unread, an All / Unread switch on the Chats page, and a "New" line in the chat where the unread
  part starts. T3 Code marks unread threads one by one in its list.
- **Key facts** beside every conversation: the links, places, dates and names you mentioned, the
  conversation in short, and a drawing of it. On the iPhone, a chat's "i" button shows the same
  facts and a topic's files. [Key facts](./user/key-facts.md)
- **What a chat knows, shown:** every conversation is told where your other topics stand and looks
  inside one when your question touches it, saying which. The side panel lists the notes a chat
  starts with and the topics it only knows the standing of. A conversation kept for days is given
  them again with its first message of each new day, and the list of topics as soon as it
  changes. [Memory](./user/memory.md)
- **What your assistant can see and do, drawn:** click the icon at the top of any conversation and a map opens at once, without a turn of the assistant (or ask for it in the chat): a map with the chat in the
  middle and a line out to each thing it read before your first message, can use and can reach:
  instructions, skills, notes, connections, saved keys and private documents. A box opens onto
  what is behind it; a key's value and a private document's text are never shown.
- **Download a file the assistant names:** the menu of a file in an answer has "Download", which
  saves a copy on the device you are reading on, wherever the file lives.
- **Keys your assistant can use:** a list of the API keys, tokens and passwords you saved for it,
  with when each was last used, and tools so it knows which it has and uses one without the key
  appearing in the chat. A key can stay in 1Password or Bitwarden Secrets Manager (a source
  Majordome adds) and be read from there each time. A key can say until when it works, and you
  are told in its last month. With several computers the keys are one list: a key is saved on
  each and removed from each. [Secrets](./user/secrets.md)
- **The services an answer used,** such as Gmail or Google Calendar, shown under it with their logos.
- **Replies read aloud by a free voice**, on the iPhone, in the Mac app and in a browser. The speech
  is made on the device, with no key and no account; the voice is downloaded once.
  [Reading replies aloud](./user/voice-input.md#reading-replies-aloud)
- **A spoken conversation with Claude and your notes**, on the iPhone, in the Mac app and in a
  browser. You talk, the assistant answers aloud in short sentences and listens again, in the same
  chat with the same notes and tools. The voice is free and made on the device. T3 Code has no
  voice conversation.
  [Talking with the assistant](./user/voice-input.md#talking-with-the-assistant)

### An assistant that works without you

- **Routines and reminders in your words,** with ready-made ones to pick from picture cards (What
  needs a reply, Prepare tomorrow, A note worth rereading). Built on T3 Code's scheduled tasks. [Routines](./user/routines.md)
- **A week calendar of your routines:** what ran each day and how it went, and what is still to
  come. T3 Code keeps only each task's last run.
- **What it did, with Undo this.** Every change the assistant makes to your notes is listed in
  plain words, with the notes it touched, and one press takes it back.
- **Skills it writes for itself.** Say "from now on, do it this way" and it writes the skill down.
  It is used only after you keep it. One page lists every skill with when it is used and who wrote
  it, with a search and the steps to read. [Skills](./user/skills.md)
- **Private documents:** encrypted, outside your notes, opened only after your yes, each time.
  [Private documents](./user/private-documents.md)
- **Email, calendar and files:** the steps to connect Gmail, Calendar and Drive through your Claude
  account, on one page.
- **Set it up by asking.** The assistant beside every screen can check how Majordome is set up and
  change most settings for you. For what only you can do, it names the screen as a link that opens
  it. [Setting Majordome up by asking](./user/assistant-settings.md)

### Your machines

- **Back up my brain:** copies of your notes and their history to GitHub, a folder or Google
  Drive, and a restore in the app. [Backup](./user/backup.md)
- **Your phone with nothing to install:** scan a code, add the app to your Home Screen, get
  notifications. It works away from home over a private address.
  [Phone and notifications](./user/phone-and-notifications.md)
- **A reinstalled iPhone app starts clean:** it forgets the computers and the sign-in iOS kept
  from the deleted copy, and opens on a welcome.
- **A phone app that takes in someone with nothing yet:** its first screen has a way for people
  new to Majordome, which says where to get it for a Mac and sends the link there, or offers a
  server.
- **Two kinds of server, told apart by name and icon:** "Your server" for one you run and
  "Majordome server", with a cloud, for one Majordome hosts for you.
- **A server Majordome hosts for you, by invitation:** one code, half a minute, no terminal,
  and one button to move the notes on your computer to it.
- **A server of your own, set up for you:** a small rented computer that keeps your conversations
  and runs routines while your Mac sleeps, and updates itself every night.
  [Your servers](./user/always-on-server.md)
- **A server you already have, in one command:** paste one line on any Linux server; it installs
  Majordome behind Tailscale and ends with a link. The app then moves your notes to it and keeps
  the two copies in step.
- **One page for your servers, in plain words:** a drawing of this computer, your phone and your
  servers with the main one marked, then each server with what is on it (your notes, your
  routines, an AI account), a way to add one, to remove one, and to make another one the main.
  T3 Code's map of machines and routes stays under Others, Computers.
- **Settings in six parts that explain themselves.** Four of them open on a page with a few
  lines and a drawing of how the pieces fit, written for someone who has never opened Settings.
- **An optional account that finds your servers:** sign in on a new device, in the app or at
  majord.me/open, and it connects with no code. It is identity only, and separate from T3
  Connect, which stays off. [Your account](./user/account.md)
- **Conversations kept on the server,** so your phone and your computer show the same ones. A
  topic's older conversation moves there by itself.
- **Your own sign-in in the server's browser,** copied one site at a time, by you only.
- **Three levels of AI instead of a model list:** Quick, Everyday and Powerful, each mapped to the
  right model of the AI account behind it (Haiku, Sonnet and Opus with Claude). The message box
  shows the level and changes it; Settings says which model each level uses. The mapping is
  refreshed hourly from Majordome's repository, so it follows new models without an app update.
- **A lighter start to every conversation:** the assistant is not handed Claude's publishing
  tools or the owner's personal Claude Code plugins, and a routine's cache is kept five minutes.

### First run and wording

- **A welcome screen with two questions:** sign in to Claude or ChatGPT, and choose your notes.
  On a server, signing in to Claude is a link to open and a code to paste, with no terminal.
- **A Status page** that answers one question: is your assistant OK? What needs you is listed
  first, each line leading to where you fix it. [Status](./user/overview.md)
- **Plain words everywhere.** Settings open on Status, each page starts with one sentence saying
  what it is for, and messages name pages as the app does.
- **Chats on their own background.** A chat, and the Assistant panel beside a page, sit one step
  lighter than the pages, so the conversation is easy to find.
- **A message box that stands out.** A blue line on its edge, and a glow while you type.
- **A jump list on long settings pages.** Under the title, the page's sections are listed on one
  line that stays in view; click one to go there.
- **One computer at a time.** Pages that say the same things about each computer (Connections,
  Back up my brain, Private documents) have a switch under the title instead of repeating
  themselves.
- **No usage data.** T3 Code sends anonymous usage data unless you turn it off. Majordome sends
  none and says so in the app, with [its own privacy page](https://majord.me/privacy).
- **Its own name, icon and updates.** The `majord` service and its updates come from Majordome's
  releases, never from T3 Code's.
- **What's new, inside the app.** After an update, the app offers that version's notes: what
  to try first, then what changed, with the versions before folded underneath. They stay in
  Settings, About. T3 Code shows notes only before you update.
- **A "?" for help.** At the foot of the icons: What's new (with a dot until you have read the
  notes of an update), the guides, and Report a problem, which fills in your version and what you
  run the app on and nothing else.
- **An update button that says "Update".** A waiting version shows as a tinted, labelled button
  at the foot of the chat list. T3 Code shows a small icon.

## What Majordome leaves out

Coding stays in T3 Code. The code is still there, hidden, so that upstream changes merge cleanly.

- Projects, worktrees, pull requests, the terminal and source control are not shown.
- The assistant is not told about pull requests or issues.
- About 27 settings that only matter when writing code are hidden.
- No T3 account, T3 Connect, or T3's phone apps. Adding a computer over SSH is not offered.
- Sharing a chat with a guest is not offered: T3 Code's guest links travel through T3 Connect.
  A Majordome version is noted in [whatsnext.md](whatsnext.md#sharing-a-chat-with-a-guest).
- An iPhone app of Majordome's own is being built from upstream's (not in the App Store yet):
  Today, one list of topics and chats, plain words in a conversation, offline capture, and a
  Majordome server bought through Apple from the phone. It has its own links, and a
  server's phone code can open it.

## What comes from T3 Code

Majordome would not exist without it. From T3 Code, unchanged or close to it:

- The engine that runs conversations, keeps their history and survives restarts.
- The connections to Claude, ChatGPT (Codex) and the other AI providers.
- The desktop app, the web app and the link between your machines.
- Scheduled tasks, secrets, the side browser and pictures in replies.

T3 Code is by T3 Tools Inc., under the [MIT License](../LICENSE).
