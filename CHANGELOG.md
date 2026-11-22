# What's new in Majordome

Newest first. Each version says what changed and what is worth trying, in the app's own words.
The section for a version is also the text of its release on GitHub.

## Next

**Fixed**

- **Open in Obsidian finds the folder.** Obsidian answered "Vault not found" when it knew the
  notes folder under another path than Majordome does, such as a shortcut to it. The link now
  names the folder instead of its path.

**New**

- **Keys for topics and their chats.** Ctrl+Tab and Ctrl+Shift+Tab move through the chats of the
  topic you are reading, like tabs in a browser; Cmd+Option+Right and Left do the same.
  Cmd+Option+Down and Up open the next and the previous topic. Cmd+G opens a search over your
  topics: type a few letters and press Enter. All five can be changed in Settings, under
  Keybindings.

## 0.10.15

**Changed**

- **New chat no longer looks like the page you are on.** In the sidebar, New chat and the search
  button are now outlined rather than filled, they sit a little apart from the list of pages,
  and the page rows are slimmer. Only the page you are on is filled.

**Fixed**

- **Open in… shows with an always-on server.** Notes opened from a topic showed the server's copy,
  so the button to open the file in Obsidian or an editor was missing. It now opens this
  computer's copy of the same note, and the path shown on hover is the one on this computer.

## 0.10.14

**New**

- **Key facts beside every conversation.** The links, places, dates and names you mention are
  now listed on the right of the conversation, in the main chat of a topic and in every other
  chat. The list updates after each reply. A link opens; anything else is copied when you click
  it. Each update is one small extra request to your AI plan.
- **The conversation in short, and drawn.** Under the key facts, "In short" says in a few lines
  what you asked, what was settled and what is still open, rewritten after each reply. "Draw it"
  shows the conversation as a small diagram; a drawing is made only when you ask, and each one is
  one small request to your AI plan.

**Try this**

- In any conversation, mention a link, an address, a name and a day ("next Thursday at 10"),
  and wait for the reply: they should appear under **Key facts** on the right, the day written
  out as a date. Click the link, then click the name.
- Under them, read **In short** after a few replies: does it say where the conversation stands?
- Press **Draw it** in a conversation about a plan or a choice. Close it and press it again: the
  same drawing should open at once. **Draw again** makes a new one.

## 0.10.13

**New**

- **Subjects for the reading list.** Group what you saved around what you are learning: make a
  subject with **+ Subject**, file rows under it from their **…** menu, and press a subject to
  see only its rows. Put the few you are working on **in focus** and **Next** shows the top row
  of each, instead of the first three of the whole list. Subjects are separate from the topics
  in the sidebar. The assistant can file a row under a subject; it never makes one.
- **Open a note in another app.** A file open in **Notes** has a button beside its name that
  opens it in Obsidian, in an editor installed on this computer such as VS Code, or in the
  default app for its kind; it can also show the file in its folder or copy where it is. The
  button remembers the app you used last. It shows when the notes are on the computer you are
  using, so not on the phone.

**Try this**

- In Reading list, **Everything**: press **+ Subject**, name it, then file two rows under it.
- Choose the subject, open the **…** beside it and **Put in focus**; then look at **Next**.
- In **Notes**, open a note, press the arrow beside its name and choose **Obsidian**.

**Fixed**

- A chat under a topic is highlighted in the sidebar while it is open, like the topic itself.

## 0.10.12

**New**

- **With an always-on server, your conversations live on the server.** Chats you start on your
  computer are now kept on your always-on server, so your phone shows the same ones. Conversations
  you had before stay on your computer, listed under their topic as "Chat on this Mac". If the
  server can't be reached, Majordome says so instead of starting a second conversation on your
  computer. If the server's AI is signed out, conversations stay on your computer until it is
  signed in.
- **The assistant works on your reading list.** Ask it in any conversation to save a link for
  later, say what is next, note what you took from something, or find a few things on a subject
  and add them. Links it saves now get their title, picture and length like the ones you paste,
  and it writes a **Why** line on what it recommends.
- **Search the reading list.** The field above the filters finds rows by any words in their
  title, site, tags, summary, notes or link.
- **Done a bit.** On a Next card or in a row's **…** menu: say where you got to, and the row keeps
  it and steps aside until tomorrow.
- **A Trash for the reading list.** Removed rows wait in a folded Trash group, where you can put
  them back or delete them for good.

**Try this**

- Ask the assistant: "save https://… for later", then "what should I read next?".
- Open Reading list, type a word in the search field, and press **Done a bit** on a Next card.
- Remove a row, open **Trash** under the list and put it back.

**Fixed**

- **Reading list pictures fill themselves in.** A link saved before pictures existed, or while
  its site was down, stayed without one until you chose "Look it up again" on it. Majordome now
  looks those pages up again by itself when it starts.
- The Phone page says "your always-on server" in its sentences, not "Always-on server" as if
  that were a name.
- The sidebar's row of icons fills the width, with larger icons.

## 0.10.11

**New**

- **A topic's chats are tabs.** Under a topic's name there is now a row of tabs: **Main**, the
  topic's one continuing conversation, then its other chats, and a **+** that starts one more from
  the topic's notes. The cross on a tab marks that chat as done; the main one stays.
- **With an always-on server, your phone connects to the server.** "Set up my phone" on your
  computer now gives the address to the computer that runs your routines, when that is another
  one, and the code opens your phone on it. So the phone shows the routines and chats that live
  there and keeps working while your own computer sleeps. If your own computer already has an
  address, the page says so and offers to turn it off. To move a phone you already set up: turn
  that address off, press "Set up my phone", scan the new code and add Majordome to the Home
  Screen again.

- **The sidebar menu folds into a row of icons.** On a phone, Today, To-dos, Reading list,
  Routines and Reminders start as five icons on one line, which leaves the screen to your topics.
  The small arrow at the end of the row shows the names again, and the arrow next to
  "Automatic" folds them back. Works on a computer too; your choice is remembered per device.

**Fixed**

- On a computer that already had Tailscale, the Phone page opened the old Tailscale steps and
  made it look as if the phone still needed Tailscale. "Set up my phone" now always leads, and
  the Tailscale steps stay folded under "More private" unless you open them.

## 0.10.10

**New**

- A phone icon at the bottom of the sidebar, next to Settings, opens phone setup directly. It
  shows on a computer, not on the phone itself.

## 0.10.9

**New**

- **Your phone, with nothing to install on it.** Settings > Phone & notifications now starts with
  "Set up my phone": Majordome gets this computer its own address, you scan a code, add Majordome
  to your Home Screen and turn on notifications. No Tailscale and no account. The address is on
  the internet (only devices you add with a code get in) and the connection passes through
  Cloudflare; "Turn off this address" closes it at once. Tailscale is still there under "More
  private: only your own devices", and a phone already set up that way keeps working.
  Worth trying: set up your phone on mobile data, with Wi-Fi off, and send yourself a test
  notification.

**Fixed**

- The assistant panel's intro is one short line ("Ask about Private documents, or say what to
  change.") instead of two sentences describing where you are.
- Status no longer says routines "couldn't finish" on a computer that isn't the one running them.
  When your always-on server runs the routines, this Mac's dormant copies are not listed or
  counted as problems.

## 0.10.8

**Changed**

- **Chats have their own page.** The Recent and Earlier lists are gone from the sidebar. One
  "Chats" row under your topics, with how many are still going, opens a page listing the chats
  that aren't part of a topic, newest first, with the finished ones folded under "Earlier".
  Search in the sidebar still finds any chat.

**New**

- **Reading list: a Next view.** Just the first three things to do, each with **Finished** and
  **Not now**. Switch back to **Everything** any time.
- **Reading list: snooze.** Put something off until tomorrow, next week or in a month. It waits in
  a folded **Snoozed** group and comes back on its day by itself.
- **Reading list: videos and podcasts show how long they play**, YouTube included, and you can
  change what kind of thing a saved link is from its **…** menu.
- **Settings on a phone is a list you tap into**, with a "‹ Settings" button to go back, instead of
  a column of unlabelled icons.
- **Every Settings page starts with a title and one sentence saying what it is for**, and all
  pages share the same look. The page you are on is clearly marked in the list.

**Fixed**

- A brand-new notes folder no longer shows "Routines aren't running" for a few seconds.
- The strip above a topic's chat now says what it is: "Where things stand".
- Adding a Markdown file through a topic's Files offers "Open it", which opens the note.
- On Today, "Plan my day" sends straight away. If you already typed something, it is kept and
  nothing is sent for you.

**Try this**

- Reading list > **Next**, then **Not now** on one of the cards. On a video saved earlier,
  **… > Look it up again** should bring its length.
- Open Settings and click down the list: every page should look like the same app. Make the
  window narrow (or use your phone): Settings should become a list you tap into.
- Press "Chats" under your topics: your recent chats should all be there, and "Earlier" should
  hold the ones you marked as done.

## 0.10.7

**New**

- **Notes can be edited.** Open a Markdown note in Notes and press **Edit**: type, and it is saved
  a moment after you stop. **Done** goes back to the note as it reads. If the assistant or another
  device changed the note meanwhile, you choose whose version to keep.

**Changed**

- **Feed and Notes left the sidebar.** Both are still there: from Today ("All notes" and
  "Everything it did" beside "Lately in your notes"), from a topic's header and side panel, and
  from the command menu ("Open notes", "Open feed"). The Feed's dot became part of the card at the
  foot of the sidebar: "The assistant is waiting for you" or "…couldn't finish something".

**Fixed**

- In a topic, the "Where are we?" and "What's next?" chips now send at once. "Remind me…" still
  waits in the box for you to finish the sentence.
- Adding a Markdown file to a topic looked like nothing happened: it is a note, so it goes under
  Notes, not Files. The app now says so, and the Notes list and its count update right away.

**Try this**

- Today > "All notes", open a note with a table or a picture, press **Edit**, type, then **Done**.
- In a topic that already has messages, press "Where are we?": it should send by itself.
- Add a `.md` file through a topic's Files: a message should say it went to Notes.
- With the Feed gone from the sidebar, check you can still get to it from Today and the command
  menu.

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
