# Connect an app

Your assistant can use an app you already have, such as Granola for your meeting notes. You sign
in once, in Majordome, and every AI you use there can reach the app.

## Connect

Open **Settings > Connections**. Under **Apps**, press **Connect** next to the app. Your browser
opens the app's own page: approve there, and close the tab when it says the app is connected.

Then ask for something the app knows, such as "what was my last meeting about?"

Today the list holds Granola. More are added as each is checked.

## What a routine may do

In a chat you are in, your assistant can read from the app and change things in it, such as
renaming a meeting.

A routine runs with nobody watching, and what an app holds is partly written by other people. So
a routine, and a task your assistant hands to a helper, may only read from the app. To let them
change things too, turn on **Routines may change things here** under the app.

## One machine at a time

A connection belongs to the machine you made it on. If routines run on a server, connect the app
there too: choose the server at the top of the Connections page first.

Majordome keeps the sign-in on that machine and adds it to each request itself. It is not handed
to the AI.

## Disconnect

**Disconnect** tells the app to forget Majordome's access and deletes the sign-in from the
machine. If an app shows **Needs sign-in**, its access ran out: press **Sign in**.

## Apps in your Claude account

Gmail, Google Calendar and Google Drive come with your Claude account instead, and only Claude
can use them. They are listed on the same page; see
[What the server can reach](./always-on-server.md#what-the-server-can-reach).
