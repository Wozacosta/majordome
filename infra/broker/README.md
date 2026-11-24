# Majordome address broker

A Cloudflare Worker at `broker.majord.link`. A Majordome computer asks it for a public address
such as `k7m2xq9d.majord.link`; the broker creates a Cloudflare Tunnel and a DNS record and
returns the tunnel's connector token. There are no accounts: the computer signs each request
with its Ed25519 key, and the SHA-256 of that public key is its identity. One address per
identity.

- `POST /v1/address` claims the address, or returns the existing one with a fresh token.
- `DELETE /v1/address` gives it up.
- An hourly cron removes addresses idle for 14 days, addresses older than 24 hours that never
  connected, and blocked ones, at most 8 per run.

State is one D1 table, `addresses`. Removed rows stay as tombstones so a label is never handed
out twice. The table stores the client of each claim for the per-IP limit: an IPv4 address, or
the /64 an IPv6 address is in, since one connection can use every address of its /64.

## Deploy

Run these from `infra/broker`. Copy `wrangler.jsonc` to `wrangler.deploy.jsonc` (gitignored) and
fill every `REPLACE_WITH_...` placeholder there: the account id (twice), the zone id of
`majord.link`, the abuse contact, and the D1 database id printed by the first command.

```sh
pnpm dlx wrangler d1 create majord-broker --config wrangler.deploy.jsonc
pnpm dlx wrangler d1 migrations apply majord-broker --remote --config wrangler.deploy.jsonc
pnpm dlx wrangler deploy --config wrangler.deploy.jsonc
pnpm dlx wrangler secret put CLOUDFLARE_API_TOKEN --config wrangler.deploy.jsonc
```

`CLOUDFLARE_API_TOKEN` is a token the Worker uses at run time, separate from the login you
deploy with. It needs exactly:

- Account: **Cloudflare Tunnel: Edit**
- Zone: **DNS: Edit**, on the `majord.link` zone only

## Limits

Set as vars in `wrangler.jsonc`:

| Var                      | Default | Meaning                                                |
| ------------------------ | ------- | ------------------------------------------------------ |
| `MAX_NEW_PER_IP_PER_DAY` | 3       | New addresses per IPv4 address or IPv6 /64 in 24 hours |
| `MAX_NEW_PER_DAY`        | 40      | New addresses in 24 hours, all clients                 |
| `MAX_LIVE_ADDRESSES`     | 180     | Live addresses; a free zone has 200 DNS records        |

Claims by a computer that already has an address never count. Over the first two the caller
gets `rate_limited`; at the ceiling it gets `full`.

## Linux and Windows list

`POST /v1/waitlist` with `{ "email": "...", "platforms": ["linux", "windows"] }` keeps an email
for the day Majordome runs on those systems. The form is on majord.me, the one site allowed to
call it from a browser. One visitor can add six rows a day. Read the list, or take someone off
it, from this folder:

```sh
vp dlx wrangler d1 execute majord-broker --remote --config wrangler.deploy.jsonc \
  --command "SELECT email, platform, datetime(created_at / 1000, 'unixepoch') AS asked FROM platform_waitlist ORDER BY created_at"
vp dlx wrangler d1 execute majord-broker --remote --config wrangler.deploy.jsonc \
  --command "DELETE FROM platform_waitlist WHERE email = 'someone@example.com'"
```

## Hosted servers

The same Worker makes a server for someone who has an invite code. It is switched on by the
`FLY_API_TOKEN` secret; without it, the routes below answer 404.

- `GET /start`: the page a person opens. It takes the code, makes the server, waits until it
  answers, and sends them to it already paired as its owner.
- `POST /v1/hosted` with `{ "invite": "..." }`: spends the invite and returns the server's
  `name`, `url` and a `pairingUrl` that works once, for a day. After ten wrong codes in 24 hours
  a client (counted as above) gets `rate_limited`, whatever it sends next.
- `GET /v1/hosted/ready?name=...`: how far that server has come, as `switchedOn` and `ready`.
  The page shows its steps from these, so each one is something that really happened. Only a
  server in `hosted_invites` is looked at; any other name gets `false` twice and Fly is not asked.

A server is one Fly.io app named `majordome-<10 characters>`, holding a 3 GB volume and one
Machine (2 shared CPUs, 2 GB) that runs the released image with `MAJORDOME_HOSTED=1`. Its
address is the app's `fly.dev` address, over HTTPS only. An invite makes one server; if Fly
refuses, what was made is removed and the invite is given back.

Each app is made with a private network of its own (named after the app), so one customer's
server cannot reach another's over Fly's private networking. An app's network is set when it
is made and cannot be changed: a server made before this still sits on the organization's
default network until it is made again. Keep hosted servers in a Fly organization that holds
nothing else, and name it in `FLY_ORG_SLUG`: the broker's token can then make and destroy only
those apps, and nothing of yours shares an organization with customers' machines.

The image is named by its digest, never by a tag, so moving `latest` on the registry changes
nothing a server runs. The digest comes from `image-digest.txt`, which the image's build
(`.github/workflows/container-image.yml`) attaches to the release it was built for.
`HOSTED_IMAGE` is the repository alone. While the latest release has no `image-digest.txt` (its
image is still building), no server can be made and none is updated.

Every night (the second cron, 03:43 UTC) the Worker reads the latest release from GitHub and
restarts each hosted server that reports another version, on that release's image. A server on
the latest version, or one that does not answer, is left alone. Its volume, and so its notes
and sign-ins, is kept across the restart.

Set it up once:

```sh
fly orgs create majordome-hosted
fly tokens create org -o majordome-hosted --name majordome-broker --expiry 8760h \
  | pnpm dlx wrangler secret put FLY_API_TOKEN --config wrangler.deploy.jsonc
```

Make an invite, list them, and remove a server. The code is the only thing between a stranger
and a server on your bill, so it is 128 random bits, not a word you choose:

```sh
pnpm dlx wrangler d1 execute majord-broker --remote --config wrangler.deploy.jsonc \
  --command "INSERT INTO hosted_invites (code, note, created_at) VALUES ('$(openssl rand -hex 16)', 'for whom', unixepoch() * 1000)"
pnpm dlx wrangler d1 execute majord-broker --remote --config wrangler.deploy.jsonc \
  --command "SELECT code, note, app_name, claimed_at, removed_at FROM hosted_invites"
fly apps destroy majordome-xxxxxxxxxx
pnpm dlx wrangler d1 execute majord-broker --remote --config wrangler.deploy.jsonc \
  --command "UPDATE hosted_invites SET removed_at = unixepoch() * 1000 WHERE app_name = 'majordome-xxxxxxxxxx'"
```

Each server's volume is copied by Fly every day and the copies are kept 30 days
(`snapshot_retention`). To bring one back (tried on 2026-11-23: the files, the server's
identity and its sign-ins all came back):

```sh
fly volumes snapshots list <volume id> --app <app>
fly volumes create data --snapshot-id <snapshot id> --app <app> --region cdg --size 3 --yes
fly volumes update <new volume id> --app <app> --snapshot-retention 30   # a restored volume starts at 5
fly machine stop <machine id> --app <app>
fly machine clone <machine id> --app <app> --region cdg --attach-volume <new volume id>:/data
fly machine destroy <machine id> --app <app> --force   # the old one, or a request can wake it
```

The address stays the same. The old volume is left behind; remove it once the restored server
is checked (`fly volumes destroy`).

Removing the Fly app deletes the customer's notes with it, so it is done by hand. `removed_at`
frees the server's place under `MAX_HOSTED_SERVERS`.

## Phone app links

The Worker also answers on the zone's root, `majord.link`, with one file:
`/.well-known/apple-app-site-association`. It names Majordome's iPhone app as the one that opens
`https://<anything>.majord.link/pair`, so scanning a server's ordinary phone code opens the app
when it is installed and the browser when it is not. The app is built to trust `*.majord.link`
(`apps/mobile/majordome/identity.ts`); an iPhone reads the file once per app install, from the
root only, so a new address needs nothing. Addresses under another domain (Tailscale, Wi-Fi,
`fly.dev`) cannot work this way and use the "In the Majordome app" code instead.

## Block an address

```sh
pnpm dlx wrangler d1 execute majord-broker --remote \
  --command "UPDATE addresses SET blocked = 1 WHERE label = 'k7m2xq9d'"
```

Claims from that computer fail with `blocked` at once, and the next cron run deletes its tunnel
and DNS record even if it is connected. The block stays with the key, so set `blocked = 0` on
the row to lift it.
