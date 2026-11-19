<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/brand/wordmark-dark.svg">
    <img src="assets/brand/wordmark-light.svg" height="44" alt="Majordome">
  </picture>
</h1>

A second brain with an agent that keeps working while you are away.

Majordome is a fork of [T3 Code](https://github.com/pingdotgg/t3code). Your memory is a folder
of markdown notes (an Obsidian vault, synced with git). The agent reads it before you type, files
what you drop in, runs routines on a schedule, and asks before it touches anything sensitive.

Work in progress. `servo` is the repository's codename. See [docs/decisions.md](docs/decisions.md)
for the design.

## Install

Majordome runs on a Mac. It uses your own Claude subscription, through Claude Code.

1. Download Majordome from the [latest release](https://github.com/Wozacosta/majordome/releases/latest):
   the file ending in `arm64.dmg` for a Mac with Apple silicon, `x64.dmg` for an Intel Mac.
2. Open the file, drag Majordome to Applications, and open it.
3. On the welcome screen, sign in to Claude. If [Claude Code](https://code.claude.com/docs/en/setup)
   is not on your Mac yet, the same screen installs it.
4. Choose **Start new notes**, or **Choose folder** to use notes you already have, such as an
   Obsidian vault. Majordome adds a few files of its own and changes nothing that is there.

Then, when you want them:

- [Routines](docs/user/routines.md) that run on a schedule.
- [An always-on server](docs/user/always-on-server.md), so routines and long tasks run while your
  Mac sleeps.
- [Private documents](docs/user/private-documents.md) the assistant asks before opening.

## Credits

Built on T3 Code by T3 Tools Inc., under the [MIT License](LICENSE). The vault layout and skills
come from [obrain](https://github.com/Wozacosta/obrain).
