import { SymbolView as ExpoSymbolView } from "expo-symbols";
import { withUniwind } from "uniwind";

// The shared symbol component only takes the names upstream uses; topics wear others.
export const TopicSymbolView = withUniwind(ExpoSymbolView);
