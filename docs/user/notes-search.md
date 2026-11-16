# Searching your notes

Majordome can look inside every note, not only at file names.

## Search yourself

Open **Notes** and type in **Search in your notes**. The notes that hold your words show up as you
type, with the line where they were found. Click one to open it. Clear the box to get the folders
back.

- Several words find notes that hold all of them, anywhere in the note.
- Capitals and accents do not matter: `ete` finds "été".
- The last word can be unfinished: `accoun` finds "accountant".
- Put words in quotes to find them together: `"tax return"`.

The **Search files** box in the folder list is different: it only filters file and folder names.

## Your assistant searches too

When you ask about something you wrote down, your assistant searches your notes the same way, then
opens the notes it needs. You do not have to say which file.

## Good to know

Majordome keeps a search index beside its own data, not in your notes folder. It builds it the
first time it sees your notes and keeps it up to date as notes change, including changes made in
Obsidian or pulled from another machine; those can take a few minutes to show up. A large folder
takes a few seconds the first time, and the search says so while it is still reading.

The index is not part of your backup and does not need to be: it is rebuilt from your notes
whenever it is missing. With several machines, each one keeps its own.

Notes are text files (`.md`, `.markdown`, `.mdx`, `.txt`, `.org`) of up to 1 MB. Images, PDFs and
hidden folders are not searched.
