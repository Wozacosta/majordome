# What's new in Majordome

Newest first. Each version says what changed and what is worth trying, in the app's own words.
The section for a version is also the text of its release on GitHub.

## Next

Not released yet.

**Fixed**

- In a topic, the "Where are we?" and "What's next?" chips now send at once. "Remind me…" still
  waits in the box for you to finish the sentence.
- Adding a Markdown file to a topic looked like nothing happened: it is a note, so it goes under
  Notes, not Files. The app now says so, and the Notes list and its count update right away.

## 0.10.6

**New**

- **A topic's page says where things stand.** Above a topic's chat, a short strip shows where
  things are and what comes next, kept by the assistant at the top of the topic's log. It folds
  to one line, and appears once the assistant has written it.
- **The topic's header names it**: its icon, its name, where its notes are, how many, and when it
  was last touched, with the topic's menu beside it.
- **The side panel is about the topic**: its notes, its to-dos (tickable), its routines and
  reminders, its files and its other chats. The usage meters are gone from there; one line appears
  only when your AI plan is running low.
- **Files open instead of downloading** when the browser can show them (PDFs, pictures, text),
  with a separate download button and the date beside each.
- **Mark a topic as finished.** It leaves the list and can be brought back from "Show finished";
  its notes and chat stay.
- **A first screen for a new topic**, with three ways to start.
- **One-tap replies.** When the assistant ends with an offer ("Want me to set a reminder?"), its
  answers appear as buttons under the message.
- **Days in a chat.** A quiet line names each day, and "New since you were last here" marks what
  arrived while you were away.
- **A quieter chat.** "Worked for 6s" rows and the model picker in the message box are gone (both
  remain in Settings), and the jump bar on the left appears only in long chats.

- **The server updates itself.** An always-on server now updates every night at 05:00 and clears
  out old versions. One set up by hand needs a one-time command; see the Always-on server guide.
- **One "needs attention" card.** The card at the foot of the sidebar now also appears for a
  signed-out AI account, routines that can't run, and a computer that can't be reached. With
  several problems it says how many and opens Status.
- **Phone & notifications is one page.** Phone setup is a checklist that ticks itself off, with
  notifications below it.
- **Plainer Settings.** About 145 labels are reworded, and the Connections page links to where a
  sign-in is fixed.
- **Tags and a summary, written for you.** When you save a link, your own AI account suggests up
  to three tags and one sentence on what it is about. Tags you already use are preferred, and
  nothing you tagged yourself is changed. With no AI account ready, the link is saved as before.
- **Reading list thumbnails.** A saved link shows its page's own picture (a video's thumbnail, an
  article's cover). For links saved before, use **… > Look it up again**.

**Fixed**

- A GitHub sign-in is no longer forgotten the first time GitHub refuses it, only after two rounds
  in a row.
- Settings search finds pages by everyday words: "phone", "text size", "sleep", "laptop".
- Reading list: "Hide finished" is a switch, so you can see whether it is on.

**Try this**

- Open a topic: the header should name it and link to its notes; the side panel should list its
  notes, routines and files.
- In a topic, say something that changes where things stand, then reopen the topic: a "Where
  things stand" strip should appear above the chat. (It needs the assistant to write it first.)
- Ask the assistant something it will answer with an offer, such as "remind me about this": do
  buttons appear under its reply, and does one tap answer?
- Topic menu > Mark as finished, then "Show finished" at the end of the list and Bring back.
- Create a new topic and look at its first screen.
- Click a PDF in a topic's Files: it should open in a tab, not download.
- Reading list: save a new link and wait a few seconds; "Adding tags and a summary…" should give
  way to tags and a sentence under the title.
- Reading list: on the two links you already saved, **… > Look it up again** should bring their
  pictures. Save a new video and a new article and check both show one.
- Settings > Phone & notifications: do the steps already done show "Done"? Does the old
  Notifications entry in the command menu land on the notifications part?
- Sign out of your AI account (or turn it off) and watch the foot of the sidebar.
- Search Settings for "phone" and "text size".
- On the server: run the one-time command from the guide, then `systemctl list-timers` should list
  `majordome-update`.

## 0.10.5

**New**

- **Reading list.** A screen in the sidebar for what you want to read, watch or listen to later.
  Paste a link and Majordome looks up its title, where it is from and how long it takes. Tag,
  star, reorder by dragging, add a note, mark finished, filter by kind or tag. The list lives in
  your notes folder.
- The ready-made topics "Reading" and "Learning" are gone; the Reading list replaces them.

**Try this**

- Paste an article link, a YouTube link and a plain title. Paste the same link twice.
- Drag a row, tick one as finished, turn "Hide finished" off and on.
- In a chat, say "save this for later" with a link, then look at the Reading list.
- Row menu > Ask the assistant about this, before and after finishing something.

## 0.10.4

**New**

- **New sidebar.** New chat is a button with search beside it; then Today, Feed, Notes, To-dos;
  Routines and Reminders sit under "Automatic". Connections moved to Settings.
- **The backup warning is a card** at the foot of the sidebar, shown only while something is
  wrong.
- **Settings opens on Status** and is grouped by what you are setting up: Your notes, The
  assistant, Your devices, This app, with Advanced folded away. "Chat" is now "Writing messages",
  "Chats" is "New chat defaults", "Keybindings" is "Keyboard shortcuts".
- About 27 settings that only matter when writing code are hidden.

**Fixed**

- A topic you drag no longer jumps back for a moment after you drop it.
- A reminder set with the assistant no longer links to a chat you can't find again.

**Try this**

- Click the search button: the field appears under New chat and goes away when left empty.
- Drag a topic to a new place and watch the moment you let go.
- Open Settings: it should land on Status.

## 0.10.3

**New**

- **Dragging topics** to reorder them: the topic follows the pointer and the others make room. On
  a phone, hold a topic for a moment, then drag.
- **Ready-made topics** in New topic (Meals, Money, Health, Trips, Home and paperwork, Job
  search, People), each with starter notes and usually a routine that posts in the topic's chat.
  A folder you already have for the subject is used as it is.
- **Ready-made routines** on the Routines page: What needs a reply, Prepare tomorrow, Evening
  journal prompt.

**Try this**

- New topic with an empty name: pick a ready-made one, then check Routines for its routine.
- Routines > Ready-made routines > Add.

## 0.10.2

**New**

- **Setup can't be skipped by accident.** The welcome page stays until the assistant is ready or
  you choose to continue without it.
- **Failed loads say so**, with a way to try again, on Routines, Reminders and To-dos.
- **Plainer menus and settings**: chat, the assistant, AI account, notes folder, computer.

**Try this**

- Today with no AI account set up: it should say so and link to the fix.
