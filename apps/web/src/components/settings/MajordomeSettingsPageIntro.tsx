import { msg, useMessages } from "gt-react";

import { PageOutline } from "../majordome/PageOutline";
import { PageHeader } from "../majordome/paper";
import { SETTINGS_SECTION_LABELS, type SettingsPath } from "./settingsSearch";

// One plain sentence per T3 page. Majordome's own pages write theirs in the page itself.
const UPSTREAM_PAGE_INTROS = {
  "/settings/general":
    "Notifications, language, time format, and the questions this app asks before it archives or deletes a chat.",
  "/settings/appearance":
    "The theme and colors of this app, and how its screens are laid out, on this device.",
  "/settings/chat":
    "How you write and send messages, and how much of the assistant's work a chat shows.",
  "/settings/voice":
    "Talk instead of typing: your microphone, the dictation shortcut, and how your speech becomes text.",
  "/settings/providers":
    "The AI accounts your assistant thinks with. Sign in to one here, or add another.",
  "/settings/projects":
    "The notes folders your assistant works in. Open another one here, or change how one is set up.",
  "/settings/threads":
    "What a new chat starts with, and what happens when you snooze a chat or reach a usage limit.",
  "/settings/connections":
    "The computer this app runs on, and the other computers it is connected to.",
  "/settings/access":
    "Who and what can reach this computer from elsewhere: network access, and the devices allowed to connect.",
  "/settings/browser":
    "How the assistant uses the built-in browser, where links open, and how recordings look.",
  "/settings/keybindings": "See and change the keyboard shortcuts of this app.",
  "/settings/secrets":
    "The keys your assistant can use, and where Majordome's own passwords and keys are kept, such as the Mac Keychain or 1Password.",
  "/settings/maintenance":
    "Updates, what keeps running in the background, cleaning up old files, and diagnostics for when something goes wrong.",
  "/settings/labs": "Features that are still being tried out. They may change or go away.",
  "/settings/about": "The version of this app, and its legal notices.",
  "/settings/archived": "The chats you archived. Bring one back, or delete it for good.",
  "/settings/diagnostics":
    "What is running right now and what failed recently, for when something goes wrong.",
} satisfies Partial<Record<SettingsPath, string>>;

const LICENSES_PATH = "/settings/open-source-licenses";
const LICENSES_TITLE = msg("Open source licenses");
const LICENSES_INTRO = "The open-source software this app is built with, and its licenses.";

function isUpstreamPage(pathname: string): pathname is keyof typeof UPSTREAM_PAGE_INTROS {
  return Object.hasOwn(UPSTREAM_PAGE_INTROS, pathname);
}

/** The title and intro Majordome puts on a T3 settings page, which has none of its own. */
export function MajordomeSettingsPageIntro({ pathname }: { readonly pathname: string }) {
  const m = useMessages();
  const path = pathname.replace(/\/+$/, "");
  if (path === LICENSES_PATH) {
    return <PageHeader title={m(LICENSES_TITLE)} intro={LICENSES_INTRO} />;
  }
  if (!isUpstreamPage(path)) return null;
  return (
    <>
      <PageHeader title={m(SETTINGS_SECTION_LABELS[path])} intro={UPSTREAM_PAGE_INTROS[path]} />
      <PageOutline />
    </>
  );
}
