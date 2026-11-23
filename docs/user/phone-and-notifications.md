# Phone and notifications

Majordome on your phone is the same app, added to your Home Screen. Nothing is installed on the
phone, and it works away from home.

## Set up your phone

Open **Settings > Phone & notifications** on your computer. The page lists the steps and marks
them as you go.

### By signing in

With a [Majordome account](./account.md) there is no code to scan.

1. On your phone, open <https://majord.me/open> in the browser, sign in with the same account,
   and press **Open** next to your computer.
2. Add Majordome to your Home Screen, then open it from there.
3. On the phone, open **Settings > Phone & notifications** and turn on **Notifications on this
   device**.

This needs your computer to be in your account and to have an address. When it is not, the first
step says which is missing and links to **Settings > Your account**, where both are done.

### With a code

No account? Open **No account? Use a code instead** on the same page. On a version of Majordome
without accounts, these steps are the page.

1. Choose **Set up my phone** and confirm. Majordome gets this computer its own address, which can
   take half a minute the first time.
2. Scan the code on the page with your phone's camera. Each code works once and expires.
3. Add Majordome to your Home Screen, then open it from there.
4. On the phone, open **Settings > Phone & notifications** and turn on **Notifications on this
   device**.

If you have a server of your own, the page sets the phone up on the server, not on this computer:
the server runs your routines and never sleeps. The page names the computer your phone connects to.

The page marks a step **Done** when it can see it: opening Majordome on the phone, and turning
notifications on. It can't see whether you added Majordome to the Home Screen, and says so.

To add another phone, follow the same steps on it: sign in there, or show a new code. On an iPhone
or iPad, notifications only work from the Home Screen app. If the Home Screen app asks for a code
the first time, show one under **No account? Use a code instead** and type its letters.

### Remove a phone

**Phones that can open Majordome** lists every phone and tablet you added. If you lose one, choose
**Remove this phone**: it can no longer open Majordome until you scan a new code with it. If it also
got notifications, remove it from the notifications list too. Computers and other devices are in
**Settings > Sharing & access**.

The address is on the internet, but only devices signed in to your account or added with a code can get in, and the
connection passes through Cloudflare, a company that could technically read it. **Turn off this
address** closes it at once; phones set up with it stop working until you turn it on again. Turn it
on again within two weeks and the address is the same.

### More private: only your own devices

[Tailscale](https://tailscale.com) is a free app that links your own devices privately, so the
computer needs no address on the internet. It takes about 10 minutes and a free Tailscale account,
and Tailscale has to be installed on the computer and on each phone. The page has a checklist under
**More private** and marks each step **Done** as it goes; choose **Check again** after a step you
did outside Majordome.

A phone set up one way keeps working that way. To change it to the other, add Majordome to its Home
Screen again from the new code.

A phone on the same Wi-Fi can also open Majordome with nothing else set up, from the last option on
the page, but it gets no notifications and stops working away from home.

## Notifications

Each device decides for itself: turn **Notifications on this device** on or off on that device.
**Send a test** shows one right away. The list under it has every device that gets notifications;
**Remove** stops one you no longer use.

If the switch can't be turned on, the line under it says why. When notifications are blocked, allow
them on the device itself, then turn the switch on again: on an iPhone or iPad, open the Settings
app, then **Notifications > Majordome**. A device that can only read has to be added again from
your computer with a new code.

Majordome notifies you when:

- the assistant is waiting for you, with a question or something to approve;
- **Start my day** is ready;
- the assistant couldn't finish, or a routine ran past its time limit;
- routines paused for the rest of the day;
- something you asked to be told about happens, like "let me know when it's done".

Nothing else.
