import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import { BrowserProfileId } from "./browserProfile.ts";

const BROWSER_IMPORT_SOURCE_IDS = [
  "chrome",
  "edge",
  "brave",
  "vivaldi",
  "opera",
  "arc",
  "helium",
  "firefox",
  "zen",
  "safari",
] as const;

export const BrowserImportSourceId = Schema.Literals(BROWSER_IMPORT_SOURCE_IDS);
export type BrowserImportSourceId = typeof BrowserImportSourceId.Type;

export const BrowserImportUnavailableReason = Schema.Literals([
  "notInstalled",
  "needsKeychainApproval",
  "keychainItemMissing",
  "needsFullDiskAccess",
  "browserRunning",
  "unsupportedPlatform",
]);
export type BrowserImportUnavailableReason = typeof BrowserImportUnavailableReason.Type;

export const BrowserImportFailureReason = Schema.Literals([
  ...BrowserImportUnavailableReason.literals,
  "keychainUnavailable",
  "unknownSource",
  "unknownSourceProfile",
  "sessionUnavailable",
  "profileNotSaved",
  "profileLimitReached",
  "readFailed",
]);
export type BrowserImportFailureReason = typeof BrowserImportFailureReason.Type;

export const BrowserImportSourceProfile = Schema.Struct({
  directory: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  cookieCount: Schema.optional(Schema.Int),
});
export type BrowserImportSourceProfile = typeof BrowserImportSourceProfile.Type;

export const BrowserImportSource = Schema.Struct({
  id: BrowserImportSourceId,
  name: TrimmedNonEmptyString,
  profiles: Schema.Array(BrowserImportSourceProfile),
  unavailable: Schema.optional(BrowserImportUnavailableReason),
});
export type BrowserImportSource = typeof BrowserImportSource.Type;

export const BrowserImportInput = Schema.Struct({
  sourceId: BrowserImportSourceId,
  sourceProfileDirectory: TrimmedNonEmptyString,
  targetProfileId: BrowserProfileId,
});
export type BrowserImportInput = typeof BrowserImportInput.Type;

export const DesktopPreviewImportCookiesInputSchema = Schema.Struct({
  environmentId: TrimmedNonEmptyString,
  sourceId: BrowserImportSourceId,
  sourceProfileDirectory: TrimmedNonEmptyString,
  targetProfileId: BrowserProfileId,
});

/** The most cookies one site's sign-in is copied with; a site rarely keeps a tenth of this. */
export const BROWSER_SITE_COOKIES_MAX = 300;

/** One cookie of a site, as read from the owner's browser and written to another one. */
export const BrowserSiteCookie = Schema.Struct({
  name: Schema.String.check(Schema.isMaxLength(512)),
  value: Schema.String.check(Schema.isMaxLength(8_192)),
  /** With a leading dot for a cookie its subdomains also get, else the one host it belongs to. */
  domain: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
  path: Schema.String.check(Schema.isMaxLength(2_048)),
  secure: Schema.Boolean,
  httpOnly: Schema.Boolean,
  /** Seconds since 1970; absent for a cookie that lasts until the browser closes. */
  expires: Schema.optional(Schema.Number),
  sameSite: Schema.optional(Schema.Literals(["Strict", "Lax", "None"])),
});
export type BrowserSiteCookie = typeof BrowserSiteCookie.Type;

export const BrowserSiteCookies = Schema.Array(BrowserSiteCookie).check(
  Schema.isMaxLength(BROWSER_SITE_COOKIES_MAX),
);

export const DesktopPreviewReadSiteCookiesInputSchema = Schema.Struct({
  sourceId: BrowserImportSourceId,
  sourceProfileDirectory: TrimmedNonEmptyString,
  /** The host of the page being signed in to, such as `github.com`. */
  host: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
});
export type DesktopPreviewReadSiteCookiesInput =
  typeof DesktopPreviewReadSiteCookiesInputSchema.Type;

export const BrowserSiteCookiesResult = Schema.Struct({
  cookies: BrowserSiteCookies,
  /** Cookies of the site this computer could not decrypt, left out. */
  undecryptable: Schema.Int,
});
export type BrowserSiteCookiesResult = typeof BrowserSiteCookiesResult.Type;

export const BrowserImportResult = Schema.Struct({
  imported: Schema.Int,
  skipped: Schema.Int,
  skippedDomains: Schema.Array(Schema.String),
});
export type BrowserImportResult = typeof BrowserImportResult.Type;

const BROWSER_IMPORT_UNAVAILABLE_COPY: Readonly<Record<BrowserImportUnavailableReason, string>> = {
  notInstalled: "Not installed on this machine.",
  needsKeychainApproval: "Needs Keychain access to read its cookies.",
  keychainItemMissing:
    "No encryption key in your Keychain. Sign in to that browser once, then retry.",
  needsFullDiskAccess:
    "Give T3 Code Full Disk Access in System Settings → Privacy & Security, then retry.",
  browserRunning: "Quit the browser first so its cookie database can be read.",
  unsupportedPlatform: "Importing from this browser isn't possible on this platform.",
};

export const BROWSER_IMPORT_FAILURE_COPY: Readonly<Record<BrowserImportFailureReason, string>> = {
  ...BROWSER_IMPORT_UNAVAILABLE_COPY,
  keychainUnavailable:
    "The system keyring could not be accessed. Make sure your desktop keyring is running and unlocked, then retry.",
  unknownSource: "That browser is no longer available to import from.",
  unknownSourceProfile: "That browser profile no longer exists.",
  sessionUnavailable: "The target profile could not be opened.",
  profileNotSaved: "The cookies were imported, but the new profile couldn't be saved. Try again.",
  profileLimitReached:
    "You've reached the profile limit. Delete a profile or import into an existing one.",
  readFailed: "The browser's cookie database could not be read.",
};
