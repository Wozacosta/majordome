# What's new in Majordome

Newest first. Each version says what changed and what is worth trying, in the app's own words.
The section for a version is also the text of its release on GitHub.

## Next

Not released yet.

**New**

- **The server updates itself.** An always-on server now updates every night at 05:00 and clears
  out old versions. One set up by hand needs a one-time command; see the Always-on server guide.
- **One "needs attention" card.** The card at the foot of the sidebar now also appears for a
  signed-out AI account, routines that can't run, and a computer that can't be reached. With
  several problems it says how many and opens Status.
- **Phone & notifications is one page.** Phone setup is a checklist that ticks itself off, with
  notifications below it.
- **Plainer Settings.** About 145 labels are reworded, and the Connections page links to where a
  sign-in is fixed.
- **Reading list thumbnails.** A saved link shows its page's own picture (a video's thumbnail, an
  article's cover). For links saved before, use **… > Look it up again**.

**Fixed**

- A GitHub sign-in is no longer forgotten the first time GitHub refuses it, only after two rounds
  in a row.
- Settings search finds pages by everyday words: "phone", "text size", "sleep", "laptop".
- Reading list: "Hide finished" is a switch, so you can see whether it is on.

**Try this**

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
