# Running Majordome in the background

On a Mac, Majordome keeps running after you close its window, so routines such as
"Start my day" and the inbox watcher still run. It also starts when you log in. This
part of Majordome is called `majord`.

It is on from the first time you open the app. macOS shows a "Background Items Added"
notification the first time.

## Turn it on or off

In **Settings → Overview**, under **Where it runs**, use **Keep Majordome running when the
window is closed**.
Majordome restarts to switch. When it is off, routines run only while the window is
open.

The Overview shows "Running in the background since …" while it runs.

## Quit completely

Quitting the window (**Quit Majordome**, ⌘Q) leaves Majordome running in the
background. To stop it too, choose **Majordome → Quit Majordome Completely**, or
**Quit Majordome completely** in Settings → Overview. It starts again when you open
Majordome or log in.

## From a terminal

The app adds the `majord` command the first time it opens; you can also install it
from **Settings → About**. Without it on your PATH, run `~/.majordome/bin/majord`.

| Task                             | Command                    |
| -------------------------------- | -------------------------- |
| See whether it runs, and its log | `majord status`            |
| Turn it on, or repair it         | `majord service install`   |
| Restart it                       | `majord service restart`   |
| Turn it off                      | `majord service uninstall` |

Turning it off keeps your notes, threads and settings.

## Moving or updating the app

The background service runs the server inside the installed app, so it updates when
the app updates. If you move the app, open it once: it points the service at its new
place and restarts it. Until then, the service cannot start.

## Troubleshooting

The log is `~/.majordome/userdata/logs/majord.log`.

If Majordome no longer starts at login, check **System Settings → General → Login
Items**. If agent work cannot reach Desktop, Documents or Downloads, give Majordome
Full Disk Access in **System Settings → Privacy & Security**.

Majordome runs in the background on a Mac only for now. On Linux or a server, run
Majordome's container image.

## Reclaim database space

Majordome removes internal history older than a day on its own while it runs;
your conversations are kept. Databases created before this shrank automatically
still hold the freed space on disk until a one-time offline repair returns it
and turns on automatic shrinking. Settings > Maintenance (web and desktop) or
Settings > Maintenance (mobile) suggests the repair when at least 1 GiB can be
reclaimed.

When the desktop app or the background service runs Majordome on that machine,
select **Reclaim** in Settings on web or desktop. Majordome checks for free disk
space, then stops, repairs the database, and starts again. It is offline while
the repair runs, and running agents stop. If the repair fails, Settings shows
why.

In other cases, such as a server you started by hand, run `majord doctor` on the
machine that hosts the environment. It reports the database size and the
space it can reclaim, then asks which repairs to run;
pass `--fix` to run the recommended ones without a prompt (for scripts), or
`--dry-run` to only report. An installed background service for the same data
directory is stopped for the repair and started again afterwards, also when
the repair fails. Quit a server you started by hand, or the desktop app, first:
the repair refuses to touch a database that is in use, and names the server
process that holds it when it can tell. While the repair runs, a server started
for the same data directory, for example by a desktop app connecting over SSH,
is refused until the repair ends. Use `--base-dir` for a different data
directory.

The repair's time grows with the size of the whole database, not only the
space it reclaims, and can exceed an hour on a large database or a slow disk;
`majord doctor` shows each step as it runs. It rebuilds the database through a
temporary copy, so it needs free space of about twice the data still in use
(the database size minus the reclaimable space): once in the system temporary
directory (on Linux and macOS, `TMPDIR`, or `/var/tmp` when it is not set) and
once next to the database for its write-ahead log.

If you upgraded from a version before 0.1.0, its database (`state.sqlite`) is
still kept next to the current one so you can roll back. `majord doctor` offers to
delete it, but never selects that repair for you and `--fix` skips it: once it
is gone, a version before 0.1.0 starts with no threads or settings.
