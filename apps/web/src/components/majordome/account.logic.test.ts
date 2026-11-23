import { expect, it } from "vite-plus/test";

import { readAccountServers, withAccountServer, withoutAccountServer } from "./account.logic";

const laptop = { environmentId: "env-laptop", url: "https://k7m2xq9d.majord.link", name: "Laptop" };
const hosted = { environmentId: "env-hosted", url: "https://majordome-abc.fly.dev", name: "Cloud" };

it("lists only servers reached over HTTPS, once each", () => {
  expect(
    readAccountServers({
      majordomeServers: [
        laptop,
        { ...laptop, name: "Laptop again" },
        { environmentId: "env-plain", url: "http://192.168.1.4:3774", name: "Plain" },
        { environmentId: "env-script", url: "javascript:alert(1)", name: "Script" },
        { url: hosted.url },
        "nonsense",
      ],
    }),
  ).toEqual([{ ...laptop, name: "Laptop again" }]);
  expect(readAccountServers(null)).toEqual([]);
  expect(readAccountServers({ majordomeServers: "nonsense" })).toEqual([]);
});

it("adds, replaces and removes a server without touching the rest of the account", () => {
  const added = withAccountServer({ theme: "dark", majordomeServers: [laptop] }, hosted);
  expect(added).toEqual({ theme: "dark", majordomeServers: [laptop, hosted] });

  const moved = withAccountServer(added, { ...laptop, url: "https://new.majord.link" });
  expect(readAccountServers(moved).map((server) => server.url)).toEqual([
    hosted.url,
    "https://new.majord.link",
  ]);

  expect(withoutAccountServer(added, laptop.environmentId)).toEqual({
    theme: "dark",
    majordomeServers: [hosted],
  });
});
