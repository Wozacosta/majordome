# Phone and notifications

Majordome on your phone is the same app, added to your Home Screen. It reaches your computer
through [Tailscale](https://tailscale.com), a free app that links your own devices privately, so it
works away from home and nobody else can open it.

## Set up your phone

Open **Settings > Phone & notifications** on your computer. It takes about 10 minutes and a free
Tailscale account. The page is a checklist and marks each step **Done** as it goes:

1. Install Tailscale on the computer and sign in.
2. Turn on secure addresses in Tailscale (MagicDNS and HTTPS Certificates).
3. Turn on Majordome's secure address, with the button on the page.
4. Install Tailscale on your phone and sign in with the same account.
5. Scan the code on the page with your phone's camera. Each code works once and expires.
6. Add Majordome to your Home Screen, then open it from there.
7. On the phone, open **Settings > Phone & notifications** and turn on **Notifications on this
   device**.

Choose **Check again** after a step you did outside Majordome. To add another phone, follow the
steps again from step 4.

On an iPhone or iPad, notifications only work from the Home Screen app. A phone on the same Wi-Fi
can also open Majordome without Tailscale, from the option under the checklist, but it gets no
notifications and stops working away from home.

## Notifications

Each device decides for itself: turn **Notifications on this device** on or off on that device.
**Send a test** shows one right away. The list under it has every device that gets notifications;
**Remove** stops one you no longer use.

Majordome notifies you when:

- the assistant is waiting for you, with a question or something to approve;
- **Start my day** is ready;
- the assistant couldn't finish, or a routine ran past its time limit;
- routines paused for the rest of the day;
- something you asked to be told about happens, like "let me know when it's done".

Nothing else.
