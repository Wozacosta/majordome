import type { BrowserImportFailureReason, BrowserImportSource } from "@t3tools/contracts";

/** The site a tab is showing, as its sign-in is named: the host, without a leading "www.". */
export function siteOfUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return parsed.hostname === "" ? null : parsed.hostname;
  } catch {
    return null;
  }
}

const SIGN_IN_HOST = /^(?:login|signin|sign-in|auth|accounts?|id|sso|secure-login)\./i;
const SIGN_IN_PATH =
  /(?:^|\/)(?:log-?in|sign-?in|sign_in|signon|sso|auth(?:enticate|orize)?|oauth2?|session(?:s\/new)?)(?:[/.]|$)/i;

/** Whether a page's address looks like one that asks you to sign in. A hint, not a promise. */
export function looksLikeSignInPage(url: string | null | undefined): boolean {
  if (!url || siteOfUrl(url) === null) return false;
  const { hostname, pathname } = new URL(url);
  return SIGN_IN_HOST.test(hostname) || SIGN_IN_PATH.test(pathname);
}

export function siteLabel(host: string): string {
  return host.replace(/^www\./, "");
}

/** One of the owner's browser profiles a sign-in can be copied from. */
export interface SignInSource {
  readonly key: string;
  readonly sourceId: BrowserImportSource["id"];
  readonly profileDirectory: string;
  readonly label: string;
}

/**
 * The profiles to offer, the one used last time first. A browser that is open still counts: one
 * site's cookies are read from a copy. Browsers that are missing or need a permission are left out.
 */
export function signInSources(
  sources: ReadonlyArray<BrowserImportSource>,
  lastKey: string | null,
): ReadonlyArray<SignInSource> {
  const listed = sources.flatMap((source) =>
    source.unavailable !== undefined && source.unavailable !== "browserRunning"
      ? []
      : source.profiles.map((profile) => ({
          key: `${source.id}\n${profile.directory}`,
          sourceId: source.id,
          profileDirectory: profile.directory,
          label: source.profiles.length > 1 ? `${source.name}, ${profile.name}` : source.name,
        })),
  );
  return [
    ...listed.filter((source) => source.key === lastKey),
    ...listed.filter((source) => source.key !== lastKey),
  ];
}

/** Browsers that could be offered once the owner grants a permission, with what to do. */
export function blockedSignInSources(
  sources: ReadonlyArray<BrowserImportSource>,
): ReadonlyArray<{ readonly name: string; readonly why: string }> {
  return sources.flatMap((source) =>
    source.unavailable === "needsFullDiskAccess"
      ? [
          {
            name: source.name,
            why: "Give Majordome Full Disk Access in System Settings, under Privacy & Security.",
          },
        ]
      : [],
  );
}

const FAILURE_WORDS: Partial<Record<BrowserImportFailureReason, string>> = {
  needsKeychainApproval:
    "macOS asked for your password to read that browser's cookies. Allow it, then try again.",
  keychainItemMissing:
    "That browser has no saved key on this computer. Open it once, then try again.",
  needsFullDiskAccess:
    "Give Majordome Full Disk Access in System Settings, under Privacy & Security, then try again.",
  keychainUnavailable: "This computer's keychain could not be opened. Unlock it, then try again.",
  unknownSourceProfile: "That browser profile is no longer there.",
};

/** Why a sign-in could not be read from the owner's browser, in plain words. */
export function signInFailureWords(reason: BrowserImportFailureReason): string {
  return FAILURE_WORDS[reason] ?? "That browser's cookies could not be read.";
}
