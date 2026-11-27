# About you

`me.md`, at the top of your notes folder, holds the facts about you that stay true and that a form,
a booking or a letter asks for: your name, address, phone, email, where you work, the people in
your household, who to call in an emergency. One fact per line, under a heading, as
`- Label: value`. It is a note like any other: open it and edit it by hand whenever you like.

Every conversation starts knowing the lines under **Me** and **Contact**. The rest (Work, Identity
documents, Money, Household, Emergency contact) stays in the note, and your assistant reads it when
a task needs it. **What this chat knows**, in a chat's side panel, has an **About you** row that
opens the note.

## Filling it in

You do not have to. When you start your notes, the welcome page asks what to call you; that, your
language and your time zone are the first three lines. After that your assistant fills the note as
it goes:

- Say a fact, such as "my new number is 06 12 34 56 78", and it writes the line, replacing the old
  one.
- When a task needs a fact that is not there, it searches your notes before it asks you.
- "Tidy my memory" moves such facts from your daily notes into `me.md` at night.

If you already had notes before `me.md` existed, ask once: "Fill in me.md from my notes."

## Passport, tax and bank numbers

These are not written in `me.md` or in any other note, because notes are plain text and are copied
wherever your notes are backed up. Tell your assistant the number, or add it yourself in
**Settings → Passwords and keys**, and it is kept encrypted with your [saved keys](./secrets.md).
`me.md` only names it:

```
## Identity documents
- Passport: saved key passport-number, expires 2031-04-02
```

Give the day a document expires and you are reminded in its last month, as for any saved key.
When a form needs the number, your assistant takes it from there without asking you again. It has
to read the number to type it, so for that one task the number does reach the AI service you use.

Each of your computers keeps its own saved keys. **Settings → Passwords and keys** saves a number
on every computer that holds your notes, and says when one of them is missing it.

Scans of the documents themselves belong in [private documents](./private-documents.md), which ask
for your yes each time.
