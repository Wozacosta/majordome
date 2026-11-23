import { useAuth, useClerk } from "@clerk/react";
import { useNavigate } from "@tanstack/react-router";
import { CircleUserRoundIcon } from "lucide-react";
import { useAtomValue } from "@effect/atom-react";
import { useEffect, useRef } from "react";

import { environmentCatalog } from "../../connection/catalog";

import { SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { addConnectedServersToAccount } from "./accountLink";
import { useMachineNames } from "./useMachineNames";

/**
 * The sidebar's way in to a Majordome account: "Sign in" while signed out, then the account
 * page. Loaded lazily and only by a build with an account service, so it never weighs on a
 * start without one.
 */
export default function AccountSidebarItem() {
  const { isLoaded, isSignedIn } = useAuth();
  const clerk = useClerk();
  const navigate = useNavigate();
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the sign-in window belongs to the account service, which leaves it open after a sign-in that returns from the browser
  useEffect(() => {
    if (isSignedIn) clerk.closeSignIn();
  }, [isSignedIn, clerk]);

  const catalog = useAtomValue(environmentCatalog.catalogValueAtom);
  const { machineOf } = useMachineNames();
  // Only a sign-in made here adds servers: a window that opens already signed in, or a server
  // the owner removed from the account, is left alone.
  const signedOutHere = useRef(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the account service reports a finished sign-in only through its own store, and the servers are added once when it does
  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      signedOutHere.current = true;
      return;
    }
    if (!signedOutHere.current) return;
    signedOutHere.current = false;
    void addConnectedServersToAccount(
      clerk,
      Array.from(catalog.entries.keys(), (environmentId) => ({
        environmentId,
        name: machineOf(environmentId),
      })),
    );
  }, [isLoaded, isSignedIn, clerk, catalog, machineOf]);

  if (!isLoaded) return null;
  if (!isSignedIn) {
    return (
      <SidebarMenuItem className="shrink-0">
        <SidebarMenuButton onClick={() => clerk.openSignIn()}>
          <CircleUserRoundIcon />
          <span>Sign in</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }
  return (
    <SidebarMenuItem className="shrink-0">
      <Tooltip>
        <TooltipTrigger
          render={
            <SidebarMenuButton
              aria-label="Your account"
              size="icon"
              onClick={() => void navigate({ to: "/settings/account" })}
            >
              <CircleUserRoundIcon />
            </SidebarMenuButton>
          }
        />
        <TooltipPopup side="top">Your account</TooltipPopup>
      </Tooltip>
    </SidebarMenuItem>
  );
}
