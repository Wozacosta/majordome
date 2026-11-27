# Your servers

Majordome runs on your computer by default, so routines like "Start my day" only run while it is
awake. A server of your own is a small computer you rent that never sleeps. Majordome runs there
the same way, and your phone and computer connect to it.

Once the server is set up and signed in to your AI, your conversations are kept there, so your
phone and your computer show the same ones. Each topic's conversation on your computer moves to
the server by itself the next time you open the app there, with everything said so far; pictures
and files in it are not moved. The copy left on the computer goes to Settings > Archived chats.
While the server can't be reached, new conversations wait until it is back.

**Settings > Your servers** starts with a drawing: this computer and your phone on the left, your
servers on the right, a line for what opens what, and **Main** on the computer where the assistant
answers and your chats are kept. Under it, the page lists every server the app is connected to: whether the app can
reach it, whether it has a copy of your notes and runs your routines, and whether it is signed in
to your AI. Click your phone on the drawing to open Phone & notifications.
**Make main** on a server moves your routines, the assistant and your chats to it; the server
that had them stops, and every computer keeps its copy of your notes. It is offered on a server
that has your notes and a signed-in AI. **Add a computer** adds a server you already have, with
its address and a one-time code. **Remove from this app** makes the app forget a server; the server keeps running. A server
the page set up for you, or moved your notes to, is removed further down the page instead, so
your notes come back first.

If two of your computers both run the routines of the same notes, the page says so at the top
and asks which one should. This happens when routines were moved and one server never received
the news, for example because it could not reach your backup. The one you do not choose stops.

Under the list, **Add a server** has three lines, and each opens its own page:

- **Let Majordome host it**: with an invite code, [Majordome hosts the server](#let-majordome-host-it),
  with nothing to rent or install.
- **Rent one for me**: Majordome [rents a server in your name](#set-up-a-server-for-me) at Hetzner
  and sets it up.
- **Use a server I already have**: [one command](#use-a-server-you-already-have) on any Linux
  server.

Your notes go to one server at a time. Once they are on one, the page keeps only the last line,
to add a server you already have.

To have one rented for you, you need:

- an account at [Hetzner](https://www.hetzner.com/cloud), the company the server is rented from,
  with a payment card. The account is free; the server is not ([below](#what-it-costs)).
- a free [Tailscale](https://tailscale.com) account, with HTTPS turned on. Tailscale keeps the
  server private to your own devices.

## Set up a server for me

Open **Rent one for me**. You copy one key from each account and paste it in Majordome, press one
button, and sign in to Claude on the new server. It takes about ten minutes.

The screen shows one key at a time: the steps for the Hetzner key first, then, once it is saved,
the steps for the Tailscale one. **Change** beside a saved key lets you paste another.

### What it costs

Hetzner bills you directly, each month, for the server and its address: about €5 for the smallest
one that fits. The exact price for the place you choose is read from Hetzner and shown before you
start. Majordome charges nothing. The server is billed for as long as it exists, running or not,
until you remove it.

### The Hetzner key

1. Open the [Hetzner Console](https://console.hetzner.com/) and sign in, or create an account.
2. Create a project, with any name, and open it.
3. In the left menu choose **Security**, then **API tokens**, then **Generate API token**.
4. Name it Majordome, choose **Read & Write**, and generate it.
5. Copy the token and paste it in Majordome. Hetzner shows it only once.

The key can do anything inside that one Hetzner project and nothing outside it, which is why it
gets a project of its own. Majordome uses it to create and remove this server and its firewall. To
take it back, delete the token on the same Hetzner page.

### The Tailscale secret

1. In Tailscale's [Access controls](https://login.tailscale.com/admin/acls), choose **Tags**, then
   **Create tag**. Name it `majordome` and save.
2. Open [Trust credentials](https://login.tailscale.com/admin/settings/trust-credentials), choose
   **Credential**, then **OAuth**.
3. Set **Auth Keys** to **Write** and **Devices > Core** to **Write**, and for each choose the tag
   `tag:majordome`. Leave everything else off.
4. Generate the credential, copy its secret (it starts with `tskey-client-`) and paste it in
   Majordome. Tailscale shows it only once.

The secret lets Majordome add a server tagged `majordome` to your Tailscale network and remove it.
It cannot read your traffic or change your settings. To take it back, revoke the credential on the
Trust credentials page.

If you changed Tailscale's access rules from the default, add a rule that lets your devices reach
`tag:majordome`; with the default rules there is nothing to do.

### Start

Once both keys are saved, **Check my keys** confirms they work, reads the price from Hetzner, and
says exactly what is missing if one doesn't. Nothing is rented yet. When the check passes, the same
button becomes **Set up a server for me**: choose where the server should be (the nearest place is
preselected) and press it.

Majordome then creates the server, adds it to your Tailscale network, connects to it and copies
your notes with their whole history. Each step shows as it happens. If one fails, it says why and
offers **Try again**; **Stop** removes what was made so nothing is billed.

Nothing on the server is reachable from the internet, only from your own devices: its firewall
drops every incoming connection, and Majordome answers only on your Tailscale network.

### Finish

- **Sign in to Claude on the server.** Sign-ins are not copied from your computer: each machine has
  its own. The screen links to the server's AI accounts page ([below](#sign-in-to-claude-and-chatgpt-on-the-server)).
- **Move routines now.** Routines stay on your computer until the server is signed in and can run
  them. Routines you set up by talking to the assistant do not move by themselves: ask the
  assistant on the server to set them up again. The check names them before you start.
- **Set up your phone.** Once routines run on the server, the screen links to **Phone &
  notifications**, which sets your phone up on the server with nothing to install on it.

### Your computer and the server stay in step

Your computer keeps its own copy of the notes. Every few minutes, while it is on, it and the server
exchange what changed, directly over your Tailscale network. Nothing else is needed: no GitHub, no
account. The first time, Majordome asks before it starts: in **Back up my brain**, choose **Keep in
step** for the server, or **Not now**. It asks because the server then receives all of your notes,
so say yes only to a server that is yours. After that the page shows when the two were last in step,
and **Stop keeping in step** if you want them apart.

While your computer is asleep or off, the server carries on by itself, and your computer catches up
when it wakes. If the server stops accepting your computer (after a month or more apart, for
example), opening Majordome on your computer links them again.

Two machines are not a backup: a note deleted by mistake is deleted on both. GitHub, a folder or
Google Drive in **Back up my brain** still protect you from that, and from losing both machines.
If your notes are backed up to GitHub, the server signs in to the same backup.

### When a note changes in two places

If the same note is changed on your computer and on the server before they catch up, Majordome keeps
both: the note holds one version, and a file beside it named like `memory (version from Samys
MacBook Pro, 2026-11-17).md` holds the other. Nothing is lost and the two keep exchanging changes. The sidebar
says "Two versions of a note" until you delete or rename the other version; **Back up my brain**
lists them. You can also ask the assistant to combine the two.

Majordome keeps the two keys on your computer, never in your notes. **Forget these keys** deletes
them, after asking you to confirm; removing the server later asks for them again.

### Remove this server

**Remove this server** copies the notes changed on the server back to your computer, moves routines
back, then deletes the server and its firewall at Hetzner and its entry in Tailscale, and lists what
it did. Hetzner stops billing it. Majordome only ever deletes the server it created.

If the server can't be reached, Majordome asks before removing it: notes changed there since the
move would be lost.

## Use a server you already have

For a Linux server you rent anywhere, with at least 2 GB of memory. In the app, these steps are
under **Use a server I already have**.

1. **Make a Tailscale key** on [Tailscale's keys page](https://login.tailscale.com/admin/settings/keys),
   with the account your computer is on, and turn on HTTPS Certificates on its
   [DNS page](https://login.tailscale.com/admin/dns). Tailscale keeps the server private: nothing
   on it is reachable from the internet, only from your own devices.
2. **Run one command on the server**, as root. The app shows it with your time zone in it, so
   routines follow your clock:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/Wozacosta/majordome/main/deploy/install.sh | TZ=Europe/Paris sh
   ```

   It asks for the key, installs Docker if the server has none, starts Majordome in
   `/opt/majordome`, makes it [update itself](#update) every night, and ends with a link. Running
   it again is safe, and gives a new link.

3. **Add it to the app.** Press **Add a computer** and paste the link.
4. **Move your notes to it.** Press **Move my notes to your server**. Majordome copies them with
   their history, then keeps the two copies [in step](#your-computer-and-the-server-stay-in-step).
   Nothing on your computer is removed. The page then lists what is left: sign in to Claude on the
   server, and move your routines to it.

**Bring my notes back** undoes the last step: the notes changed on the server come back to your
computer, routines run here again, and the server is left as it is.

## Do it by hand

The same, one command at a time. In the app, these steps are under **Use a server I already
have**, in **Do each step by hand instead**.

1. **Rent a server.** Any provider works. Choose Ubuntu with at least 2 GB of memory. Open its
   console, or connect from a terminal with `ssh root@<server address>`.
2. **Install Docker:**

   ```bash
   curl -fsSL https://get.docker.com | sh
   ```

3. **Make a Tailscale key** on [Tailscale's keys page](https://login.tailscale.com/admin/settings/keys).
   Tailscale keeps the server private: nothing on it is reachable from the internet, only from your
   own devices.
4. **Start Majordome**, with your key in place of `tskey-auth-…`:

   ```bash
   mkdir majordome && cd majordome
   curl -fsSLO https://raw.githubusercontent.com/Wozacosta/majordome/main/deploy/docker-compose.yml
   curl -fsSLO https://raw.githubusercontent.com/Wozacosta/majordome/main/deploy/browser-seccomp.json
   echo "TS_AUTHKEY=tskey-auth-…" > .env
   docker compose up -d
   ```

   To have routines follow your clock, add your time zone to `.env`, such as
   `TZ=Europe/Paris`. To get pairing links that open from your other devices, add the server's
   address, `MAJORDOME_PUBLIC_URL=https://majordome.<your-tailnet>.ts.net` (shown in Tailscale's
   admin page). Then run `docker compose up -d` again.

   Then have the server [update itself](#update) every night:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/Wozacosta/majordome/main/deploy/install-updates.sh | sh
   ```

5. **Bring your notes.** On your computer, in a terminal, pack your notes folder (here `~/brain`)
   into one file and send it to the server:

   ```bash
   git -C ~/brain bundle create ~/brain.bundle --all
   scp ~/brain.bundle root@<server address>:majordome/
   ```

   Then on the server, in the `majordome` folder:

   ```bash
   docker compose cp brain.bundle majordome:/tmp/brain.bundle
   docker compose exec majordome git clone /tmp/brain.bundle /data/brain
   docker compose exec majordome git -C /data/brain remote remove origin
   docker compose exec majordome majord project add /data/brain
   rm brain.bundle
   ```

   Delete `~/brain.bundle` on your computer too. The file holds your notes as Majordome last saved
   them, with their history; private documents stay on your computer.

   If your notes are backed up to GitHub, you can copy them from there instead of the first three
   server commands: `docker compose exec -it majordome git clone https://github.com/<you>/majordome-brain.git /data/brain`.
   GitHub asks for a username and a key from
   [its token page](https://github.com/settings/tokens/new?scopes=repo&description=Majordome%20server),
   not your password.

6. **Connect.** Get a one-time code with `docker compose exec majordome majord pair`.
   - On your computer, open **Settings > Your servers**, press **Add a computer**, and enter
     `majordome.<your-tailnet>.ts.net` and the code. Your Tailscale address is on
     [Tailscale's machines page](https://login.tailscale.com/admin/machines).
   - On your phone, open `https://majordome.<your-tailnet>.ts.net`, enter a new code, and add it to
     your home screen.

7. **Finish on the server's Majordome:**
   - Optional: **Back up my brain > Sign in to GitHub**, so the server sends its notes to the
     GitHub backup too. Without it, your computer sends them whenever it is on.
   - **Settings > AI accounts > Claude > Sign in to Claude**, or **Codex > Continue with ChatGPT**
     (below).
   - **What it did > Move routines here.** Your computer stops running them once it gets your latest notes.

Your computer keeps its own copy of the notes. Once the Majordome app on your computer is connected
to the server, **Back up my brain** on your computer shows the server as **Not kept in step**.
Choose **Keep in step** there, and they [stay in step](#your-computer-and-the-server-stay-in-step)
directly.

## Let Majordome host it

By invitation for now. With an invite code you need no server of your own, no terminal and no
Tailscale:

1. Open <https://majord.me/start>, sign in, and enter your code. The server belongs to the
   account you sign in with ([Your account](./account.md)).
2. Wait about half a minute. The page then opens your server, already yours.
3. Press **Sign in** on Claude, open the link, and paste the code Claude gives you. Your own
   Claude plan is used; Anthropic has not confirmed that it allows this on a server someone
   else runs, and a plan's limits are meant for ordinary individual use.
4. Press **Start new notes**.

The app calls it your **Majordome server**. To use it from your phone, open
<https://majord.me/open> on the phone, sign in with the same account, and press **Open**. No code
is needed ([Phone and notifications](./phone-and-notifications.md)).

### Bring the notes on your computer to it

If your notes are already on your computer, skip step 4 and move them instead:

1. In the Mac app, open **Settings > Your account**, sign in with the same account, and press
   **Connect** next to the server.
2. Open **Settings > Your servers** and, under **Let Majordome host it**, press **Move my notes
   to your Majordome server**.

Your notes are copied with their whole history, and from then on the two copies follow each
other every few minutes. Nothing on your computer is removed. The page then lists what is
left: signing in to Claude on the server, and moving your routines there so they run while
your computer sleeps. **Bring my notes back** undoes it: notes changed on the server come back,
routines run on your computer again, and the server is left as it is.

Majordome keeps a copy of the server's disk every day, for a month. That protects against a
lost disk; a backup you own (**Settings > Back up my brain**) is still the one to rely on.

The address is the one the page sent you to, so keep it. A code makes one server.

## Sign in to Claude and ChatGPT on the server

The server has no browser, so sign-in happens from your phone or computer, in the server's
Majordome:

- **Claude:** in **Settings > AI accounts > Claude**, choose **Sign in to Claude**. Open the link it
  shows, approve, and paste the code Claude gives you back into Majordome. The code only works for a
  few minutes; if it is refused, choose **Start over** for a new link. This full sign-in brings your
  Claude account's connectors (Gmail, Calendar, Drive), so routines can use them.
- **ChatGPT (Codex):** in **Settings > AI accounts > Codex**, choose **Continue with ChatGPT**. After
  you sign in, the page fails to load: copy its address and paste it in the field Majordome shows.

Two other ways to sign in to Claude:

- **From a terminal:** on the server, run `docker compose exec -it majordome claude auth login`,
  open the link it prints, approve, and paste the code back. It is the same sign-in as above.
- **With a token, without connectors:** on a computer where you use Claude, run
  `claude setup-token` and paste the token in **Settings > AI accounts > Claude > Claude sign-in
  token**. Conversations work, but the server can't reach your email, calendar or files.

A token wins over a full sign-in for as long as Claude sees it. **Sign in to Claude** removes a
token saved in Settings, and Majordome leaves out one set as `CLAUDE_CODE_OAUTH_TOKEN` in the
server's `.env` file once the full sign-in is stored. If it tells you the token still wins, delete
that line from `.env` and run `docker compose up -d`.

## What the server can reach

Each machine has its own sign-ins. **Settings > Connections** lists, for your computer and for the
server, which AI providers are signed in, which connectors (such as Gmail, Google Calendar and
Google Drive) your assistant can use there, and where your notes are backed up.

Routines run on the server, so they can only use what is connected there. A connector that works on
your computer can be missing on the server, and the page says so. Majordome lists Claude's
connectors; it can't see those of other providers. **Check again** asks each machine afresh.

Connectors are added in your Claude account on the web, under **Customize > Connectors**
(<https://claude.ai/customize/connectors>), not in Majordome. A machine signed in to that account
gets them; when one has none, the page shows these steps and a button to that page. A connector
marked **Needs sign-in** has a link to the same place. Choose **Check again** afterwards.

## Update

The server updates itself every night at 05:00, by the clock your routines follow, and clears out
the versions it no longer uses. There is nothing to do. The update restarts Majordome, so a routine
or conversation running at that moment is cut short; the nightly memory routine runs at 03:30, well
before it.

A server set up by hand does this once you run, one time, in its `majordome` folder:

```bash
curl -fsSL https://raw.githubusercontent.com/Wozacosta/majordome/main/deploy/install-updates.sh | sh
```

To update right now instead of waiting for the night, run `systemctl start majordome-update` on the
server. `journalctl -u majordome-update` shows what past updates did.

A server Majordome set up before nightly updates existed stays on the version your computer had that
day, and has no terminal to log in to. Remove it and set it up again: your notes come back to your
computer first.

Your notes, sign-ins and settings live in Docker volumes and survive updates. `docker compose down`
stops Majordome and keeps them; `docker compose down -v` deletes them.

## If something goes wrong

These are for a server set up by hand; one Majordome set up says what went wrong on its screen.

- **No code, or it expired:** run `docker compose exec majordome majord pair` again.
- **The assistant says the browser's sandbox is blocked:** the server was set up before the built-in
  browser worked there. In its `majordome` folder, fetch the two files again and restart:

  ```bash
  curl -fsSLO https://raw.githubusercontent.com/Wozacosta/majordome/main/deploy/docker-compose.yml
  curl -fsSLO https://raw.githubusercontent.com/Wozacosta/majordome/main/deploy/browser-seccomp.json
  docker compose pull && docker compose up -d
  ```

- **See what the server is doing:** `docker compose logs -f majordome`.
- **The address doesn't open:** turn on HTTPS in Tailscale's
  [DNS settings](https://login.tailscale.com/admin/dns), then `docker compose restart tailscale`.
