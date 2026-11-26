import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { routinesClashes, serverLines, serverRows, type ServerRowInput } from "./servers.logic";

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

describe("routinesClashes", () => {
  const copy = (
    environmentId: typeof own,
    name: string,
    routinesRunner: "this-server" | "another-server" | undefined,
  ) => ({
    environmentId,
    projectId: ProjectId.make(`notes-${environmentId}`),
    name,
    routinesRunner,
  });

  it("names the notes folder that two computers both run the routines of", () => {
    const clashes = routinesClashes([
      {
        key: "brain",
        title: "Brain",
        copies: [
          copy(EnvironmentId.make("mac"), "This Mac", "another-server"),
          copy(own, "Your server", "this-server"),
          copy(hosted, "Majordome server", "this-server"),
        ],
      },
    ]);
    expect(clashes).toMatchObject([
      { title: "Brain", runners: [{ name: "Your server" }, { name: "Majordome server" }] },
    ]);
  });

  it("claims nothing while a copy has not answered, or with one runner", () => {
    expect(
      routinesClashes([
        {
          key: "brain",
          title: "Brain",
          copies: [
            copy(own, "Your server", "this-server"),
            copy(hosted, "Majordome server", undefined),
          ],
        },
      ]),
    ).toEqual([]);
  });
});
