import { useAuth, useClerk, useUser } from "@clerk/react";
import { useNavigate } from "@tanstack/react-router";
import { CircleUserRoundIcon } from "lucide-react";
import { useEffect } from "react";

import { SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { markSignInAsked, useAddServersAfterSignIn } from "./accountLink";

/**
 * The sidebar's way in to a Majordome account: "Sign in" while signed out, then the account
 * page. Loaded lazily and only by a build with an account service, so it never weighs on a
 * start without one.
 */
export default function AccountSidebarItem({ rail = false }: { readonly rail?: boolean }) {
  const { isLoaded, isSignedIn } = useAuth();
  const clerk = useClerk();
  const { user } = useUser();
  const navigate = useNavigate();
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the sign-in window belongs to the account service, which leaves it open after a sign-in that returns from the browser
  useEffect(() => {
    if (isSignedIn) clerk.closeSignIn();
  }, [isSignedIn, clerk]);

  // A sign-in ends on the account page, which shows each computer and what to do next.
  useAddServersAfterSignIn(() => void navigate({ to: "/settings/account" }));

  if (!isLoaded) return null;
  const tooltipSide = rail ? "right" : "top";
  const signIn = () => {
    markSignInAsked();
    clerk.openSignIn();
  };
  if (!isSignedIn && rail) {
    return (
      <SidebarMenuItem className="shrink-0">
        <Tooltip>
          <TooltipTrigger
            render={
              <SidebarMenuButton aria-label="Sign in" size="icon" onClick={signIn}>
                <CircleUserRoundIcon />
              </SidebarMenuButton>
            }
          />
          <TooltipPopup side="right">Sign in</TooltipPopup>
        </Tooltip>
      </SidebarMenuItem>
    );
  }
  if (!isSignedIn) {
    return (
      <SidebarMenuItem className="shrink-0">
        <SidebarMenuButton onClick={signIn}>
          <CircleUserRoundIcon />
          <span>Sign in</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }
  const email = user?.primaryEmailAddress?.emailAddress ?? null;
  const initial = (user?.firstName ?? email ?? "•").trim().charAt(0);
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
              {/* Signed in, the button carries the account's initial, so it never reads as "Sign in". */}
              <span
                aria-hidden
                className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-2xs font-semibold text-primary-foreground uppercase"
              >
                {initial}
              </span>
            </SidebarMenuButton>
          }
        />
        <TooltipPopup side={tooltipSide}>{email ?? "Your account"}</TooltipPopup>
      </Tooltip>
    </SidebarMenuItem>
  );
}
