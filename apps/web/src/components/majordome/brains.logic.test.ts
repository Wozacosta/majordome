import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  copyLabel,
  groupBrains,
  labelCopies,
  machineName,
  routinesMachine,
  runnerCopy,
} from "./brains.logic";

const mac = EnvironmentId.make("mac");
const vps = EnvironmentId.make("vps");

const copy = (
  environmentId: EnvironmentId,
  project: string,
  brainId: string | null | undefined,
  routinesRunner: "this-server" | "another-server" | "none" = "none",
) => ({
  environmentId,
  projectId: ProjectId.make(project),
  title: project,
  brainId,
  routinesRunner,
});

const names = new Map([[vps, "Always-on server"]]);
const machineOf = (environmentId: EnvironmentId) =>
  machineName(environmentId, { primaryEnvironmentId: mac, desktop: "mac", labels: names });

describe("groupBrains", () => {
  it("makes one brain of the copies sharing a root commit, the window's own server's copy first", () => {
    const brains = groupBrains(
      [
        copy(vps, "brain", "root-1"),
        copy(vps, "work", "root-2"),
        copy(mac, "brain", "root-1"),
        copy(mac, "old", undefined),
        copy(vps, "old", null),
      ],
      mac,
    );
    expect(
      brains.map((brain) =>
        brain.copies.map((member) => `${member.environmentId}/${member.projectId}`),
      ),
    ).toEqual([["mac/brain", "vps/brain"], ["vps/work"], ["mac/old"], ["vps/old"]]);
  });
});

describe("machineName", () => {
  it("calls the desktop app's own server this Mac, and others by their saved name", () => {
    const input = { primaryEnvironmentId: mac, labels: names };
    expect(machineName(mac, { ...input, desktop: "mac" })).toBe("This Mac");
    expect(machineName(mac, { ...input, desktop: "other" })).toBe("This computer");
    expect(machineName(vps, { ...input, desktop: "mac" })).toBe("Always-on server");
    expect(
      machineName(mac, { ...input, desktop: null, labels: new Map([[mac, " Studio "]]) }),
    ).toBe("Studio");
    expect(machineName(EnvironmentId.make("gone"), { ...input, desktop: null })).toBe(
      "Another computer",
    );
  });
});

describe("copyLabel", () => {
  it("names a copy by brain, machine or both, only when there is more than one", () => {
    const label = (machine: string | null, severalBrains: boolean) =>
      copyLabel({ title: "brain", machine, severalBrains });
    expect(label(null, false)).toBeNull();
    expect(label(null, true)).toBe("brain");
    expect(label("This Mac", false)).toBe("This Mac");
    expect(label("This Mac", true)).toBe("brain on this Mac");
    expect(label("Always-on server", true)).toBe("brain on Always-on server");
  });

  it("labels the copies of one brain on two servers by machine", () => {
    const brains = groupBrains([copy(vps, "brain", "root"), copy(mac, "brain", "root")], mac);
    expect(labelCopies(brains, machineOf).map(({ label }) => label)).toEqual([
      "This Mac",
      "Always-on server",
    ]);
  });
});

describe("routines", () => {
  it("names the server that runs a brain's routines when the brain is on several", () => {
    const [shared] = groupBrains(
      [copy(mac, "brain", "root", "another-server"), copy(vps, "brain", "root", "this-server")],
      mac,
    );
    expect(runnerCopy(shared!).environmentId).toBe(vps);
    expect(routinesMachine(shared!, machineOf)).toBe("Always-on server");

    const [alone] = groupBrains([copy(mac, "brain", "root", "this-server")], mac);
    expect(routinesMachine(alone!, machineOf)).toBeNull();

    const [offline] = groupBrains(
      [copy(mac, "brain", "root", "another-server"), copy(vps, "brain", "root", "another-server")],
      mac,
    );
    expect(runnerCopy(offline!).environmentId).toBe(mac);
    expect(routinesMachine(offline!, machineOf)).toBeNull();
  });
});
