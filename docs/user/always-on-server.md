# Always-on server

Majordome runs on your computer by default, so routines like "Start my day" only run while it is
awake. An always-on server is a small computer you rent that never sleeps. Majordome runs there
the same way, and your phone and computer connect to it. The same guide, with copy buttons, is in
**Settings > Always-on server**.

You need a GitHub backup of your notes (**Settings > Back up my brain > Connect GitHub**) and a
Tailscale account (the one **Your phone** set up).

## Move to a server

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

5. **Bring your notes** from your GitHub backup:

   ```bash
   docker compose exec -it majordome git clone https://github.com/<you>/majordome-brain.git /data/brain
   docker compose exec majordome majord project add /data/brain
   ```

   GitHub asks for your username and a password. Your usual password does not work there: make a
   key on [GitHub's token page](https://github.com/settings/tokens/new?scopes=repo&description=Majordome%20server)
   that expires in a day, and paste it.

6. **Connect.** Get a one-time code with `docker compose exec majordome majord pair`.
   - On your computer, open **Settings > Advanced > Environments**, add an environment, and enter
     `majordome.<your-tailnet>.ts.net` and the code. Your Tailscale address is on
     [Tailscale's machines page](https://login.tailscale.com/admin/machines).
   - On your phone, open `https://majordome.<your-tailnet>.ts.net`, enter a new code, and add it to
     your home screen.

7. **Finish on the server's Majordome:**
   - **Back up my brain > Sign in to GitHub**, so the server saves your notes back to GitHub.
   - **Settings > Providers**: sign in to Claude or ChatGPT (below).
   - **Feed > Move routines here.** Your computer stops running them once it gets your latest notes.

Your computer keeps its own copy of the notes and stays in step through GitHub.

## Sign in to Claude and ChatGPT on the server

The server has no browser, so sign-in happens from your phone or computer:

- **Claude:** on the server, run `docker compose exec -it majordome claude auth login`, open the
  link it prints, approve, and paste the code back. This full sign-in brings your Claude account's
  connectors (Gmail, Calendar, Drive), so routines can use them.
- **Claude, without connectors:** on a computer where you use Claude, run `claude setup-token` and
  paste the token in **Settings > Providers > Claude > Claude sign-in token** on the server's
  Majordome. Conversations work, but the server can't reach your email, calendar or files.
- **ChatGPT (Codex):** in **Settings > Providers > Codex**, choose **Continue with ChatGPT**. After
  you sign in, the page fails to load: copy its address and paste it in the field Majordome shows.

## What the server can reach

Each machine has its own sign-ins. **Settings > Connections** lists, for your computer and for the
server, which AI providers are signed in, which connectors (such as Gmail, Google Calendar and
Google Drive) your assistant can use there, and where your notes are backed up.

Routines run on the server, so they can only use what is connected there. A connector that works on
your computer can be missing on the server, and the page says so. Majordome lists Claude's
connectors; it can't see those of other providers. **Check again** asks each machine afresh.

## Update

```bash
cd majordome
docker compose pull && docker compose up -d
```

Your notes, sign-ins and settings live in Docker volumes and survive updates. `docker compose down`
stops Majordome and keeps them; `docker compose down -v` deletes them.

## If something goes wrong

- **No code, or it expired:** run `docker compose exec majordome majord pair` again.
- **See what the server is doing:** `docker compose logs -f majordome`.
- **The address doesn't open:** turn on HTTPS in Tailscale's
  [DNS settings](https://login.tailscale.com/admin/dns), then `docker compose restart tailscale`.
