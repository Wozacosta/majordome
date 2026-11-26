import {
  ConciergeBellIcon,
  FileLockIcon,
  KeyRoundIcon,
  LaptopIcon,
  UserRoundIcon,
} from "lucide-react";

import { FlowDiagram } from "./FlowDiagram";

/** How a saved key reaches the assistant: kept on your computers, used but never read. */
export function SavedKeysDrawing() {
  return (
    <FlowDiagram
      className="mb-6"
      columns={[
        [{ id: "you", icon: KeyRoundIcon, title: "You save a key" }],
        [{ id: "kept", icon: LaptopIcon, title: "Kept on your computers" }],
        [{ id: "used", icon: ConciergeBellIcon, title: "The assistant uses it, never sees it" }],
      ]}
      lines={[
        { from: "you", to: "kept" },
        { from: "kept", to: "used" },
      ]}
      summary="You save a key. It is kept on your computers. The assistant uses it without ever seeing it."
    />
  );
}

/** How a private document is opened: the assistant asks, and only a yes opens it, each time. */
export function PrivateDocumentsDrawing() {
  return (
    <FlowDiagram
      columns={[
        [{ id: "asks", icon: ConciergeBellIcon, title: "The assistant asks for a document" }],
        [{ id: "you", icon: UserRoundIcon, title: "You say yes, each time" }],
        [{ id: "opens", icon: FileLockIcon, title: "It opens for that task only" }],
      ]}
      lines={[
        { from: "asks", to: "you" },
        { from: "you", to: "opens" },
      ]}
      summary="The assistant asks for a document. You say yes, each time. It then opens for that task only."
    />
  );
}
