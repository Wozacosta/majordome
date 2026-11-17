import type { ScreenContextRecord } from "@t3tools/contracts";
import { createContext } from "react";

/**
 * Set where a conversation sits beside a screen of the app: reads, at send time, the screen the
 * person is on. Null everywhere else, so no other conversation says where the person is.
 */
export const ScreenContextReader = createContext<(() => ScreenContextRecord | null) | null>(null);
