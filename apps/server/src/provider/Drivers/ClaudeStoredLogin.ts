import type { ClaudeSettings, ProviderInstanceEnvironment } from "@t3tools/contracts";
import { spawnAndCollect } from "@t3tools/provider-core/server/snapshotProbe";
import { expandHomePath } from "@t3tools/provider-core/server/pathExpansion";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { ChildProcess } from "effect/process";

import { CLAUDE_SIGN_IN_TOKEN_VARIABLE } from "../claudeSignInOutput.ts";
import { makeClaudeEnvironment, mergeClaudeProcessEnvironment } from "./ClaudeHome.ts";

const STATUS_TIMEOUT = "8 seconds";

const decodeAuthStatus = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ loggedIn: Schema.Boolean, authMethod: Schema.String })),
);

/** Whether `claude auth status --json` describes a full claude.ai sign-in kept on this machine. */
function isStoredClaudeAiLogin(statusJson: string): boolean {
  return Option.match(decodeAuthStatus(statusJson.trim()), {
    onNone: () => false,
    onSome: (status) => status.loggedIn && status.authMethod === "claude.ai",
  });
}

export function withoutClaudeSignInToken(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const next = { ...environment };
  for (const name of Object.keys(next)) {
    if (name.toUpperCase() === CLAUDE_SIGN_IN_TOKEN_VARIABLE) delete next[name];
  }
  return next;
}

/**
 * A sign-in token in the server's own environment (a Docker `.env`) outranks a full sign-in
 * stored on the machine, and nothing here can unset it for good. So Claude is asked, without the
 * token, whether a full sign-in is stored; when one is, this provider runs without the token.
 * A token the provider's own settings carry is the owner's explicit choice and is left alone.
 */
export const resolveClaudeHostSignInToken = Effect.fn("ClaudeStoredLogin.resolveHostSignInToken")(
  function* (input: {
    readonly config: Pick<ClaudeSettings, "binaryPath" | "homePath">;
    readonly instanceEnvironment: ProviderInstanceEnvironment | undefined;
    readonly hostEnvironment: NodeJS.ProcessEnv;
    readonly cwd: string;
  }) {
    const kept = { environment: input.hostEnvironment } as const;
    const inherited = Object.entries(input.hostEnvironment).some(
      ([name, value]) =>
        name.toUpperCase() === CLAUDE_SIGN_IN_TOKEN_VARIABLE && Boolean(value?.trim()),
    );
    const configured = input.instanceEnvironment?.some(
      (variable) => variable.name.toUpperCase() === CLAUDE_SIGN_IN_TOKEN_VARIABLE,
    );
    if (!inherited || configured) return { ...kept, signInToken: "none" as const };

    const environment = withoutClaudeSignInToken(input.hostEnvironment);
    const claudeEnvironment = yield* makeClaudeEnvironment(
      input.config,
      yield* mergeClaudeProcessEnvironment(input.config, input.instanceEnvironment, environment),
    );
    const binaryPath = expandHomePath(input.config.binaryPath, yield* HostProcess.HomeDirectory);
    const spawnCommand = yield* resolveSpawnCommand(binaryPath, ["auth", "status", "--json"], {
      env: claudeEnvironment,
    });
    // Signed out, the command exits 1 and still prints its status.
    const stored = yield* spawnAndCollect(
      binaryPath,
      ChildProcess.make(spawnCommand.command, spawnCommand.args, {
        env: claudeEnvironment,
        shell: spawnCommand.shell,
        cwd: input.cwd,
      }),
    ).pipe(
      Effect.map((result) => isStoredClaudeAiLogin(result.stdout)),
      Effect.timeoutOption(STATUS_TIMEOUT),
      Effect.map(Option.getOrElse(() => false)),
      Effect.orElseSucceed(() => false),
    );
    return stored
      ? { environment, signInToken: "ignored" as const }
      : { ...kept, signInToken: "used" as const };
  },
);
