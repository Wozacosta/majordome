import { useAuth, useClerk, useUser } from "@clerk/expo";
import { useAtomValue } from "@effect/atom-react";
import { readAccountServers } from "@t3tools/shared/majordomeAccount";
import { useNavigation } from "@react-navigation/native";
import { Image } from "expo-image";
import { type ReactNode, useState } from "react";
import { Platform, Pressable, View } from "react-native";

import { SymbolView } from "../components/ui/AppSymbol";
import { AppText as Text } from "../components/ui/AppText";
import { ListSection } from "../components/ui/ListSection";
import { hasAccountPublicConfig } from "../features/cloud/publicConfig";
import { useAppearancePreferences } from "../features/settings/appearance/AppearancePreferencesProvider";
import { openSettings } from "../features/settings/settings-navigation";
import { MAJORDOME_WELCOME, welcomeAccountRow } from "./connectWording";
import { serverOfferAtom } from "./serverOffer";

// Fixed for a build: whether it has Majordome accounts to sign in to.
const hasAccounts = hasAccountPublicConfig();

const MARK = {
  light: require("../../assets/majordome-splash-light.png"),
  dark: require("../../assets/majordome-splash-dark.png"),
};

/** One way to connect. */
function WayIn(props: {
  readonly icon: "person.crop.circle" | "qrcode.viewfinder" | "server.rack" | "desktopcomputer";
  /** The way most people take: drawn in the accent colour. */
  readonly main?: boolean;
  readonly title: string;
  readonly detail: string;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${props.title}. ${props.detail}`}
      onPress={props.onPress}
      className="flex-row items-center gap-4 px-4 py-3.5 active:opacity-70"
    >
      <SymbolView
        name={props.icon}
        size={24}
        tintColorClassName={props.main ? "accent-primary-text" : "accent-foreground"}
      />
      <View className="min-w-0 flex-1 gap-0.5">
        <Text
          className={props.main ? "font-t3-bold text-foreground" : "font-t3-medium text-foreground"}
        >
          {props.title}
        </Text>
        <Text textRole="footnote" className="text-foreground-muted">
          {props.detail}
        </Text>
      </View>
      <SymbolView
        name="chevron.right"
        size={14}
        tintColorClassName={props.main ? "accent-primary-text" : "accent-foreground-muted"}
      />
    </Pressable>
  );
}

const SEPARATOR = <View className="ml-[60px] h-px bg-border" />;

/** A few ways in under the sentence that says who they are for. */
function WaysGroup(props: { readonly title: string; readonly children: ReactNode }) {
  return (
    <View className="gap-2.5">
      <Text accessibilityRole="header" textRole="headline" className="px-1 font-t3-bold">
        {props.title}
      </Text>
      {props.children}
    </View>
  );
}

/**
 * The account's way in, above the code's. Rendered only in a build with accounts: the hooks need
 * its provider.
 */
function AccountWayIn(props: { readonly children: ReactNode }) {
  const navigation = useNavigation();
  const { isLoaded, isSignedIn } = useAuth({ treatPendingAsSignedOut: false });
  const { user } = useUser();
  const clerk = useClerk();
  // No account row until the sign-in is known, so nobody signed in sees "Sign in" flash by.
  if (!isLoaded) return <ListSection>{props.children}</ListSection>;
  const row = welcomeAccountRow({
    signedIn: isSignedIn,
    email: user?.primaryEmailAddress?.emailAddress ?? null,
    computers: readAccountServers(user?.unsafeMetadata, { allowThisMachine: __DEV__ }).map(
      (server) => server.name,
    ),
  });
  const wayIn = (
    <WayIn
      main={row.main}
      icon="person.crop.circle"
      title={row.title}
      detail={row.detail}
      onPress={() => openSettings(navigation, "SettingsAccount")}
    />
  );
  const ways = row.main ? (
    <>
      <View className="overflow-hidden rounded-[26px] border border-primary/40 border-continuous bg-primary/10">
        {wayIn}
      </View>
      <ListSection>{props.children}</ListSection>
    </>
  ) : (
    <ListSection>
      {wayIn}
      {SEPARATOR}
      {props.children}
    </ListSection>
  );
  if (!isSignedIn) return ways;
  return (
    <>
      {ways}
      {/* This screen is a phone with no computer: there is nothing to forget but the sign-in. */}
      <Pressable
        accessibilityRole="button"
        className="min-h-[44px] justify-center self-start px-1 active:opacity-70"
        onPress={() => void clerk.signOut()}
      >
        <Text className="font-t3-medium text-primary-text">{MAJORDOME_WELCOME.signOut}</Text>
      </Pressable>
    </>
  );
}

/** The ways in for someone with no Majordome yet, folded until asked for. */
function NewHere(props: { readonly children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <View className="gap-2.5">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        className="min-h-[44px] flex-row items-center justify-center gap-2 active:opacity-70"
        onPress={() => setOpen(!open)}
      >
        <Text textRole="headline" className="font-t3-medium text-foreground-muted">
          {MAJORDOME_WELCOME.newHere}
        </Text>
        <SymbolView
          name={open ? "chevron.up" : "chevron.down"}
          size={14}
          tintColorClassName="accent-foreground-muted"
        />
      </Pressable>
      {open ? props.children : null}
    </View>
  );
}

// The site's heading face, which iOS carries; Android has no match and falls back to its serif.
const SERIF = Platform.select({ ios: "Iowan Old Style", default: "serif" });

/** What a phone with no computer opens on: what Majordome is, in the site's voice, and the ways to connect it. */
export function MajordomeWelcome() {
  const navigation = useNavigation();
  const { themeAppearance } = useAppearancePreferences();
  const serverOffer = useAtomValue(serverOfferAtom);
  const scan = (
    <WayIn
      icon="qrcode.viewfinder"
      title={MAJORDOME_WELCOME.scan}
      detail={MAJORDOME_WELCOME.scanDetail}
      onPress={() => openSettings(navigation, "SettingsEnvironmentNew")}
    />
  );
  return (
    <View className="gap-8 pt-4">
      <View className="flex-row items-center gap-2">
        <Image
          accessibilityIgnoresInvertColors
          source={MARK[themeAppearance]}
          style={{ width: 40, height: 40 }}
        />
        <Text textRole="headline" className="font-t3-bold">
          Majordome
        </Text>
      </View>
      <View className="gap-5">
        <View accessible accessibilityRole="header" accessibilityLabel={MAJORDOME_WELCOME.spoken}>
          <Text className="text-[42px] leading-[46px]" style={{ fontFamily: SERIF }}>
            {MAJORDOME_WELCOME.headline}
          </Text>
          <View className="self-start">
            <View className="absolute inset-x-0 bottom-[5px] h-[16px] rounded-[4px] bg-[#3ddc8466]" />
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              className="text-[42px] leading-[46px]"
              style={{ fontFamily: SERIF, fontStyle: "italic" }}
            >
              {MAJORDOME_WELCOME.headlineEnd}
            </Text>
          </View>
        </View>
        <Text textRole="headline" className="leading-relaxed text-foreground-muted">
          {MAJORDOME_WELCOME.what}
        </Text>
      </View>
      <View className="gap-6">
        <WaysGroup title={MAJORDOME_WELCOME.returning}>
          {hasAccounts ? <AccountWayIn>{scan}</AccountWayIn> : <ListSection>{scan}</ListSection>}
        </WaysGroup>
        <NewHere>
          <ListSection>
            <WayIn
              icon="desktopcomputer"
              title={MAJORDOME_WELCOME.computer}
              detail={MAJORDOME_WELCOME.computerDetail}
              onPress={() => openSettings(navigation, "SettingsUseComputer")}
            />
            {serverOffer === null ? null : (
              <>
                {SEPARATOR}
                <WayIn
                  icon="server.rack"
                  title={MAJORDOME_WELCOME.server}
                  detail={MAJORDOME_WELCOME.serverDetail}
                  onPress={() => openSettings(navigation, "SettingsHostedSignup")}
                />
              </>
            )}
          </ListSection>
        </NewHere>
      </View>
    </View>
  );
}
