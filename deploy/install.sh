#!/bin/sh
# Majordome: turns a Linux server you already have into a Majordome server that only your own
# devices can reach, through your Tailscale network. Run it on the server, as root:
#   curl -fsSL https://raw.githubusercontent.com/Wozacosta/majordome/main/deploy/install.sh | sh
# It asks for a Tailscale key (https://login.tailscale.com/admin/settings/keys); or pass the key
# as the first argument, after `sh -s --`. Set TZ=Europe/Paris in front of sh for routines to
# follow your clock. Running it again is safe. Guide: docs/user/always-on-server.md
set -eu

source=https://raw.githubusercontent.com/Wozacosta/majordome/main/deploy
directory=${MAJORDOME_DIR:-/opt/majordome}

say() {
  echo "majordome: $1"
}

fail() {
  echo "majordome: $1" >&2
  exit 1
}

# Sets one line of .env, leaving the others as they are.
keep() {
  touch .env
  chmod 600 .env
  grep -v "^$1=" .env >.env.next || true
  echo "$1=$2" >>.env.next
  mv .env.next .env
  chmod 600 .env
}

[ "$(id -u)" = 0 ] || fail "run this as root: put sudo in front of sh."
[ "$(uname -s)" = Linux ] || fail "this is for a Linux server."
command -v curl >/dev/null || fail "curl is not installed."
# The path goes into a systemd unit as is.
case $directory in
  /*) ;;
  *) fail "MAJORDOME_DIR must start with /." ;;
esac
case $directory in
  *[!A-Za-z0-9_./-]*) fail "the path $directory has a space or a symbol in it." ;;
esac

mkdir -p "$directory"
cd "$directory"

key=${1:-${TS_AUTHKEY:-}}
joined=$(sed -n 's/^TS_AUTHKEY=//p' .env 2>/dev/null | tail -n 1)
if [ -z "$key" ] && [ -z "$joined" ]; then
  # The script itself arrives on standard input, so the question goes to the terminal.
  (: </dev/tty) 2>/dev/null || fail "give your Tailscale key: add  -s -- tskey-auth-...  after sh."
  printf 'Paste your Tailscale key (it starts with tskey-auth-), then press Enter: ' >/dev/tty
  read -r key </dev/tty
fi
case $key in
  "") ;;
  tskey-client-*) fail "that is a Tailscale secret, not a key. Make an auth key on Tailscale's Keys page." ;;
  *[!A-Za-z0-9_-]*) fail "that does not look like a Tailscale key. It starts with tskey-auth-." ;;
  tskey-*) keep TS_AUTHKEY "$key" ;;
  *) fail "that does not look like a Tailscale key. It starts with tskey-auth-." ;;
esac

case ${TZ:-} in
  "" | *[!A-Za-z0-9_+/-]*) ;;
  *) keep TZ "$TZ" ;;
esac

if ! command -v docker >/dev/null; then
  say "installing Docker..."
  curl -fsSL https://get.docker.com | sh
fi
docker compose version >/dev/null 2>&1 || fail "Docker Compose is not installed."

curl -fsSLO "$source/docker-compose.yml"
curl -fsSLO "$source/browser-seccomp.json"

say "starting Majordome..."
docker compose up -d --quiet-pull

# The network may add a number to the name, so the real one is read, never assumed.
address=
attempt=0
while [ -z "$address" ] && [ $attempt -lt 60 ]; do
  attempt=$((attempt + 1))
  address=$(docker compose exec -T tailscale tailscale status --self --peers=false --json 2>/dev/null |
    sed -n 's/.*"DNSName": *"\([A-Za-z0-9.-]*[A-Za-z0-9]\)\.\{0,1\}".*/\1/p' | head -n 1) || address=
  [ -n "$address" ] || sleep 2
done
[ -n "$address" ] ||
  fail "the server did not join your Tailscale network. A key works once: make a new one and run this again. Details: cd $directory && docker compose logs tailscale"

# With its own address, the server hands out links that open from your other devices.
if [ "$(sed -n 's/^MAJORDOME_PUBLIC_URL=//p' .env | tail -n 1)" != "https://$address" ]; then
  keep MAJORDOME_PUBLIC_URL "https://$address"
  docker compose up -d --quiet-pull
fi

if command -v systemctl >/dev/null; then
  curl -fsSL "$source/install-updates.sh" | sh -s -- "$directory"
else
  say "this server has no systemd, so it will not update itself."
fi

pairing=
attempt=0
while [ $attempt -lt 60 ]; do
  attempt=$((attempt + 1))
  if pairing=$(docker compose exec -T majordome majord pair 2>/dev/null); then break; fi
  pairing=
  sleep 2
done

echo
say "ready at https://$address"
say "it answers only your devices on Tailscale, and needs HTTPS Certificates on at https://login.tailscale.com/admin/dns"
if [ -n "$pairing" ]; then
  echo
  echo "$pairing"
  echo
  say "in Majordome on your computer, open Settings > Your servers > Add a computer, and paste the link above."
else
  say "it is still starting. In a minute, get a one-time link with: cd $directory && docker compose exec majordome majord pair"
fi
