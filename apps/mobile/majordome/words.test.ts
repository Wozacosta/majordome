import * as NodeModule from "node:module";

import { describe, expect, it } from "vite-plus/test";

const { majordomeWords } = NodeModule.createRequire(import.meta.url)("./words.cjs") as {
  majordomeWords: (text: string) => string;
};

describe("majordomeWords", () => {
  it.each([
    ["Add an environment before creating a task.", "Add a computer before starting a chat."],
    [
      "Connect an environment to create a scheduled task.",
      "Connect a computer to create a routine.",
    ],
    [
      "Resume interrupted threads after an update or restart.",
      "Resume interrupted chats after an update or restart.",
    ],
    ["Keep awake while agents work", "Keep awake while the assistant works"],
    ["Show the answer when the agent finishes.", "Show the answer when the assistant finishes."],
    [
      "Update this provider on the environment's machine.",
      "Update this AI account on your computer.",
    ],
    ["Choose a project in this environment.", "Choose a notes folder in this computer."],
    ["{host} did not answer on any saved route.", "{host} did not answer on any saved address."],
    ["Waiting for approval on the host", "Waiting for approval on your computer"],
    ["Your edit is still in the composer.", "Your edit is still in the message box."],
    [
      "This environment's server does not support settling yet. Update the server to use Settle.",
      "Majordome on this computer does not support marking as done yet. Update it there to use Mark as done.",
    ],
  ])("says %j Majordome's way", (upstream, majordome) => {
    expect(majordomeWords(upstream)).toBe(majordome);
  });

  it("leaves a source control provider alone: it is a code host, not an AI account", () => {
    expect(majordomeWords("Source control providers · {environment}")).toBe(
      "Source control providers · {environment}",
    );
  });

  it("keeps placeholder names, which code fills in", () => {
    expect(majordomeWords("Failed to remove {project} from {environment}")).toBe(
      "Failed to remove {project} from {environment}",
    );
    expect(majordomeWords("Inherited from {environment}, the environment")).toBe(
      "Inherited from {environment}, your computer",
    );
  });

  it("rewords the texts of a plural and keeps its variable and keywords", () => {
    expect(
      majordomeWords(
        "{count, plural, one {{count} thread on {environment}} other {{count} threads}} in the project",
      ),
    ).toBe(
      "{count, plural, one {{count} chat on {environment}} other {{count} chats}} in the notes folder",
    );
  });

  it("keeps the cases of a select, which code picks by name", () => {
    expect(
      majordomeWords("{kind, select, thread {Open thread} project {Open project} other {Open}}"),
    ).toBe("{kind, select, thread {Open chat} project {Open notes folder} other {Open}}");
  });
});
