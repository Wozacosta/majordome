# Always-on server

Majordome runs on your computer by default, so routines like "Start my day" only run while it is
awake. An always-on server is a small computer you rent that never sleeps. Majordome runs there
the same way, and your phone and computer connect to it.

**Settings > Always-on server** sets one up for you. You need a Tailscale account (the one **Phone &
notifications** set up) with HTTPS turned on, and an account at [Hetzner](https://www.hetzner.com/cloud),
the company the server is rented from.

## Set up a server for me

You paste two keys once, press one button, and sign in to Claude on the new server. It takes about
ten minutes.

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

**Check** confirms both keys work and says exactly what is missing if one doesn't. Choose where the
server should be (the nearest place is preselected) and press **Set up a server for me**.

Majordome then creates the server, adds it to your Tailscale network, connects to it and copies
your notes with their whole history. Each step shows as it happens. If one fails, it says why and
offers **Try again**; **Stop** removes what was made so nothing is billed.

Nothing on the server is reachable from the internet, only from your own devices: its firewall
drops every incoming connection, and Majordome answers only on your Tailscale network.

### Finish

- **Sign in to Claude on the server.** Sign-ins are not copied from your computer: each machine has
  its own. The screen links to the server's Providers page ([below](#sign-in-to-claude-and-chatgpt-on-the-server)).
- **Move routines now.** Routines stay on your computer until the server is signed in and can run
  them. Routines you set up by talking to the assistant do not move by themselves: ask the
  assistant on the server to set them up again. The check names them before you start.
- **Add it to your phone** with the code the screen shows.

### Your computer and the server stay in step

Your computer keeps its own copy of the notes. Every few minutes, while it is on, it and the server
exchange what changed, directly over your Tailscale network. Nothing else is needed: no GitHub, no
account. **Back up my brain** shows the server under **Your other machine**, with when the two were
last in step, and **Stop keeping in step** if you want them apart.

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
them; removing the server later asks for them again.

### Remove this server

**Remove this server** copies the notes changed on the server back to your computer, moves routines
back, then deletes the server and its firewall at Hetzner and its entry in Tailscale, and lists what
it did. Hetzner stops billing it. Majordome only ever deletes the server it created.

If the server can't be reached, Majordome asks before removing it: notes changed there since the
move would be lost.

## Do it by hand

For any other provider, or if you prefer a terminal.

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
   - On your computer, open **Settings > Advanced > Environments**, add an environment, and enter
     `majordome.<your-tailnet>.ts.net` and the code. Your Tailscale address is on
     [Tailscale's machines page](https://login.tailscale.com/admin/machines).
   - On your phone, open `https://majordome.<your-tailnet>.ts.net`, enter a new code, and add it to
     your home screen.

7. **Finish on the server's Majordome:**
   - Optional: **Back up my brain > Sign in to GitHub**, so the server sends its notes to the
     GitHub backup too. Without it, your computer sends them whenever it is on.
   - **Settings > Providers > Claude > Sign in to Claude**, or **Codex > Continue with ChatGPT**
     (below).
   - **Feed > Move routines here.** Your computer stops running them once it gets your latest notes.

Your computer keeps its own copy of the notes. Once the Majordome app on your computer is connected
to the server, it links the two by itself, and they [stay in step](#your-computer-and-the-server-stay-in-step)
directly. If **Back up my brain** on your computer shows the server as **Not kept in step**, choose
**Keep in step** there.

## Sign in to Claude and ChatGPT on the server

The server has no browser, so sign-in happens from your phone or computer, in the server's
Majordome:

- **Claude:** in **Settings > Providers > Claude**, choose **Sign in to Claude**. Open the link it
  shows, approve, and paste the code Claude gives you back into Majordome. The code only works for a
  few minutes; if it is refused, choose **Start over** for a new link. This full sign-in brings your
  Claude account's connectors (Gmail, Calendar, Drive), so routines can use them.
- **ChatGPT (Codex):** in **Settings > Providers > Codex**, choose **Continue with ChatGPT**. After
  you sign in, the page fails to load: copy its address and paste it in the field Majordome shows.

Two other ways to sign in to Claude:

- **From a terminal:** on the server, run `docker compose exec -it majordome claude auth login`,
  open the link it prints, approve, and paste the code back. It is the same sign-in as above.
- **With a token, without connectors:** on a computer where you use Claude, run
  `claude setup-token` and paste the token in **Settings > Providers > Claude > Claude sign-in
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
- **See what the server is doing:** `docker compose logs -f majordome`.
- **The address doesn't open:** turn on HTTPS in Tailscale's
  [DNS settings](https://login.tailscale.com/admin/dns), then `docker compose restart tailscale`.
