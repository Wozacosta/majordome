# Memory

Your assistant starts every conversation knowing what is in your memory note (`memory.md`), plus
today's and yesterday's daily notes. Anything older it has to go and look for. So a thing you said
once, such as who your accountant is or what you decided about the gym, is only there two days later
if it reached your memory note.

## Tidy my memory

"Tidy my memory" is a routine that does this for you. Every night at 3:30, by the clock of the
machine that runs your routines, it reads the notes that changed since its last run and keeps what
will still matter in a month: facts about you and your people, decisions, preferences, commitments
with their dates, and how you do things that come back.

- What is worth knowing in every conversation goes into your memory note, as one short dated line
  with a link to the note it came from.
- What belongs to one topic or project goes into that topic's own notes, such as its `log.md`.
- It only adds to your memory note and to topic notes. It does not rewrite your daily notes, and it
  never edits `CLAUDE.md` or `AGENTS.md`.
- It does not copy passwords, card numbers or keys. When it finds one in a note, it leaves it there
  and tells you which note.

It works from your notes, not from the text of your conversations: something you only said in a
chat is remembered when the assistant wrote it down then.

On a night when no note changed, it does not run, and does not count towards your runs per day.

## Keeping memory short

The memory note is loaded up to 8,000 characters. Past that, the end of it is left out of
conversations, and the Feed says so. The nightly run then shortens the note before adding to it: it
merges lines that say the same thing, drops what a newer line replaced, and moves lines about one
topic into that topic's notes. Its summary lists everything it merged, moved or dropped.

## See, undo, or turn it off

Each run that changed something is in the **Feed** with a summary: what it remembered, what it
merged or moved, and anything it was not sure about, as a question you can answer when you like.
**Undo this** on that entry takes the whole night back. A run that found nothing to keep changes
nothing and leaves no entry.

To change the hour, edit what it does, or turn it off, open **Settings > Routines** and choose
"Tidy my memory". If you delete it, Majordome does not bring it back.
