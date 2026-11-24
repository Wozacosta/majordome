#!/bin/sh
# Majordome: makes this server update itself every night at 05:00 and clear out old versions.
# Run it once as root in the folder that holds docker-compose.yml, or name that folder:
#   sh install-updates.sh [folder]
# Running it again is safe. Guide: docs/user/always-on-server.md
set -eu

fail() {
  echo "install-updates: $1" >&2
  exit 1
}

[ "$(id -u)" = 0 ] || fail "run this as root (put sudo in front of sh)."
command -v systemctl >/dev/null || fail "this server has no systemd."
docker=$(command -v docker) || fail "Docker is not installed."
"$docker" compose version >/dev/null 2>&1 || fail "Docker Compose is not installed."
command -v curl >/dev/null || fail "curl is not installed."
directory=$(cd "${1:-.}" && pwd -P) || fail "that folder does not exist."
[ -f "$directory/docker-compose.yml" ] || fail "there is no docker-compose.yml in $directory."
# The path goes into a systemd unit as is.
case $directory in
  *[!A-Za-z0-9_./-]*) fail "the path $directory has a space or a symbol in it; move the folder." ;;
esac

# 05:00 by the clock routines follow (TZ in .env) when systemd knows that zone, else the server's.
when="*-*-* 05:00:00"
zone=$(sed -n 's/^TZ=//p' "$directory/.env" 2>/dev/null | tail -n 1)
case $zone in
  "" | *[!A-Za-z0-9_+/-]*) ;;
  *) if systemd-analyze calendar "$when $zone" >/dev/null 2>&1; then when="$when $zone"; fi ;;
esac

# The update names the image by the digest the newest release carries, so moving a tag on the
# registry changes nothing here. Compose reads docker-compose.override.yml by itself.
marker="# Written by the nightly Majordome update; changes here are lost."
override=$directory/docker-compose.override.yml
if [ -f "$override" ] && [ "$(head -n 1 "$override")" != "$marker" ]; then
  fail "$override is yours; move what it holds into docker-compose.yml and remove it."
fi

# Each step runs only if the one before worked.
mkdir -p /usr/local/sbin
cat >/usr/local/sbin/majordome-update <<EOF
#!/bin/sh
set -eu
cd $directory
image=ghcr.io/wozacosta/majordome
digest=\$(curl -fsSL --retry 3 https://github.com/Wozacosta/majordome/releases/latest/download/image-digest.txt)
case \$digest in
  sha256:*[!0-9a-f]*) digest= ;;
  sha256:*) [ \${#digest} -eq 71 ] || digest= ;;
  *) digest= ;;
esac
[ -n "\$digest" ] || { echo "majordome-update: the newest release names no image." >&2; exit 1; }
printf '%s\n' "$marker" "services:" "  majordome:" "    image: \$image@\$digest" >$override
$docker compose pull --quiet
$docker compose up -d
# An image pulled by digest keeps that name, so prune alone would leave every old version.
$docker image ls --digests --format '{{.Repository}}@{{.Digest}}' "\$image" |
  grep -vF "@\$digest" | xargs -r $docker image rm >/dev/null 2>&1 || true
$docker image rm "\$image:latest" >/dev/null 2>&1 || true
$docker image prune -f
EOF
chmod 755 /usr/local/sbin/majordome-update

cat >/etc/systemd/system/majordome-update.service <<EOF
[Unit]
Description=Update Majordome and clear out old versions
Wants=docker.service network-online.target
After=docker.service network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/majordome-update
TimeoutStartSec=30min
EOF

cat >/etc/systemd/system/majordome-update.timer <<EOF
[Unit]
Description=Update Majordome every night

[Timer]
OnCalendar=$when
RandomizedDelaySec=10min
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --quiet majordome-update.timer
systemctl restart majordome-update.timer

echo "Majordome in $directory now updates itself every night ($when)."
echo "To update right now: systemctl start majordome-update"
