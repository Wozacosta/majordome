# Private documents

Some files you want your assistant to be able to use, but never to have lying around: a passport
scan, a tax return, a contract. Private documents are kept encrypted on one machine, outside your
notes folder. They are not part of your notes' backups to GitHub, Google Drive or a folder. Your
assistant can see their names, and can open one only after you say yes, each time.

## Add a document

Open **Settings > Private documents**, choose **Add a document** and pick a file of up to 25 MB.
Give it a name your assistant will recognise, such as "Passport", and optionally a line saying what
it is. Your assistant sees the name and that line, never the file.

Majordome encrypts the file and keeps only the encrypted copy. It does not move or delete your
original, so keep that somewhere safe: Majordome's copy can only be opened on the machine that
holds it.

You can also add one from a topic's conversation: **Add a file** on the **Files** card, then **Keep
private**. It is then listed with that topic as well as here.

With several machines, each has its own list. A document lives on the machine you added it to, and
only conversations and routines that run there can ask for it.

**Download** gives you the file back. **Remove** deletes Majordome's encrypted copy for good.

In a topic's **Files** list, clicking a private picture shows it over the conversation without
saving it anywhere. Any other private file is downloaded.

## When your assistant asks for one

When a task needs what a document says, your assistant asks. You get a notification, and a card in
the conversation says which document, and why. The same question is in **What it did** under **Needs
you**.

- **Allow once** opens that one document for that conversation or routine run. Majordome makes a
  temporary readable copy and deletes it when the run ends, or after 15 minutes, whichever comes
  first. The next time, it asks again.
- **Don't allow** leaves it closed. Your assistant tells you what it could not do.
- With no answer for 24 hours, the request is refused. A routine that runs while you are away waits
  for you; it never opens a document on its own.

Once you allow a document, your assistant has read it. It is told not to copy the document or what
it says into your notes unless you ask, but allow only what the task needs.

## Who opened what

The same page lists every request, every answer and every time a document was opened, newest first:
when, which document, which conversation or routine, and the reason it gave. Your own downloads,
additions and removals are listed too. The list never holds what a document says. **Settings >
Status** shows how many documents you keep, what last happened, and any request that waits for
your answer.

## What it protects, and what it doesn't

Each document is encrypted with a key that stays on its machine: in the Keychain on a Mac, in
Majordome's own data folder on a server.

It protects against a private document turning up in your notes, in their backups or on another
device they sync to; against a copy of the document files being readable; and against your
assistant reading one without asking.

It does not protect against someone who controls the machine, or your account on it, while
Majordome runs there. On a server, the key sits in the same data folder as the encrypted files, so
a copy of that whole folder can open them: keep the server private, as the
[guide to your own server](./always-on-server.md) sets it up. Passwords do not belong here; keep
them in a password manager.
