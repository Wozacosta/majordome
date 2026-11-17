import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { SquarePenIcon } from "lucide-react";

import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { useMajordomeVaults } from "./useMajordomeVaults";

/** The sidebar's way into an empty conversation in the notes folder being shown. */
export function NewChatRow({ onOpen }: { readonly onOpen: () => void }) {
  const { activeVault } = useMajordomeVaults();
  const handleNewThread = useNewThreadHandler();
  if (activeVault === null) return null;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        onClick={() => {
          onOpen();
          void handleNewThread(scopeProjectRef(activeVault.environmentId, activeVault.projectId));
        }}
      >
        <SquarePenIcon />
        <span className="min-w-0 flex-1 truncate font-medium text-sidebar-foreground">
          New chat
        </span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
