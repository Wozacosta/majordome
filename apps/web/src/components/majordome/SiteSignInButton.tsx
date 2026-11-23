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
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "../ui/menu";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  blockedSignInSources,
  looksLikeSignInPage,
  signInFailureWords,
  type SignInSource,
  signInSources,
  siteLabel,
  siteOfUrl,
} from "./siteSignIn.logic";

const LAST_SOURCE = Schema.NullOr(Schema.String);

/** Which browser a tab loads in, and so where a sign-in has to go. */
export type SiteSignInPlace =
  /** Another computer's browser, such as the always-on server's, watched from here. */
  | { readonly kind: "server"; readonly threadId: ThreadId; readonly tabId: string }
  /** This app's own browser, on this computer. */
  | { readonly kind: "here"; readonly profileId: string | undefined };

export interface SiteSignInProps {
  readonly environmentId: EnvironmentId;
  readonly place: SiteSignInPlace;
  readonly url: string | null;
  /** Loads the page again, now signed in or out. */
  readonly onChanged: () => void;
}

/**
 * Copies the owner's sign-in for the site a tab shows from one of their own browsers on this
 * computer into the browser the tab loads in, or removes it again. Only a person's click does
 * this; it is not something the assistant can ask for. Null where it cannot be offered.
 */
function useSiteSignIn(props: SiteSignInProps) {
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
  const { place } = props;
  if (previewBridge === null || host === null || props.url === null) return null;
  if (place.kind === "server" && !allowed) return null;
  const bridge = previewBridge;
  const pageUrl = props.url;
  const site = siteLabel(host);
  const where = place.kind === "server" ? "This browser" : "Majordome's browser";

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

  const readFailed = (source: SignInSource) => (cause: unknown) => {
    toastManager.add({
      type: "error",
      title: `Could not read your ${source.label} sign-in`,
      description: signInFailureWords(importFailureReason(cause)),
    });
    return null;
  };
  const noneFound = (source: SignInSource, undecryptable: boolean) =>
    toastManager.add({
      type: "info",
      title: `No sign-in for ${site} in ${source.label}`,
      description: undecryptable
        ? "Its cookies for this site could not be decrypted on this computer."
        : "Sign in to the site in that browser first, or sign in here by hand.",
    });
  const signedIn = (source: SignInSource) => {
    setLastKey(source.key);
    props.onChanged();
    toastManager.add({
      type: "success",
      title: `${where} now uses your ${source.label} sign-in for ${site}`,
      description: "If the site still asks you to sign in, it does not accept a copied session.",
    });
  };

  /** Read here, written on the other computer. */
  const signInThere = async (
    source: SignInSource,
    there: Extract<SiteSignInPlace, { kind: "server" }>,
  ) => {
    const read = await bridge
      .readBrowserSiteCookies({
        sourceId: source.sourceId,
        sourceProfileDirectory: source.profileDirectory,
        host,
      })
      .catch(readFailed(source));
    if (read === null) return;
    if (read.cookies.length === 0) {
      noneFound(source, read.undecryptable > 0);
      return;
    }
    const result = await importSiteCookies({
      environmentId: props.environmentId,
      input: { threadId: there.threadId, tabId: there.tabId, cookies: read.cookies },
    });
    if (result._tag === "Failure") {
      failed(`Could not sign in to ${site} here`, result);
      return;
    }
    signedIn(source);
  };

  /** Read and written on this computer, without the cookies passing through the page. */
  const signInHere = async (
    source: SignInSource,
    here: Extract<SiteSignInPlace, { kind: "here" }>,
  ) => {
    const written = await bridge
      .importBrowserSiteCookies({
        environmentId: props.environmentId,
        ...(here.profileId === undefined ? {} : { targetProfileId: here.profileId }),
        sourceId: source.sourceId,
        sourceProfileDirectory: source.profileDirectory,
        host,
      })
      .catch(readFailed(source));
    if (written === null) return;
    if (written.imported === 0) {
      noneFound(source, false);
      return;
    }
    signedIn(source);
  };

  const signIn = async (source: SignInSource) => {
    setBusy(true);
    await (place.kind === "server" ? signInThere(source, place) : signInHere(source, place));
    setBusy(false);
  };

  const signOut = async () => {
    setBusy(true);
    if (place.kind === "server") {
      const result = await clearSiteCookies({
        environmentId: props.environmentId,
        input: { threadId: place.threadId, tabId: place.tabId },
      });
      setBusy(false);
      if (result._tag === "Failure") {
        failed(`Could not sign out of ${site} here`, result);
        return;
      }
    } else {
      const cleared = await bridge
        .clearBrowserSiteCookies({
          environmentId: props.environmentId,
          ...(place.profileId === undefined ? {} : { profileId: place.profileId }),
          url: pageUrl,
        })
        .catch(() => null);
      setBusy(false);
      if (cleared === null) {
        toastManager.add({ type: "error", title: `Could not sign out of ${site} here` });
        return;
      }
    }
    props.onChanged();
    toastManager.add({
      type: "success",
      title: `Signed out of ${site} in ${where === "This browser" ? "this browser" : where}`,
      description: "Your own browser on this computer is not affected.",
    });
  };

  return {
    site,
    busy,
    /** Null until the owner's browsers have been looked at. */
    offered: sources === null ? null : signInSources(sources, lastKey),
    blocked: sources === null ? [] : blockedSignInSources(sources),
    lookAtBrowsers: () => {
      void bridge
        .listBrowserImportSources()
        .then(setSources)
        .catch(() => setSources([]));
    },
    signIn,
    signOut,
  };
}

type SiteSignIn = NonNullable<ReturnType<typeof useSiteSignIn>>;

/** The browsers a sign-in can be copied from, as menu rows. */
function SignInSourceItems({ signIn }: { readonly signIn: SiteSignIn }) {
  return (
    <>
      {signIn.offered === null ? (
        <MenuItem disabled>Looking at your browsers…</MenuItem>
      ) : signIn.offered.length === 0 ? (
        <MenuItem disabled>No browser to copy a sign-in from</MenuItem>
      ) : (
        signIn.offered.map((source) => (
          <MenuItem key={source.key} onClick={() => void signIn.signIn(source)}>
            {source.label}
          </MenuItem>
        ))
      )}
      {signIn.blocked.map((source) => (
        <MenuItem key={source.name} disabled title={source.why}>
          {source.name} (needs Full Disk Access)
        </MenuItem>
      ))}
    </>
  );
}

/** The key button in the side browser's bar. It stands out on a page that asks to sign in. */
export function SiteSignInButton(props: SiteSignInProps) {
  const signIn = useSiteSignIn(props);
  if (signIn === null) return null;
  const asked = looksLikeSignInPage(props.url);
  return (
    <Menu
      onOpenChange={(open) => {
        if (open) signIn.lookAtBrowsers();
      }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              render={
                <Button
                  variant={asked ? "outline" : "ghost"}
                  size="icon-xs"
                  type="button"
                  disabled={signIn.busy}
                  aria-label={`Use my sign-in for ${signIn.site}`}
                />
              }
            />
          }
        >
          <KeyRoundIcon className={asked ? "text-primary" : undefined} />
        </TooltipTrigger>
        <TooltipPopup>
          {asked
            ? "This page asks you to sign in. Use your own sign-in for this site"
            : "Use my sign-in for this site"}
        </TooltipPopup>
      </Tooltip>
      <MenuPopup align="end">
        <MenuGroup>
          <MenuGroupLabel>Sign in to {signIn.site} here with</MenuGroupLabel>
          <SignInSourceItems signIn={signIn} />
        </MenuGroup>
        <MenuSeparator />
        <MenuItem onClick={() => void signIn.signOut()}>Sign out of {signIn.site} here</MenuItem>
      </MenuPopup>
    </Menu>
  );
}

/** The same two actions as rows of the side browser's "more" menu. */
export function SiteSignInMenuItems(props: SiteSignInProps) {
  const signIn = useSiteSignIn(props);
  if (signIn === null) return null;
  return (
    <>
      <MenuSeparator />
      <MenuSub
        onOpenChange={(open) => {
          if (open) signIn.lookAtBrowsers();
        }}
      >
        <MenuSubTrigger disabled={signIn.busy}>Use my sign-in for {signIn.site}</MenuSubTrigger>
        <MenuSubPopup>
          <SignInSourceItems signIn={signIn} />
        </MenuSubPopup>
      </MenuSub>
      <MenuItem disabled={signIn.busy} onClick={() => void signIn.signOut()}>
        Sign out of {signIn.site} here
      </MenuItem>
    </>
  );
}
