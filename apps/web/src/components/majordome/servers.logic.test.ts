import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { serverLines, serverRows, type ServerRowInput } from "./servers.logic";

const own = EnvironmentId.make("own");
const hosted = EnvironmentId.make("hosted");

const server = (patch: Partial<ServerRowInput> & Pick<ServerRowInput, "environmentId">) => ({
  name: "Your server",
  address: "https://own.example",
  phase: "connected",
  isThisWindow: false,
  signedIn: true,
  ...patch,
});

describe("serverRows", () => {
  it("lists every server, the one that runs the routines first", () => {
    const rows = serverRows({
      servers: [
        server({ environmentId: own }),
        server({ environmentId: hosted, name: "Majordome server" }),
      ],
      copies: [
        { environmentId: own, routinesRunner: "another-server", isVault: true },
        { environmentId: hosted, routinesRunner: "this-server", isVault: true },
      ],
    });
    expect(rows.map((row) => [row.name, row.hosted, row.runsRoutines])).toEqual([
      ["Majordome server", true, true],
      ["Your server", false, false],
    ]);
    expect(rows.map((row) => serverLines(row).map((line) => line.text))).toEqual([
      ["Has a copy of your notes and runs your routines."],
      ["Has a copy of your notes."],
    ]);
  });

  it("says a connected server holds none of the notes only once it has answered", () => {
    const [empty] = serverRows({ servers: [server({ environmentId: own })], copies: [] });
    expect(serverLines(empty!).map((line) => line.text)).toEqual([
      "Connected. None of your notes are on it.",
    ]);
    const [loading] = serverRows({
      servers: [server({ environmentId: own })],
      copies: [{ environmentId: own, routinesRunner: undefined, isVault: undefined }],
    });
    expect(serverLines(loading!).map((line) => line.text)).toEqual(["Connected."]);
  });

  it("says when a server has no AI account, and nothing about one it cannot reach", () => {
    const [signedOut, away] = serverRows({
      servers: [
        server({ environmentId: own, signedIn: false }),
        server({ environmentId: hosted, phase: "offline", signedIn: false }),
      ],
      copies: [{ environmentId: own, routinesRunner: null, isVault: true }],
    });
    expect(serverLines(signedOut!).at(-1)).toMatchObject({ tone: "warning", signIn: true });
    expect(serverLines(away!)).toEqual([
      { tone: "warning", text: "This app can't reach it right now." },
    ]);
  });
});
