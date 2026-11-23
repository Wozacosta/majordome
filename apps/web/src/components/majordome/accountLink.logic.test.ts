import { expect, it } from "vite-plus/test";

import { addServersAfterSignIn, SIGN_IN_ASKED_FOR_MS } from "./accountLink.logic";

it("adds the connected servers only after a sign-in asked for here, once they are loaded", () => {
  const asked = { askedAt: 1_000, now: 61_000, signedIn: true, catalogReady: true };
  expect(addServersAfterSignIn(asked)).toBe("add");
  expect(addServersAfterSignIn({ ...asked, catalogReady: false })).toBe("wait");
  expect(addServersAfterSignIn({ ...asked, signedIn: false })).toBe("wait");
  // A window that opens already signed in asked for nothing.
  expect(addServersAfterSignIn({ ...asked, askedAt: null })).toBe("never");
  // A "Sign in" pressed and given up on does not count for a later sign-in.
  expect(addServersAfterSignIn({ ...asked, now: 1_000 + SIGN_IN_ASKED_FOR_MS + 1 })).toBe("never");
});
