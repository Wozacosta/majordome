/**
 * `deploy/install-updates.sh`, word for word, for the server "Set up a server for me" creates: its
 * first boot runs it, and an owner who set a server up by hand runs the same file once. A test keeps
 * the two the same.
 */
export const DEPLOY_UPDATES_SCRIPT = `#!/bin/sh
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
directory=$(cd "\${1:-.}" && pwd -P) || fail "that folder does not exist."
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

# Each step runs only if the one before worked; untagged images are the versions left behind.
cat >/etc/systemd/system/majordome-update.service <<EOF
[Unit]
Description=Update Majordome and clear out old versions
Wants=docker.service network-online.target
After=docker.service network-online.target

[Service]
Type=oneshot
WorkingDirectory=$directory
ExecStart=$docker compose pull --quiet
ExecStart=$docker compose up -d
ExecStart=$docker image prune -f
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
`;
