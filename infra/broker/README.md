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

## Paid servers

The same Worker sells a server to a signed-in account, on the website through Stripe and in the
iPhone app through Apple. Either way of paying fills one row per account in `hosted_accounts`:
where it was bought, the provider's ids, how the subscription stands, and the one server made for
it. A provider's notice is never believed for what it says: it names a subscription, and the
Worker asks the provider how that subscription stands now. Notices can so arrive twice, late or
out of order, and a forged one changes nothing.

Every route takes `{ "accountToken": "..." }`, the signed-in account's token, except the two
notices:

- `POST /v1/billing/status`: how the account stands, its server, and what the website sells it.
- `POST /v1/billing/checkout`: Stripe's payment page for the account. Refused while the account
  has a live subscription from either side, and while no new server can be made.
- `POST /v1/billing/portal`: Stripe's own page for the card, the invoices and cancelling.
- `POST /v1/hosted` with no invite: the account's server, made now if it is paid for. With
  `checkoutSession`, the id Stripe's page hands back, it does not wait for Stripe's notice.
- `POST /v1/billing/apple` with `transactionId`: a purchase made in the iPhone app. Apple is
  asked about it; it must carry the token `status` gave this account. Answers 404 until
  Apple is set up, which is how the app knows not to sell.
- `POST /v1/billing/wake`: switches a stopped server on for a day, three times at most, so its
  owner can get their notes out (**Settings > Back up my brain** on the server).
- `POST /v1/billing/delete-account`: ends a Stripe subscription now and deletes the server.
- `POST /v1/billing/stripe` and `POST /v1/billing/apple/notice`: the providers' notices.

What happens to a server:

| The subscription                                   | The server                                     |
| -------------------------------------------------- | ---------------------------------------------- |
| Trial or paid                                      | Made once, runs                                |
| Payment failed, the provider is still retrying     | Runs                                           |
| Cancelled                                          | Runs to the end of the paid period, then stops |
| The provider gave up on the payment, or it expired | Stopped                                        |
| Disputed or refunded in full (Stripe)              | Subscription ended at once, server stopped     |
| Refunded or revoked (Apple)                        | Stopped when Apple says so                     |
| Paid again before the server is deleted            | The same server is switched back on            |
| Stopped for `RETENTION_DAYS` (30)                  | Fly app, volume and address deleted            |

Places are counted before the sale, not after it: an account that has paid gets its server even
when the last place went while it was on the payment page, so `MAX_HOSTED_SERVERS` can be passed
by the few sales that were open at once.

The hourly pass also finishes a server whose making was cut short. When it cannot bring a paid
server in line, or cannot run at all, it posts one line of text to the address in the `ALERT_URL`
secret (`wrangler secret put ALERT_URL`), if there is one. The line names no account. Any service
that turns a plain `POST` into a notification works, such as a private ntfy topic.

A stopped Machine has no address: Fly starts a stopped Machine when its address is visited, so
stopping takes the Machine's services away and starting puts them back. The row is kept after
the server is deleted. The hourly cron finishes whatever a notice started and could not finish,
and asks the provider again about a subscription whose paid period ran out two days ago with no
notice. How long a failed payment is retried is the provider's setting, not the Worker's.

`purchases` has one row per subscription bought: `source` (`web` or `apple`) and `started_on`
(`phone` or `computer`):

```sh
pnpm dlx wrangler d1 execute majord-broker --remote --config wrangler.deploy.jsonc \
  --command "SELECT source, started_on, COUNT(*) FROM purchases GROUP BY 1, 2"
pnpm dlx wrangler d1 execute majord-broker --remote --config wrangler.deploy.jsonc \
  --command "SELECT account_id, source, state, datetime(period_end / 1000, 'unixepoch') AS until, app_name, stopped_at, delete_at FROM hosted_accounts"
```

### Stripe, once

Paying on the website is offered once `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and the var
`STRIPE_PRICE_ID` are set. Do all of it in a sandbox first, with its own keys.

1. A product with one monthly price, tax behaviour **inclusive**, and a tax code for hosting
   (`txcd_10701100`, or `txcd_10010001` for infrastructure for personal use). Its id is
   `STRIPE_PRICE_ID`.
2. A webhook endpoint at `https://broker.majord.link/v1/billing/stripe` for
   `checkout.session.completed`, `customer.subscription.created`, `.updated`, `.deleted`,
   `.paused`, `.resumed`, `charge.refunded` and `charge.dispute.created`. Its signing secret is
   `STRIPE_WEBHOOK_SECRET`.
3. Billing > Revenue recovery: retry failed payments for the grace period you chose, then
   **cancel the subscription**. Left on "mark as unpaid" or "leave past due", a server runs unpaid.
4. Customer portal: allow updating the payment method, seeing invoices, and cancelling **at the
   end of the period**.
5. `STRIPE_MANAGED_PAYMENTS` is `"1"` only once Stripe has approved the account for Managed
   Payments. Without it the checkout asks the card's owner to confirm with 3-D Secure where the
   card supports it; a Radar rule is what refuses a card that does not. With it, Stripe refuses
   every checkout until the product carries a tax code Managed Payments accepts.

```sh
pnpm dlx wrangler secret put STRIPE_SECRET_KEY --config wrangler.deploy.jsonc
pnpm dlx wrangler secret put STRIPE_WEBHOOK_SECRET --config wrangler.deploy.jsonc
```

To run it all on one machine, `stripe listen --forward-to` sends the sandbox's signed notices to
a local copy of the broker, and a test clock moves a subscription past its trial.

Refunding a charge in full ends the subscription and stops the server. Refund part of it to
give money back and leave the server running. The trial is `TRIAL_DAYS` long, once per account.

### Apple, once

Paying in the iPhone app is offered once the secret `APPLE_IAP_KEY` and the vars beside it are
set. In App Store Connect:

1. One auto-renewing monthly subscription in a group of its own. Its product id is
   `APPLE_PRODUCT_ID` and is the one the app is built with
   (`apps/mobile/src/majordome/serverPurchase.logic.ts`). Give it the same free trial as an
   introductory offer.
2. Billing Grace Period on (16 days). Without it Apple reports a failed renewal as "in retry"
   at once, which stops the server the same day.
3. Users and Access > Integrations > In-App Purchase: a key. The text of its `.p8` file is
   `APPLE_IAP_KEY`, its id `APPLE_IAP_KEY_ID`, and the issuer id above the list
   `APPLE_IAP_ISSUER_ID`.
4. App Information > App Store Server Notifications, version 2, production and sandbox:
   `https://broker.majord.link/v1/billing/apple/notice`.

```sh
pnpm dlx wrangler secret put APPLE_IAP_KEY --config wrangler.deploy.jsonc < AuthKey_XXXXXXXXXX.p8
```

`APPLE_ALLOW_SANDBOX` set to `"1"` makes purchases by test accounts count: TestFlight and App
Review buy that way, for free, and each gets a real server. Leave it at `"0"` otherwise.

Deleting an account cannot end an Apple subscription: only its owner can, on their iPhone. The
server is deleted and later notices about that purchase are ignored.

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
