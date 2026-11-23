import { ClerkProvider } from "@clerk/electron/react";
import type { ReactNode } from "react";

import { clerkAppearance } from "../clerk/clerkAppearance";

/** Majordome accounts in the desktop app: sign-in only, with none of T3 Connect's relay. */
export default function ElectronAccountShell({
  publishableKey,
  children,
}: {
  readonly publishableKey: string;
  readonly children: ReactNode;
}) {
  return (
    <ClerkProvider appearance={clerkAppearance} publishableKey={publishableKey}>
      {children}
    </ClerkProvider>
  );
}
