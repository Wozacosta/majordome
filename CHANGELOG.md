# What's new in Majordome

Newest first. Each version says what changed and what is worth trying, in the app's own words.
The section for a version is also the text of its release on GitHub.

## Next

Not released yet.

## 0.10.52

**New**

- **A chat you keep for weeks stays up to date with your notes.** A conversation used to keep the
  notes it was given when it began: your memory note, the daily notes, its topic's notes. Now
  the first message you send it on a new day gives it all of them again, as they are that day,
  along with where your other topics stand. A routine that runs every day in one chat gets the
  same. Nothing to turn on, and it works with every AI account.

**Try this**

- Tomorrow, in a topic you have used for a while, ask "what is in my memory note about …" for
  something you added since the chat began. It answers from today's note without going to look.

## 0.10.51

**New**

- **The levels keep up with new models without an update of the app.** Which model Quick,
  Everyday and Powerful mean for each AI account is now a small list in Majordome's repository.
  Your computer and your server read it once an hour, so when a maker renames a model or adds a
  new one, the levels follow within the hour. A model you chose yourself in Settings is never
  changed. Offline, or with "check for updates" of AI accounts turned off, the list that came
  with the app is used.

**Try this**

- Nothing to see: Settings, AI accounts, "Levels of AI" shows the same models as before.

## 0.10.50

**New**

- **Three levels of AI: Quick, Everyday, Powerful.** Majordome now asks for a level, not a model.
  Quick does the small jobs (chat titles, key facts, summaries, drawings). Everyday is for your
  chats and routines, and new chats start on it. Powerful is for hard questions, when you choose
  it. Each AI account has its own three, taken from what its maker recommends: Haiku, Sonnet
  and Opus with Claude; Luna, Sol and Astra with ChatGPT (Codex); Flash, Argon and Carbon with
  Gemini; Composer, Auto and Grok 4 with Cursor; Haiku, Auto and Opus with Kiro.
- **Choose the level in the message box.** A new control at the bottom of the message box, on
  the computer, shows the chat's level and moves it to another one. It names the model behind
  each level. On the iPhone, the three levels are at the top of "Which AI".
- **Choose the model for each level.** Settings, AI accounts, "Levels of AI" lists the three
  levels with the model each one uses, and lets you change it.

**Changed**

- New chats and new routines start on the Everyday model (Sonnet with Claude). Before, they
  followed the model of your last chat, which was often Opus. Chats and routines you already
  have keep their model until you change it in their message box.

**Try this**

- Open a chat. At the bottom right of the message box, press "Everyday", choose "Powerful", and
  send a message.
- Start a new chat: it is on "Everyday" again.
- Settings, AI accounts, "Levels of AI": change the model for Powerful, then look at the list in
  a chat's message box.

## 0.10.49

**New**

- **Bitwarden Secrets Manager as a place keys are kept.** Settings, Passwords and keys, Add
  source now offers Bitwarden Secrets Manager. It signs in with a machine account's access
  token, so it works on your always-on server; the Bitwarden password manager is not supported,
  because it needs your master password. Save the access token as a key named `bitwarden`, then
  add the source. That key is marked "Signs Majordome in to…" and your assistant cannot take it.
- **A key your assistant uses can stay in 1Password, Bitwarden or any other source.** In "Add a
  key" on the computer, pick the source next to the key field and enter where the key is.
  Majordome keeps no copy and reads it from the source each time, so a key you change there is
  the one used. It refuses to save a place it cannot read.

- **A chat now knows about your other topics, and says when it looks in one.** Every
  conversation is told the names of your other topics and where each one stands. When your
  question touches another topic, it reads that topic's notes and names the topic in its answer.
  It is also told that a fact for all your topics belongs in your memory note, the one note every
  chat starts with.
- **What this chat knows.** A chat's side panel has a new section listing the notes the chat
  starts with (the topic's own notes, your memory note, today's and yesterday's notes) and the
  topics it only knows the standing of. A row opens its note. On the iPhone it is under the "i"
  of a chat. A conversation already under way was given its notes when it
  began, so the first change shows in chats you start after the update.

**Fixed**

- The list of keys now updates right after you add or remove a source.

**Try this**

- In Settings, Passwords and keys, add a key, add an "Encrypted file" source, then add a second
  key that points at the first with `secret://` and its name: it shows "Kept in" and the source.
- Open a topic and look at "What this chat knows" at the bottom of the side panel. Then start a
  new chat and ask something only another topic's notes can answer, such as a date or an amount
  from it: the answer should name the topic it looked in.
- With a Bitwarden Secrets Manager account: follow "Bitwarden Secrets Manager" in the Secrets
  guide, add a key kept there, and ask your assistant to use it.

## 0.10.48

**New**

- **Who can get into a server Majordome hosts, said plainly.**
  [majord.me/trust](https://majord.me/trust) lists what the person who runs Majordome can
  technically do on a hosted server, what he promises, and why a server of your own is the
  better choice if you can run one. It carries a prompt to paste into an AI assistant that
  helps you pick a server and set it up. The page that sells a server links to it.
- **Key facts, "In short" and Files on the iPhone.** A chat on the phone has a new button at the
  top right, an "i" in a circle. It opens what sits beside the chat on the computer: the
  conversation in short, then its dates, links, places and names, and for a topic the files kept
  with it. Touch a link to open it, anything else to copy it, and a file to look at it. "Add a
  file" puts one from the phone in the topic's folder; touch and hold a file to remove it. Not on
  the phone yet: "Draw it", searching the key facts, and adding or removing a private document.
  (From the next iPhone build.)

- **Keys your assistant can use, listed.** Settings, Passwords and keys now starts with the API
  keys, tokens and passwords saved for your assistant: add one, see when it was last used, remove
  it. Your assistant sees the names and what each is for, so it can tell you whether it can reach
  a service, and it uses a key without asking you for it again and without the key appearing in
  the chat. You can also hand it a key in a chat and ask it to keep it. On the iPhone the same
  list is under Settings, Passwords and keys (from the next iPhone build). Saving a key is the
  permission: the assistant does not ask before using one.

**Try this**

- In Settings, Passwords and keys, add a key, then ask in a chat "which keys do you have?".
- On the iPhone, open a topic's chat and touch the "i" at the top right.

## 0.10.47

**Fixed**

- **The app no longer says it collects usage data.** Majordome sends none, but the setup page
  and Settings, About still carried T3 Code's sentence about anonymous usage data and opened T3
  Code's privacy policy. Both now say "Majordome sends no usage data" and open
  [majord.me/privacy](https://majord.me/privacy). On the iPhone, Settings, About, Legal opens
  Majordome's page too (from the next iPhone build).
- **On the phone, a chat is as quiet as on the computer.** The "Worked for 6s" lines and the
  steps behind an answer are left out unless you choose otherwise in Settings, Appearance.
- **A topic is closed, not "done".** "Mark as done" on a topic is now "Close this topic", closed
  topics sit under **Closed topics**, and "Reopen" brings one back, on the phone and the computer.
  On the phone, a topic's chat no longer offers "Mark as done" at all.
- **Majordome's own steps show Majordome's mark,** not the T3 logo, on the phone and the computer.

**Try this**

- Open the menu of a topic (right-click on the computer, long press on the phone): it says
  "Close this topic". Close one, find it under Closed topics, and reopen it.
- Open Settings, About and press "View policy": it opens majord.me/privacy.

## 0.10.46

**Fixed**

- **A paid server is always made.** If making one was cut short, the page said "Your server is
  on" and nothing finished it; it is now finished within the hour, and the page goes on making
  it. Someone who paid just as the last place went gets their server too.
- **The hourly check on paid servers no longer waits on address cleanup,** and it can tell the
  owner when it fails.
- **A new topic opens when an old server is still connected.** With a server you used before
  still in Connections, a new topic could fail with "That topic is no longer in your notes":
  its chat was started on the old server, whose notes had stopped updating. Chats now start on
  the server that is in step with your notes.

## 0.10.45

**New**

- **The page that sells a server looks the part.** At
  [majord.me/start](https://majord.me/start) the price, the free days and what the server
  gives you now sit in one card, and making the server shows its four steps as a progress
  line.

**Fixed**

- **A topic's files open inside Majordome.** Clicking a private picture in a topic's Files list
  downloaded it through your web browser; it now opens over the chat, read into memory and never
  written to Downloads. An ordinary file opens in the side panel instead of a browser tab. A
  private file that is not a picture, such as a PDF, is still downloaded.

  **Try this:** in a topic, click a private picture (the lock icon) under Files: it should show
  over the chat, with nothing new in Downloads.

## 0.10.44

**New**

- **A Majordome server can be paid for,** once payment is switched on. At
  [majord.me/start](https://majord.me/start), sign in, pay by card and the server is made for
  your account; an invite code still works. The same page then shows how your subscription
  stands, opens Stripe's page for your card and invoices, and deletes your account. On the
  iPhone, **Get a Majordome server** buys it through Apple and connects the phone to it.
- **A server that is no longer paid for is switched off, not deleted.** Its notes are kept for
  30 days, and you can switch it on for a day from the same page to get them out. Paying again
  in that time brings the same server back.
- **The terms of a paid server are written down,** at [majord.me/terms](https://majord.me/terms):
  the price, the free week, cancelling, refunds, and what happens to your notes. The privacy
  page now says what paying keeps about you.

**Changed**

- **Key facts are short, and the full list opens beside the chat.** The chat's panel now shows
  three: what is coming first, soonest on top, then the latest links, places and names. **All**
  opens every key fact in the side panel, with a search field, grouped by kind, the days that are
  over last under "Earlier". **Key facts** is also a new entry in that side panel (press K).
- **A topic's files have a folder tree with search.** The side panel's **Notes** entry is now
  called **Files** and, in a topic's chat, opens on the topic's own folder. Under the topic's
  Files list, the line at the bottom opens the same tree. Majordome's own hidden folders no
  longer show in it.

  **Try this:** open a topic with a few files, click **Browse and search the folder** under
  Files on the right, and type part of a file name. Then click **All** next to Key facts.

**Fixed**

- **On the phone, Your account shows how each server's connection really stands.** It said "This
  phone is connected to it" for any server the phone had saved, even one that no longer
  recognised the phone, and offered no way back in. It now says what is wrong, and shows
  **Connect again** when the server has let the phone go.

## 0.10.43

**New**

- **An answer shows which services it used.** When the assistant reached Gmail, Google Calendar,
  Google Drive or another connected service, its logo and name sit under the answer. A service
  that refused is not shown.

**Fixed**

- **A phone signed in with your account stays signed in.** It was let in for one hour only, then
  the server "no longer recognised this phone". It now stays connected like a phone that scanned
  a code: for 30 days after it was last used. Sign in once more on the phone after updating.

**Changed**

- **On the phone, your account can be deleted** from Settings > Your account. Your notes and the
  computers already connected are not touched.
- **The phone no longer makes a Majordome server from an invite code.** That is done on the
  website. The phone still says a Majordome server exists, and finds yours when you sign in.

**Try this**

- On the phone, open Settings > Your account and press Connect on your server. Come back to the
  app after more than an hour: it should still be connected.

## 0.10.42

**Safer**

- **The assistant can no longer rewrite its own rules.** What a conversation or routine changes
  in `CLAUDE.md`, `AGENTS.md`, the notes folder's settings (routine limits included) or a
  `.claude` folder is put back when it ends, and what it wrote waits in `.agents/held-back/` for
  you to copy back. Changes you make in Majordome are kept.
- **Notes settings cannot point outside your notes folder,** and memory and daily notes are no
  longer read or written through a link that leads out of it.
- **A device you removed stops getting notifications.** If you pair a browser again, turn
  notifications on again on it.
- **Saved links are only looked up on the public internet,** also when a page redirects or its
  name leads to your own network or tailnet.
- **A copy of your notes is no longer left on the server** after moving them to another computer.
- **Signing in with your account now needs a key only your account holds for each server.** A
  sign-in shown to one server can no longer be used on another of yours. Majordome on your
  computer adds the key by itself the next time it starts; the phone needs this version.
- **Majordome asks before keeping two computers in step.** A server that says it holds your notes
  is no longer linked by itself: Settings > Back up my brain asks once, and "Not now" is kept.
- **The Mac asks before copying a site's sign-in to a server's browser,** once per site.
- **A server updates to the exact version a release names,** not to whatever "latest" points at.
  To get this on a server you set up yourself, run the update command from the guide once more.
- **Hosted servers answer over HTTPS only and each has its own private network.** This applies to
  servers made from now on.

**Try this**

- Open Majordome on your Mac, wait a minute, then update the iPhone app in TestFlight and open
  your server from Settings > Your account: it should connect as before.
- Ask the assistant to add a line to `CLAUDE.md`. When it finishes, the line is not there, and
  what it wrote is in `.agents/held-back/`.

## 0.10.41

**Fixed**

- **Usage "by other requests" no longer counts a conversation twice.** The first message after
  Majordome restarted was charged with everything said before it in that conversation, which
  made other requests look as large as the chats themselves.

**Improved**

- **On the phone, every topic is in one list.** A topic you have not talked in yet now sits at
  its own place among the others, in your order, not in a block above them.

## 0.10.40

**Improved**

- **Each conversation costs less to start.** The assistant is no longer handed Claude's
  page-publishing tools, which it never used here, nor your personal Claude Code plugins,
  skills and hooks. A first message is about 22,000 tokens lighter on a computer that has
  them, about 12,000 on a server. Skills in your notes folder are kept.
- **Routines cost less.** What a routine writes to the AI's cache is kept five minutes and not
  an hour, which is cheaper and enough for a run that takes a few minutes.
- **A privacy address.** Questions and deletion requests go to privacy@majord.me.
- **On the phone, topics stay at the top of Chats.** They keep their own order whatever they
  are doing, with your other chats under "Recent". A chat that is working is no longer folded
  away into a "Working" section.
- **On the phone, Settings starts with "Your account".** It shows your email, or "Sign in"
  when you are signed out.

**Try this**

- On the iPhone, update Majordome in TestFlight, then open Chats: your topics are at the top.
  Send one a message and watch it stay there while it works.
- Send an email to privacy@majord.me from another address and check it reaches you.

## 0.10.39

**New**

- **Your topic conversations follow you to your server.** A topic you talked in before you
  had a server kept that conversation on your Mac, so your phone started a new one. Now, once
  you have a server, each topic's conversation on your Mac moves there by itself, with
  everything said so far, and the assistant there knows it. A chat your phone already started
  stays under the topic. Pictures and files are not moved, and the copies left on the Mac are
  in Settings > Archived chats.

**Fixed**

- **Signing in from the Mac app adds your computers every time.** After a sign-in with Google,
  which leaves for the browser and comes back, nothing was added and the phone listed no
  server. The app now remembers that you pressed Sign in, waits for its connections to come
  back, adds each computer and opens Settings > Your account.

**Improved**

- **Set up your phone by signing in.** Settings > Phone & notifications now starts with
  majord.me/open: sign in on the phone and press Open, with no code to scan. It says what is
  missing when the computer is not in your account or has no address. The code is still
  there, under "No account? Use a code instead".
- **Your account page is shorter.** One Sign in button when signed out, each computer says
  what to do next, and errors say how to fix them.
- **Back up my brain puts the easy choice first.** The backup folder comes first, the page
  says one place is enough and shows one main button. A working backup says when the next
  copy is made, and messages use plainer words. A wrong passphrase on restore now says so.
- **Your server starts with the easy way.** Settings > Your server puts "Let Majordome host
  it" first, with the right address (majord.me/start); renting your own and the terminal
  guide follow. The terminal guide was missing one file to download.
- **The iPhone app gets you to your notes faster.** Sign in is the first choice everywhere,
  connecting your first computer returns to Today, an empty account says what to do on the
  computer with a Check again button, and a typed code has a Connect button.
- **majord.me/open opens your Majordome by itself** when you have only one, and
  majord.me/start accepts an invitation link with the code in it.

**Try this**

- Sign out in Settings > Your account, then press Sign in at the bottom of the sidebar. Your
  Majordome server should then show on your phone, at majord.me/open and in the iPhone app.
- Open Majordome on your Mac and wait a few seconds for "topic conversations moved to your
  Majordome server". Then open one of those topics on your phone: it is the same conversation.

## 0.10.38

**Improved**

- **Signing in adds your computers by itself.** Press Sign in and every computer and server
  the app is connected to joins your account, and the ones your phone can reach are listed
  there. No more "Add to my account" for each. A computer you later remove from the account
  stays removed until you sign in again.
- **One button gives this Mac an address.** When your phone cannot reach a computer yet,
  Settings > Your account now has "Give it an address" right there, and lists the computer as
  soon as it has one.

**Try this**

- Sign out in Settings > Your account, then press Sign in at the bottom of the sidebar. Your
  Mac and your servers should show your email without pressing anything else.
- If the page says your phone cannot reach this Mac, press "Give it an address".
- Open the iPhone app and sign in: your servers should be listed with a Connect button.

## 0.10.37

**Improved**

- **Add your always-on server to your account from the Mac.** Settings > Your account now
  lists every computer and server the app is connected to, each with "Add to my account".
  Before, it listed only this Mac, so a server Majordome hosts, the one a phone can reach
  from anywhere, could not be added.

- **Sign in is the first thing the iPhone app offers.** With no computer added yet, Today now
  opens on a Sign in button, above "Add a computer with a code" and the invite code.

**Try this**

- Open Settings > Your account. Each computer and server you are connected to has its own
  section. Press "Add to my account" on your Majordome server, then open the iPhone app and
  sign in: the server should be listed with a Connect button.

## 0.10.36

**New**

- **A Sign in button in the sidebar.** At the bottom, beside Settings and the phone. Signed
  in, it becomes a shortcut to Settings > Your account.

- **Sign in on the iPhone app.** "Add a computer" has a third way in: "Have a Majordome
  account?" Sign in with Google or your email and the phone lists your servers; press Connect
  and it is in, with no code to scan. (In the next iPhone build.)

**Try this**

- Look at the bottom of the sidebar: press Sign in, or, once signed in, the person icon, which
  opens Settings > Your account.

## 0.10.35

**New**

- **Sign in to find your servers.** A Majordome account is optional and does one thing: a
  device you sign in on finds your servers by itself, with no code to scan. In Settings > Your
  account, sign in with Google or your email and add this computer. Then, on a phone or any
  browser, open majord.me/open, sign in and press Open. Pairing with a code works as before.
  (The iPhone app does not have sign-in yet.)
- **A server Majordome hosts belongs to your account.** The invite page is now
  majord.me/start: sign in, enter your code, and the server is yours from its first start. If
  you ever lose every device, signing in gets you back in.

**Try this**

- Open Settings > Your account, press Sign in, and use Google or your email. Your email should
  show under Account.
- Press "Add to my account" next to this Mac. If it says other devices cannot reach it, turn
  the address on in Settings > Phone & notifications, come back and press "List it".
- On your phone's browser, open majord.me/open, sign in, and press Open next to your Mac.

## 0.10.34

**New**

- **The phone code can open the Majordome app.** In Settings > Phone & notifications, the code
  now has two choices: "In the browser", as before, and "In the Majordome app", which opens the
  iPhone app on its add-a-computer screen with the address and code filled in. Opened on a
  phone, the page also has an "Open in the Majordome app" button. (The iPhone app is not in the
  App Store yet.)

**Improved**

- **You can tell your phones apart.** In Settings > Phone & notifications, each phone that can
  open Majordome now says what it is and how it gets in, such as "iPhone, Majordome app" or
  "iPhone, Safari", with the day and time it was added. Before, two of them could both read
  "iOS".

## 0.10.33

**Fixed**

- **The icons of your servers were the wrong way round** in Settings > Computers and wherever a
  computer is shown: a server of your own had a cloud and a Majordome server had a server. A
  Majordome server is now drawn as a cloud and your own as a server. Each server shows the right
  one once it has updated.

## 0.10.32

**New**

- **Move the notes on your computer to your Majordome server.** Once the server is in this app
  (Settings > Computers > Add a computer), Settings > Your server > "Let Majordome host it" has
  a button, "Move my notes to your Majordome server". It copies your notes with their history,
  then the two copies follow each other, as with a server of your own. Nothing on your computer
  is removed. The page then shows what is left: signing in to Claude there, and moving
  routines. "Bring my notes back" undoes it and leaves the server as it is.
- **A Majordome server keeps a month of daily copies of its disk**, where it kept five days.

**Try this**

- On a new Majordome server, do not press "Start new notes". Add the server to the Mac app,
  then press "Move my notes to your Majordome server" and check a note appears on both.

## 0.10.31

**Fixed**

- **Phone setup on a Majordome server uses the server's own address.** The Phone page offered to
  give it a second address, as it does for a computer of yours. It now goes straight to the code
  to scan, says "your Majordome server", and leaves out Tailscale, same-Wi-Fi pairing and turning
  the address off, which do not apply there.

**Try this**

- On your Majordome server, open Settings > Phone & notifications, press "Show the code" and
  scan it with your phone.

## 0.10.30

**Changed**

- **A Majordome server's welcome page is two choices.** It shows Claude alone as the assistant,
  and for notes "Start new notes" or restoring a backup from Google Drive. Codex, other AIs and
  using a folder already on the computer are left out there; other AIs are still in Settings.
- **On a Majordome server, Settings > Your server says the server is looked after**, and no
  longer offers to set one up.

**New**

- **Majordome can host your server, by invitation.** With an invite code,
  <https://broker.majord.link/start> makes a server for you in about half a minute and opens it,
  already yours: nothing to rent, no terminal, no Tailscale. You sign in to Claude there with
  your own account and start new notes. Settings > Your server points to it under "Let
  Majordome host it".

**Try this**

- Open <https://broker.majord.link/start> with an invite code, wait for your server, press
  "Sign in" on Claude, then "Start new notes".

## 0.10.29

**Changed**

- **"Always-on server" is now "Your server".** The settings page, the guides and every sentence
  that named it say "your server". A server you already connected shows the new name too, and
  searching Settings for "always-on" still finds the page.
- **A server that Majordome hosts for you is called "Majordome server"**, and gets a cloud beside
  its chats where your own server gets a server and this computer a laptop. On its welcome page,
  starting fresh says the notes folder is on your Majordome server, not in your home folder.
- After signing in to Claude with a link and a code, the card just says "Signed in."

**Try this**

- Open Settings: the page that was "Always-on server" is "Your server". Search for "always-on"
  and it still comes up.
- On Routines or Status, check that sentences read "on your server".

## 0.10.28

**Changed**

- **Signing in to Claude on a server is a link and a code.** On the welcome page of a server you
  reach from a browser, or of another computer added to the app, "Sign in" on Claude now shows a
  button that opens Claude's sign-in page and a box for the code that page gives you. Before, it
  ran in a hidden terminal and said a page had opened in your browser, which a server cannot do.
  On your own computer nothing changes: the page still opens by itself.

**Try this**

- Open a server in a browser before Claude is signed in there, press "Sign in" on Claude, open
  the link, and paste the code. Claude should say Ready a moment later.

## 0.10.27

**Changed**

- **Connections, Back up my brain and Private documents show one computer at a time.** With more
  than one computer, a switch under the title picks which one you see, instead of every computer
  stacked down the page. On Back up my brain, a dot marks a computer whose backup needs you. The
  section line is gone from these pages; the other settings pages keep it.

## 0.10.26

**Changed**

- **The section line on settings pages is one quiet line.** With several computers on a page, it
  names the computers and shows only the sections of the one you are reading, instead of
  repeating every section per computer. The current section is underlined, not boxed.

## 0.10.25

**New**

- **The sign-in copy is in the side browser's menu too.** The three-dot menu now has "Use my
  sign-in for …", with your browsers under it, and "Sign out of … here".
- **The key stands out on a sign-in page.** When the page's address looks like a login page, the
  key button in the side browser's bar is outlined and coloured, so you know it can help.

**Try this**

- Open github.com/login in the side browser: the key button should be outlined. Open the
  three-dot menu and find "Use my sign-in for github.com".

## 0.10.24

**New**

- **Long settings pages list their sections under the title.** The line stays at the top while
  you scroll, shows where you are, and takes you to a section when you click it. Try it on Back
  up my brain, AI accounts, Connections or Phone & notifications.

**Changed**

- **Restoring notes: the destination can be typed.** "Where your notes go" has a "Type a path
  instead" line, like the backup's location has.

**Fixed**

- **The sign-in button shows on every tab.** The key button in the side browser's bar only
  appeared on tabs running on another computer. It is now there for tabs that load on this
  computer too, where it signs Majordome's own browser in to the site.
- **The "Not saved" message on a note no longer squeezes into a one-word-wide column** when the
  note is shown in a narrow space; its buttons move below the text instead.

**Try this**

- Open a site in the side browser yourself, such as github.com. Press the key button in its bar
  and pick Chrome: the page should reload signed in.
- Open Back up my brain in Settings and use the line of sections under the title.

## 0.10.23

**New**

- **Use your own sign-in in the server's browser, one site at a time.** A chat kept on your
  always-on server browses signed out. In the desktop app, the side browser's bar now has a key
  button: press it on a page and choose Chrome, Safari or another browser on this computer, and
  that one site's sign-in is copied over. The same menu signs the server out of the site again.
  Only you can press it; the assistant cannot ask for your sign-ins.

**Try this**

- In a chat kept on your always-on server, ask the assistant to open a site you are signed in to
  in Chrome, such as github.com. Press the key button in the side browser's bar and pick Chrome:
  the page should reload signed in as you.
- From the same menu, choose "Sign out of … here": the page should reload signed out, and your
  own Chrome should still be signed in.

## 0.10.22

**Changed**

- **The backup passphrase is no longer shown on screen.** Setting one up asked you to type it
  twice and then displayed it in clear with an "I wrote it down" box. It now only asks twice, with
  a yellow reminder to write it down on paper.
- **Chats open in place in the sidebar.** The Chats row has an arrow that lists the chats still
  going right under it, like a topic does. The row itself still opens the page with all of them.

**Fixed**

- **The list of devices that get notifications keeps itself up to date.** Turning notifications
  on from your phone did not show on your computer until you reopened the page. The list now
  reads again every few seconds while you look at it.
- **Removing a phone also stops its notifications.** A phone removed from "Phones that can open
  Majordome" stayed in the list of devices that get notifications. It now leaves both. This works
  for phones that turn notifications on from this version; one set up before still has to be
  removed from the second list by hand.
- **Unsaved writing comes back when the note's computer can't be reached.** Going back to a note
  whose save failed showed "Environment … is offline" instead of what you wrote. It now shows your
  text with the "Not saved" line and Try again. A note that can't be read says so in plain words.

## 0.10.21

**Changed**

- **Done chats leave the sidebar.** A topic's list in the sidebar shows only the chats still
  going; the "Show done" row is gone. Done chats are at the bottom of "Other chats" in the
  topic's side panel, under "Done", each with a "Bring back" button. The Chats page still lists
  them all.
- **An empty chat is not listed, and not made twice.** A chat opened with + or Cmd+T shows in the
  tabs and the sidebar only while you are in it, until you write in it. Pressing + again opens
  that same empty chat instead of adding another "New chat".

**Fixed**

- **Closing a chat that is still working asks first.** The X on a topic's tab used to fail with
  an error naming the chat by a code. It now asks "Stop it and mark it as done?" and does both.
  Elsewhere, a chat that cannot be marked as done says why in plain words: it is still working,
  it is waiting for your answer, or it has a message waiting to be sent.

**Try this**

- In a topic, send a chat a long question and press the X on its tab while it answers: it should
  ask before stopping it.
- Mark a chat under a topic as done: it leaves the sidebar. Open the topic's side panel, press
  "Done" at the bottom of "Other chats", then "Bring back".
- Press Cmd+T twice in a topic without writing anything: you should land in the same empty chat
  both times.

## 0.10.20

**Fixed**

- **A new chat in a topic no longer flashes.** Starting one from the + or with Cmd+T made the
  topic's tabs vanish for a moment and the header offer "Make this a topic", until the server
  confirmed where the chat belonged. The new chat now joins its topic's tabs straight away.

**Try this**

- In a topic, press Cmd+T a few times: each new chat should appear in the tabs without the row
  of tabs disappearing first.

## 0.10.19

**New**

- **Cmd+T starts a new chat in a topic.** While reading a topic, Cmd+T (Ctrl+T on Windows and
  Linux) does what the + beside its tabs does: a new chat about it, starting from its notes.
- **Chats under a topic show how they are doing.** In the sidebar, each chat listed under a topic
  now carries the same small dot as the topic itself: working, waiting for you, or a reply you
  have not read.
- **Claude with an API key.** No Claude plan? In Settings, under AI accounts, the Claude account
  now has a "Claude API key" field. Paste a key from the Claude Console and Majordome uses it:
  every message is then billed by use, and your connectors are left out. Remove the key to go
  back to your plan.
- **Your assistant writes skills for itself.** Tell it how you want something done "from now on"
  and it writes the steps down as a skill, so the next conversation does it right the first time.
  The nightly "Tidy my memory" routine does the same for ways of doing things it finds in your
  notes. Nothing it writes is used until you say yes: Settings, then Skills lists what waits, with
  the exact steps to read, and Keep or Delete. "Stop using" on a skill moves it back to the
  waiting list. A reply that wrote a skill says so under it, with a Review button.
- **Restore from a backup, in the app.** Choose the folder your backup is in, type your
  passphrase, and your notes come back in a new folder. It is on the welcome screen and in Back
  up my brain; nothing already on the computer is changed.
- **Notes and What it did in the sidebar.** Notes has its own row, and the list of what the
  assistant did is under Automatic. That list is now called "What it did" everywhere.
- **Act on a chat without opening it.** Every chat on the Chats page has a "…" menu: rename it,
  mark it as done or bring it back, add it to a topic, or delete it. The arrow next to a chat's
  title is always visible, so the same menu is easy to find on a phone.
- **See and remove the phones that can open Majordome.** Phone & notifications lists every phone
  you added. If you lose one, "Remove this phone" cuts its access.
- **Connecting Gmail, Calendar and Drive is explained.** "Email, calendar and files" shows the
  steps and a button to your Claude account's connectors when nothing is connected, and a
  connector that needs a sign-in links to where you sign in.
- **See and change your focus from Next.** The reading list's Next view says which subjects it is
  showing, with a Change button to tick subjects in or out of focus.
- **Set up a routine from the page.** The Routines page has a "Set up a routine" button, and each
  routine's switch says "On" or "Off".

**Changed**

- **Chats no longer carry coding tools.** Your assistant is not told about pull requests, issue
  trackers or code worktrees any more: about a fifth less to read before each answer.
- **Routines say when nothing will run.** The Routines page tells you when routines are paused
  until tomorrow, when no computer runs them, or when they only run while this computer is awake.
  A routine stops promising a next run in the meantime.
- **A skipped run reads as skipped.** A routine whose time passed while the computer was asleep
  says so, with the day and time, instead of showing a failure. Every last run says when it was.
- **Reminders warn when nothing will ring.** If no phone or computer has notifications turned on,
  the Reminders page says so and links to where you turn them on.
- **Always-on server setup says what it needs first.** The page lists the two accounts, the
  payment card and the rough monthly price before asking for anything, shows one key's steps at a
  time, and has one button: "Check my keys", then "Set up a server for me". Putting the server on
  your phone now goes through Phone & notifications, with nothing to install.
- **Phone setup shows your progress.** Each step is marked Done as soon as Majordome can see it,
  and the notifications switch says why it won't turn on.
- **Pick the backup folder instead of typing it,** with one-click buttons for iCloud Drive,
  Dropbox, OneDrive and Google Drive when they are on the computer.
- **Asking before removing.** Stopping a backup, disconnecting Google Drive, forgetting the GitHub
  sign-in or the server keys, and "Delete for good" in the reading list's Trash now ask first and
  say what stops and what stays. Ticking something off the reading list offers Undo.
- **The reading list fits a phone.** A row's length and date sit under its title, kinds and tags
  wait behind one Filter button, and the "…" menu is shorter. Rows can be moved from the keyboard.
- **One word for one thing.** Topics and chats are both "done" (not "finished" or "earlier"),
  chats outside a topic are in "Chats" (not "Recent"), a chat not named yet reads "New chat", and
  messages say "computer" and "chat" throughout. Chat statuses read "Needs your OK", "Waiting for
  your answer", "New reply". Times and dates follow your device's own style.
- **Less developer talk.** Pin and Snooze are gone from chat menus and the Usage page from the
  sidebar and the search. The side panel offers "Notes" and "What changed", and a side chat is a
  "Quick question". A topic's "…" offers the same actions in the sidebar and in its header.

**Fixed**

- **`majord update` can no longer fetch another app.** It looked for new versions in T3 Code's
  releases. It now says how Majordome updates: the app offers each new version itself, and a
  Docker server updates with `docker compose pull && docker compose up -d`.
- **A note that could not be saved keeps your text.** If saving fails, Done keeps the note open,
  and leaving the note no longer drops what you wrote: it is there, with the same message, when
  you open the note again. Done and the save status moved to the top of the note, where the
  Assistant button no longer covers them.
- **A clearer choice when a note changed somewhere else.** When the assistant or another device
  changed a note while you were writing, you choose between "Keep mine (replaces the other
  change)" and "Use the other version".
- **Page names in messages match the app.** Messages that pointed to "Connections", "Providers"
  or "Environments" now name "Computers" and "AI accounts".
- **Clearer buttons on routines and reminders.** Cancelling a reminder asks with "Keep it" and
  "Cancel reminder", and "Run now" shows "Running…" while a routine runs.
- **Links and hints lead to Majordome.** The start-up error screen's download and "report a
  problem" links, and two terminal messages that told you to run T3 Code's installer, now point
  to Majordome's download page and its always-on server guide.
- **No more T3 Code support tool.** The start-up error screen no longer offers a command that
  filed reports with T3 Code, and `majord triage` points to Majordome's own issue page.
- **Adding a computer no longer offers SSH.** That way of connecting needs a download Majordome
  does not publish, so it could never finish.
- **Phone-width fixes.** In Back up my brain, choosing a folder no longer pushes the page off the
  screen, and neither does "Do it by hand" on the always-on server page. The Journal's week fits
  on one line, finished rows in the reading list line up with the others, and the list of
  subjects in focus stays put while you tick.

**Try this**

- In a chat, say: "From now on, when I send you a receipt, rename it with the date and the shop,
  put it in admin/receipts and add a line to admin/receipts/log.md. Remember how to do this."
  The reply should end with a "Wrote a skill" line and a Review button.
- Open Settings, then Skills: the new skill is under "Waiting for your yes". Read it, then Keep
  it. It moves to "In use".
- Choose "Stop using" on it: it goes back to the waiting list, where Keep brings it back and
  Delete removes it.
- Open a note, press Edit, write something and press Done: Done is now at the top.
- On the Chats page, open the "…" beside a chat and rename it.
- Open Routines: each row says On or Off and when it last ran.
- In Settings, open Back up my brain and choose a backup folder with the picker.
- In a topic, press Cmd+T: a new chat about it opens. Send it a message, go to another chat, and
  watch the dot on its row in the sidebar.

## 0.10.18

**New**

- **Each chat shows which machine keeps it.** With an always-on server, the tabs of a topic and
  the chats listed under it in the sidebar carry a small icon: a server for chats kept on the
  server, a laptop for chats kept on this computer. Hover one to read it. Nothing changes when
  your notes are on one machine only.

**Try this**

- Open a topic that has a "Chat on this Mac" tab: the Main tab should carry a server icon and
  that one a laptop. Hover each to read where it is kept.
- Look at the chats listed under a topic in the sidebar for the same icons.

## 0.10.17

**New**

- **The side browser works on an always-on server.** A conversation kept on the server can now
  open pages and render previews there: the server image carries what the built-in browser
  needs, and Chrome keeps its own sandbox. A new server gets this on its own. On a server set up
  by hand before this version, fetch the two files again as the guide's "If something goes
  wrong" section shows.
- **"Go to a topic" in the Cmd+K list.** The topic search no longer needs its shortcut to be
  found: open the list with Cmd+K and pick it, or type "topic".

**Changed**

- **A smaller app.** The download no longer carries a leftover build file or the 3D phone and
  tablet models of a panel Majordome does not show. The installed app is about 28 MB smaller.
- **A new topic's first screen no longer names its folder.** The line "Notes go in …" is gone;
  the folder still shows under the topic's name at the top.
- **A topic's log is called "Log".** The panel beside a topic listed its `log.md` as "Running
  log", a name used nowhere else. It now reads "Log", like the file it opens.

**Fixed**

- **A backup problem shows at the top of "Back up my brain".** With two machines, the page listed
  this computer first, so a problem on the other one sat below a green tick, out of sight. The
  machine that needs you now comes first.
- **A new topic opens as soon as it is made.** With an always-on server, making a topic ran a
  whole backup before its conversation opened, so the window closed and nothing happened for
  several seconds. Now only the notes are exchanged with the server, and the window stays up,
  busy, until the topic is on screen.
- **A ready-made topic's routine joins its conversation.** With an always-on server the routine
  was added before the server had heard of the topic, so it kept a conversation of its own.

**Try this**

- Make a new topic: its conversation should open at once, with the window busy until it does.
- Press Cmd+K and pick "Go to a topic".
- Click "Fix" on the backup warning in the sidebar: the machine with the problem is at the top.
- In a conversation kept on your always-on server, ask the assistant to open a web page in the
  side browser.

## 0.10.16

**New**

- **Keys for topics and their chats.** Ctrl+Tab and Ctrl+Shift+Tab move through the chats of the
  topic you are reading, like tabs in a browser; Cmd+Option+Right and Left do the same.
  Cmd+Option+Down and Up open the next and the previous topic. Cmd+G opens a search over your
  topics: type a few letters and press Enter. All five can be changed in Settings, under
  Keybindings.

**Fixed**

- **Open in Obsidian finds the folder.** Obsidian answered "Vault not found" when it knew the
  notes folder under another path than Majordome does, such as a shortcut to it. The link now
  names the folder instead of its path.

**Try this**

- Open a topic with more than one chat and press Ctrl+Tab, then Ctrl+Shift+Tab.
- Press Cmd+Option+Down a few times to walk through your topics.
- Press Cmd+G, type the start of a topic's name and press Enter.
- Open a note from a topic and choose Open in Obsidian.

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
