/**
 * The Skills screen's side of a vault's skills: what the assistant uses, what it wrote for itself
 * and waits for the owner to keep, and the owner's yes or no. See `vaultSkills.ts`.
 */

import {
  type MajordomeKeepSkillInput,
  type MajordomeRemoveSkillInput,
  MajordomeSkillsError,
  type MajordomeSkillsInput,
  type MajordomeSkillsResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import type * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import { readVaultLayout } from "./vaultConfig.ts";
import * as VaultLock from "./VaultLock.ts";
import { keepProposedSkill, readVaultSkills, removeSkill } from "./vaultSkills.ts";

export class MajordomeSkills extends Context.Service<
  MajordomeSkills,
  {
    readonly list: (
      input: MajordomeSkillsInput,
    ) => Effect.Effect<MajordomeSkillsResult, MajordomeSkillsError>;
    /** Puts a skill the assistant wrote into use, replacing one of the same name. */
    readonly keep: (input: MajordomeKeepSkillInput) => Effect.Effect<void, MajordomeSkillsError>;
    /** Stops using a skill, which then waits to be kept again, or deletes one that waits. */
    readonly remove: (
      input: MajordomeRemoveSkillInput,
    ) => Effect.Effect<void, MajordomeSkillsError>;
  }
>()("t3/majordome/MajordomeSkills") {}

type VaultServices = FileSystem.FileSystem | Path.Path | GitVcsDriver.GitVcsDriver;

const isSkillsError = Schema.is(MajordomeSkillsError);
const GONE = "That skill is no longer there. Refresh and try again.";

const make = Effect.gen(function* () {
  const projects = yield* ProjectStore.ProjectStoreV2;
  const vaultLock = yield* VaultLock.VaultLock;
  const services = yield* Effect.context<VaultServices>();

  const vaultRootOf = Effect.fn("MajordomeSkills.vaultRootOf")(function* (
    projectId: MajordomeSkillsInput["projectId"],
  ) {
    const project = Option.getOrUndefined(yield* projects.get(projectId));
    if (project === undefined) return undefined;
    const layout = yield* readVaultLayout(project.workspaceRoot);
    return Option.isSome(layout) ? project.workspaceRoot : undefined;
  });

  /** Runs one decision under the vault's lock, failing when it found nothing to act on. */
  const decide = Effect.fn("MajordomeSkills.decide")(
    function* <E>(
      projectId: MajordomeSkillsInput["projectId"],
      act: (vaultRoot: string) => Effect.Effect<boolean, E, VaultServices>,
    ) {
      const vaultRoot = yield* vaultRootOf(projectId);
      if (vaultRoot === undefined) {
        return yield* new MajordomeSkillsError({ message: "That notes folder was not found." });
      }
      const done = yield* vaultLock.withLock(vaultRoot, act(vaultRoot));
      if (!done) return yield* new MajordomeSkillsError({ message: GONE });
    },
    Effect.provide(services),
    Effect.mapError((cause) =>
      isSkillsError(cause)
        ? cause
        : new MajordomeSkillsError({ message: "Could not change that skill.", cause }),
    ),
  );

  const list: MajordomeSkills["Service"]["list"] = Effect.fn("MajordomeSkills.list")(
    function* (input) {
      const vaultRoot = yield* vaultRootOf(input.projectId);
      if (vaultRoot === undefined) return { isVault: false, proposed: [], skills: [] };
      return { isVault: true, ...(yield* readVaultSkills(vaultRoot)) };
    },
    Effect.provide(services),
    Effect.mapError(
      (cause) => new MajordomeSkillsError({ message: "Could not read the skills.", cause }),
    ),
  );

  const keep: MajordomeSkills["Service"]["keep"] = Effect.fn("MajordomeSkills.keep")((input) =>
    decide(input.projectId, (vaultRoot) => keepProposedSkill({ vaultRoot, name: input.name })),
  );

  const remove: MajordomeSkills["Service"]["remove"] = Effect.fn("MajordomeSkills.remove")(
    (input) =>
      decide(input.projectId, (vaultRoot) =>
        removeSkill({ vaultRoot, name: input.name, proposed: input.proposed }),
      ),
  );

  return MajordomeSkills.of({ list, keep, remove });
});

export const layer = Layer.effect(MajordomeSkills, make);
