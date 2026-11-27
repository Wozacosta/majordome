/**
 * Accounts for trying the app as someone else. The account service's development instance takes
 * any address carrying `+clerk_test` with one fixed code and sends no email; its production
 * instance has no such addresses, so there the list is empty.
 */
export const TEST_CODE = "424242";
/** The development instance asks every new account for one. It guards nothing: these accounts are open to anyone with the code above. */
export const TEST_PASSWORD = "majordome-test-Zq7x-424242";

const testEmail = (name: string) => `majordome-dev+${name}+clerk_test@example.com`;

interface TestAccount {
  readonly label: string;
  readonly email: string;
}

/** Kept accounts: each stays as it was left, so one can hold a computer and another nothing. */
const KEPT: ReadonlyArray<TestAccount> = ["1", "2", "3"].map((name) => ({
  label: `Test account ${name}`,
  email: testEmail(name),
}));

export function testAccounts(publishableKey: string | null): ReadonlyArray<TestAccount> {
  return publishableKey?.startsWith("pk_test_") === true ? KEPT : [];
}

export const NEW_TEST_ACCOUNT = "A new account";

/** An address no account has yet: `stamp` is the time, which no two taps share. */
export function newTestEmail(stamp: number = Date.now()): string {
  return testEmail(`new${stamp.toString(36)}`);
}

/** The account service's word for an address it has no account for. */
export function isUnknownAccount(failure: unknown): boolean {
  const errors: unknown =
    typeof failure === "object" && failure !== null ? Reflect.get(failure, "errors") : null;
  const first: unknown = Array.isArray(errors) ? errors[0] : null;
  return (
    typeof first === "object" &&
    first !== null &&
    Reflect.get(first, "code") === "form_identifier_not_found"
  );
}
