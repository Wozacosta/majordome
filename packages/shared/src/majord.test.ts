import { describe, expect, it } from "vite-plus/test";

import {
  launchctlPrintPid,
  majordLaunchAgentPath,
  majordLaunchAgentProgram,
  majordLaunchctl,
  majordRepairFor,
  renderMajordLaunchAgent,
  type MajordLaunchAgent,
} from "./majord.ts";

const app = "/Applications/Majordome.app/Contents/MacOS/Majordome";
const agent: MajordLaunchAgent = {
  programArguments: [
    app,
    "/Applications/Majordome.app/Contents/Resources/app.asar/apps/server/dist/bin.mjs",
    "--bootstrap-fd",
    "0",
  ],
  environment: {
    T3CODE_HOME: "/Users/alice/.majordome",
    ELECTRON_RUN_AS_NODE: "1",
    PATH: "/usr/bin:/bin",
  },
  workingDirectory: "/Users/alice",
  bootstrapPath: "/Users/alice/.majordome/userdata/majord-bootstrap.json",
  logPath: "/Users/alice/.majordome/userdata/logs/majord.log",
};

describe("renderMajordLaunchAgent", () => {
  it("runs the bundled server as Node with its bootstrap on stdin and logs to majord.log", () => {
    const plist = renderMajordLaunchAgent(agent);
    expect(plist).toContain("<string>io.github.wozacosta.majordome.service</string>");
    expect(plist).toContain(
      "<key>StandardInPath</key>\n  <string>/Users/alice/.majordome/userdata/majord-bootstrap.json</string>",
    );
    expect(plist).toContain(
      "<key>StandardOutPath</key>\n  <string>/Users/alice/.majordome/userdata/logs/majord.log</string>",
    );
    expect(plist).toContain("<key>KeepAlive</key>\n  <true/>");
    expect(plist).toContain("<key>RunAtLoad</key>\n  <true/>");
    // T3 Code's tools read the agent's home this way.
    expect(plist).toContain("<key>T3CODE_HOME</key>\n    <string>/Users/alice/.majordome</string>");
    expect(majordLaunchAgentProgram(plist)).toBe(app);
  });

  it("renders the same text for the same agent, whatever the environment's key order", () => {
    const reordered = {
      ...agent,
      environment: {
        PATH: "/usr/bin:/bin",
        ELECTRON_RUN_AS_NODE: "1",
        T3CODE_HOME: "/Users/alice/.majordome",
      },
    };
    expect(renderMajordLaunchAgent(reordered)).toBe(renderMajordLaunchAgent(agent));
  });

  it("escapes XML in paths", () => {
    const plist = renderMajordLaunchAgent({
      ...agent,
      programArguments: ["/Volumes/R&D <tools>/Majordome.app/Contents/MacOS/Majordome"],
    });
    expect(plist).toContain("/Volumes/R&amp;D &lt;tools&gt;/Majordome.app");
    expect(majordLaunchAgentProgram(plist)).toBe(
      "/Volumes/R&D <tools>/Majordome.app/Contents/MacOS/Majordome",
    );
  });
});

describe("majordRepairFor", () => {
  const plist = renderMajordLaunchAgent(agent);
  const bootstrap = '{"mode":"desktop","port":3773}\n';
  const desired = { plist, bootstrap };

  it.each([
    ["nothing when it matches and runs", { plist, bootstrap }, true, "none"],
    ["a start when it matches but is not loaded", { plist, bootstrap }, false, "start"],
    ["a reload when it is not installed yet", {}, false, "reload"],
    [
      "a reload when the app moved",
      {
        plist: renderMajordLaunchAgent({
          ...agent,
          programArguments: ["/Users/alice/Downloads/Majordome.app/Contents/MacOS/Majordome"],
        }),
        bootstrap,
      },
      true,
      "reload",
    ],
    [
      "a reload when the app was updated",
      {
        plist: renderMajordLaunchAgent({
          ...agent,
          environment: { ...agent.environment, MAJORDOME_VERSION: "0.0.1" },
        }),
        bootstrap,
      },
      true,
      "reload",
    ],
    [
      "a reload when its settings changed",
      { plist, bootstrap: '{"mode":"desktop","port":3774}\n' },
      true,
      "reload",
    ],
  ] as const)("asks for %s", (_name, installed, loaded, repair) => {
    expect(majordRepairFor({ installed, desired, loaded })).toBe(repair);
  });
});

describe("launchctl", () => {
  it("targets this user's GUI domain", () => {
    const launchctl = majordLaunchctl(501);
    expect(launchctl.start(majordLaunchAgentPath("/Users/alice/"))).toEqual([
      "bootstrap",
      "gui/501",
      "/Users/alice/Library/LaunchAgents/io.github.wozacosta.majordome.service.plist",
    ]);
    expect(launchctl.stop).toEqual([
      "bootout",
      "--wait",
      "gui/501/io.github.wozacosta.majordome.service",
    ]);
  });

  it("reads the running pid, and none while launchd waits to restart it", () => {
    expect(launchctlPrintPid("gui/501/x = {\n\tstate = running\n\tpid = 4242\n}")).toBe(4242);
    expect(launchctlPrintPid("gui/501/x = {\n\tstate = waiting\n}")).toBeUndefined();
  });
});
