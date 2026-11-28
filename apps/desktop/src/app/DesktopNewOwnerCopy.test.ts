import { expect, it } from "vite-plus/test";

import { NEW_OWNER_COPY_ENV, newOwnerCopyEnvironment } from "./DesktopNewOwnerCopy.ts";

it("gives the copy an empty home and nothing that leads back to the owner's", () => {
  const copy = newOwnerCopyEnvironment(
    {
      HOME: "/Users/alice",
      PATH: "/usr/bin",
      T3CODE_HOME: "/Users/alice/.majordome",
      T3CODE_PORT: "3774",
      ELECTRON_RUN_AS_NODE: "1",
      UNSET: undefined,
    },
    "/tmp/new-owner",
  );

  expect(copy).toEqual({
    HOME: "/tmp/new-owner",
    PATH: "/usr/bin",
    [NEW_OWNER_COPY_ENV]: "1",
    T3CODE_DISABLE_AUTO_UPDATE: "1",
  });
});
