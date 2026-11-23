# Import browser sessions

The desktop app can import cookies from another browser so you can reuse its signed-in sessions
in the preview browser.

Open **Settings → Browser → Browser profiles → Add profile**, then choose a browser under
**Import from**. Close the source browser before importing, and allow an operating-system keyring
unlock prompt if one appears.

This is a one-time copy. Later login changes stay separate between the two browsers, and some
sites may still require you to sign in again.

On macOS, Safari imports need Full Disk Access. Choose **Allow**, drag T3 Code into the
System Settings permission list, and turn access on. **Continue** becomes available when access
is detected. macOS may require you to quit and reopen T3 Code before the grant applies; reopen
the import wizard afterward. You can revoke Full Disk Access once the import is done.

On Windows, import supports Firefox, Zen, and Helium profiles that use standard profile encryption.
Other Chromium-based browsers use app-bound encryption and cannot be imported. Partitioned cookies
are skipped on all platforms.

## Use one site's sign-in

To sign in to just the site a tab is showing, press the key button in the side browser's bar and
choose the browser on this computer to copy the sign-in from. Only that site's cookies are
copied, and the page loads again signed in. It goes wherever the tab loads:

- **A tab on this computer** gets the sign-in in Majordome's own browser.
- **A tab the assistant opened on another computer**, such as an always-on server, gets it in
  that computer's browser, which otherwise starts signed out everywhere.

Good to know:

- The browser you copy from can stay open.
- **Sign out of this site here**, in the same menu, removes the site's cookies again. Your own
  browser is not affected.
- The button is in the desktop app only, and only you can press it: the assistant cannot ask for
  your sign-ins.
- A sign-in copied to another computer lets that computer act as you on that site until you sign
  out there. Some sites, banks especially, refuse a session that moves and ask you to sign in
  again.
