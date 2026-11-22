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
out twice. The table stores the client IP of each claim for the per-IP limit.

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

| Var                      | Default | Meaning                                         |
| ------------------------ | ------- | ----------------------------------------------- |
| `MAX_NEW_PER_IP_PER_DAY` | 3       | New addresses per client IP in 24 hours         |
| `MAX_NEW_PER_DAY`        | 40      | New addresses in 24 hours, all clients          |
| `MAX_LIVE_ADDRESSES`     | 180     | Live addresses; a free zone has 200 DNS records |

Claims by a computer that already has an address never count. Over the first two the caller
gets `rate_limited`; at the ceiling it gets `full`.

## Block an address

```sh
pnpm dlx wrangler d1 execute majord-broker --remote \
  --command "UPDATE addresses SET blocked = 1 WHERE label = 'k7m2xq9d'"
```

Claims from that computer fail with `blocked` at once, and the next cron run deletes its tunnel
and DNS record even if it is connected. The block stays with the key, so set `blocked = 0` on
the row to lift it.
