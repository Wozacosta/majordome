import { Atom } from "effect/reactivity";

import type { ServerOffer } from "./serverPurchase.logic";

/**
 * What the App Store sells the server for; null where it sells none, which hides every way to
 * buy. Kept apart from the purchase code so a screen that only reads it loads no store module.
 */
export const serverOfferAtom = Atom.make<ServerOffer | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("majordome:server-offer"),
);
