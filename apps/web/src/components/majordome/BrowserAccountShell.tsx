import { ClerkProvider } from "@clerk/react";
import type { ReactNode } from "react";

import { clerkAppearance } from "../clerk/clerkAppearance";

/** Majordome accounts in a browser: sign-in only, with none of T3 Connect's relay. */
export default function BrowserAccountShell({
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
