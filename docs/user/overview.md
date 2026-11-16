# Overview

**Settings > Overview** answers one question: is your assistant OK?

The first line is the answer: **Everything is working**, or how many things need you. What needs
you is listed right under it. Click a line to open the page where you fix it.

Below that, the page goes through each part:

- **Where it runs**: each machine Majordome is on, whether it is connected, and which one runs your
  routines. On a Mac, the switch that keeps Majordome running when the window is closed is here.
- **Routines**: whether they can run, and for each one when it runs next and how its last run went.
- **Notes**: whether your notes are backed up, and whether the notes search is ready.
- **AI and access**: which AIs are signed in, where keys and tokens are read from, and your private
  documents.
- **Phone**: how many devices get notifications, and whether the secure address is on.

## The colours

- Green: fine.
- Grey: nothing to do. Something is off because you never turned it on, or is still getting ready.
- Orange: needs you. A sign-in ran out, a backup you chose is stuck, a run waits for your answer.
- Red: something failed, such as a run that couldn't finish.

Only orange and red count in the first line.

## Good to know

- Connectors such as Gmail or Calendar are not checked here, because checking them starts each AI's
  own program. Open **Connections** from the "AI and access" heading to see them.
- For keys and tokens, the page shows where they are read from and how many settings use each
  source. It does not open them, so it cannot tell you whether each one still works. Use the
  check button next to a key or token field for that; see [Secrets](./secrets.md).
- If the notes search fails, its line gets a **Rebuild** button. Your notes are not touched.
- A machine that is switched off or runs an older Majordome stays on the page, and its lines say
  so.
