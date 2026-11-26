/**
 * Whether the app was just installed. iOS deletes an app's files with it but keeps its keychain,
 * so a phone that already ran the app has its database or the mark this leaves; a new install
 * has neither.
 */
export function isFreshInstall(found: {
  readonly mark: boolean;
  readonly database: boolean;
}): boolean {
  return !found.mark && !found.database;
}
