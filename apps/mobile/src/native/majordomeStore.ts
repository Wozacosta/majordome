import { requireOptionalNativeModule } from "expo";

import type { StoreProduct, StorePurchase } from "../majordome/serverPurchase.logic";

interface MajordomeStore {
  /** The subscription as the App Store sells it here; null where it sells none. */
  product(id: string): Promise<(StoreProduct & { readonly trialOpen: boolean }) | null>;
  /** Opens Apple's sheet. The token ties the purchase to the Majordome account. */
  buy(
    id: string,
    appAccountToken: string,
  ): Promise<
    | { readonly outcome: "purchased"; readonly purchase: StorePurchase }
    | { readonly outcome: "pending" | "cancelled"; readonly purchase: null }
  >;
  /** Purchases not yet marked delivered: the App Store hands them over until `finish`. */
  unfinished(): Promise<ReadonlyArray<StorePurchase>>;
  /** What the Apple account pays for now. `askAppStore` asks afresh, which may ask to sign in. */
  owned(askAppStore: boolean): Promise<ReadonlyArray<StorePurchase>>;
  finish(transactionId: string): Promise<void>;
  /** Opens Apple's sheet for seeing and cancelling the Apple account's subscriptions. */
  manage(): Promise<void>;
  addListener(event: "purchase", listener: (purchase: StorePurchase) => void): { remove(): void };
}

/** StoreKit, on an iPhone build that carries it; null everywhere else. */
export const majordomeStore = requireOptionalNativeModule<MajordomeStore>("MajordomeStore");
