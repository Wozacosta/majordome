import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as PullRequestCacheStore from "../connection/pull-request-cache-store";
import * as EnvironmentCacheStore from "../connection/environment-cache-store";
import { leftoverComputersCleared } from "../majordome/freshInstall";
import * as MobileDatabase from "./mobile-database";
import * as MobilePreferences from "./mobile-preferences";
import * as MobileSecureStorage from "./mobile-secure-storage";
import * as MobileStorage from "./mobile-storage";

// Nothing reads the keychain before a new install has dropped what a deleted copy left there.
const layerSecureStorage = Layer.unwrap(
  Effect.promise(() => leftoverComputersCleared).pipe(Effect.as(MobileSecureStorage.layer)),
);
const layerBase = Layer.merge(MobileDatabase.layer, layerSecureStorage);
const layerDependent = Layer.mergeAll(
  MobilePreferences.layer,
  MobileStorage.layer,
  EnvironmentCacheStore.layer,
  PullRequestCacheStore.layer,
).pipe(Layer.provide(layerBase));

export const layer = Layer.merge(layerBase, layerDependent);
