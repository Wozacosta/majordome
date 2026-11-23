import { useAtomValue } from "@effect/atom-react";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { BrowserImportSource, EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { KeyRoundIcon } from "lucide-react";
import { useState } from "react";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import { previewEnvironment } from "../../state/preview";
import { useAtomCommand } from "../../state/use-atom-command";
import { previewBridge } from "../preview/previewBridge";
import { importFailureReason } from "../settings/IntegrationsSettings";
import { Button } from "../ui/button";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  blockedSignInSources,
  signInFailureWords,
  type SignInSource,
  signInSources,
  siteLabel,
  siteOfUrl,
} from "./siteSignIn.logic";

const LAST_SOURCE = Schema.NullOr(Schema.String);

/**
 * For a tab running on another computer, such as the always-on server: copies the owner's sign-in
 * for the site it shows from one of their own browsers on this computer, or removes it again.
 * Only a person's click does this; it is not something the assistant can ask for.
 */
export function SiteSignInButton(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly tabId: string;
  readonly url: string | null;
  /** Loads the page again, now signed in or out. */
  readonly onChanged: () => void;
}) {
  const allowed = useAtomValue(
    previewEnvironment.importSiteCookies.permissionAtom(props.environmentId),
  );
  const commands = { reportFailure: false, reportDefect: false };
  const importSiteCookies = useAtomCommand(previewEnvironment.importSiteCookies, commands);
  const clearSiteCookies = useAtomCommand(previewEnvironment.clearSiteCookies, commands);
  const [sources, setSources] = useState<ReadonlyArray<BrowserImportSource> | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastKey, setLastKey] = useLocalStorage("majordome:site-sign-in-source", null, LAST_SOURCE);
  const host = siteOfUrl(props.url);
  if (previewBridge === null || !allowed || host === null) return null;
  const bridge = previewBridge;
  const site = siteLabel(host);
  const target = { threadId: props.threadId, tabId: props.tabId };

  const failed = (title: string, result: AtomCommandResult<unknown, unknown>) => {
    if (result._tag !== "Failure") return;
    if (isAtomCommandInterrupted(result)) return;
    const error = squashAtomCommandFailure(result);
    toastManager.add({
      type: "error",
      title,
      description: error instanceof Error ? error.message : String(error),
    });
  };

  const signIn = async (source: SignInSource) => {
    setBusy(true);
    const read = await bridge
      .readBrowserSiteCookies({
        sourceId: source.sourceId,
        sourceProfileDirectory: source.profileDirectory,
        host,
      })
      .catch((cause: unknown) => {
        toastManager.add({
          type: "error",
          title: `Could not read your ${source.label} sign-in`,
          description: signInFailureWords(importFailureReason(cause)),
        });
        return null;
      });
    if (read === null) {
      setBusy(false);
      return;
    }
    if (read.cookies.length === 0) {
      setBusy(false);
      toastManager.add({
        type: "info",
        title: `No sign-in for ${site} in ${source.label}`,
        description:
          read.undecryptable > 0
            ? "Its cookies for this site could not be decrypted on this computer."
            : "Sign in to the site in that browser first, or sign in here by hand.",
      });
      return;
    }
    const result = await importSiteCookies({
      environmentId: props.environmentId,
      input: { ...target, cookies: read.cookies },
    });
    setBusy(false);
    if (result._tag === "Failure") {
      failed(`Could not sign in to ${site} here`, result);
      return;
    }
    setLastKey(source.key);
    props.onChanged();
    toastManager.add({
      type: "success",
      title: `This browser now uses your ${source.label} sign-in for ${site}`,
      description: "If the site still asks you to sign in, it does not accept a copied session.",
    });
  };

  const signOut = async () => {
    setBusy(true);
    const result = await clearSiteCookies({ environmentId: props.environmentId, input: target });
    setBusy(false);
    if (result._tag === "Failure") {
      failed(`Could not sign out of ${site} here`, result);
      return;
    }
    props.onChanged();
    toastManager.add({
      type: "success",
      title: `Signed out of ${site} in this browser`,
      description: "Your own browser on this computer is not affected.",
    });
  };

  const offered = sources === null ? [] : signInSources(sources, lastKey);
  const blocked = sources === null ? [] : blockedSignInSources(sources);
  return (
    <Menu
      onOpenChange={(open) => {
        if (!open) return;
        void bridge
          .listBrowserImportSources()
          .then(setSources)
          .catch(() => setSources([]));
      }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  type="button"
                  disabled={busy}
                  aria-label={`Use my sign-in for ${site}`}
                />
              }
            />
          }
        >
          <KeyRoundIcon />
        </TooltipTrigger>
        <TooltipPopup>Use my sign-in for this site</TooltipPopup>
      </Tooltip>
      <MenuPopup align="end">
        <MenuGroup>
          <MenuGroupLabel>Sign in to {site} here with</MenuGroupLabel>
          {sources === null ? (
            <MenuItem disabled>Looking at your browsers…</MenuItem>
          ) : offered.length === 0 ? (
            <MenuItem disabled>No browser to copy a sign-in from</MenuItem>
          ) : (
            offered.map((source) => (
              <MenuItem key={source.key} onClick={() => void signIn(source)}>
                {source.label}
              </MenuItem>
            ))
          )}
          {blocked.map((source) => (
            <MenuItem key={source.name} disabled title={source.why}>
              {source.name} (needs Full Disk Access)
            </MenuItem>
          ))}
        </MenuGroup>
        <MenuSeparator />
        <MenuItem onClick={() => void signOut()}>Sign out of {site} here</MenuItem>
      </MenuPopup>
    </Menu>
  );
}
