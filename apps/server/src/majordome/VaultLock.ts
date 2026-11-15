/** One git operation at a time per vault: run commits and undos share it, keyed by the vault's folder. */

import * as KeyedLock from "@t3tools/shared/KeyedLock";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";

export class VaultLock extends Context.Service<VaultLock, KeyedLock.KeyedLock<string>>()(
  "t3/majordome/VaultLock",
) {}

export const layer = Layer.effect(VaultLock, KeyedLock.make<string>());
