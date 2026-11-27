# Majordome on Android

`scripts/majordome-android-apk.sh` builds the Android app from this checkout as a signed APK. It
runs on the owner's Mac, not in CI: the signing key is kept there.

```sh
vp run mobile:apk                       # builds release/Majordome.apk
vp run mobile:apk --release v1.2.3      # also attaches it to that GitHub Release
```

The version shown is the newest release tag. The number Android compares is the commit count, so
a later build always installs over an earlier one.

## What it needs on the Mac

Android Studio, for its JDK and the SDK (`~/Library/Android/sdk`), and
`~/.majordome/android.env`, which is never committed:

```sh
ANDROID_KEYSTORE="$HOME/.majordome/android/release.jks"
ANDROID_KEYSTORE_PASSWORD=...
ANDROID_KEY_ALIAS=majordome
CLERK_PUBLISHABLE_KEY=...   # the account service's public key
```

**The keystore is the app's identity.** Android refuses an update signed with another key, so
losing `release.jks` or its password means everyone reinstalls and pairs again. Keep a copy of
both somewhere that is not this Mac.

## What Android does not have yet

- The on-device voice (replies read aloud, talking with the assistant): the speech module is a
  placeholder (`apps/mobile/modules/majordome-speech/android`).
- Opening a `majord.link` address in the app. It needs the broker to serve
  `/.well-known/assetlinks.json` with the release key's SHA-256, and an intent filter in
  `apps/mobile/majordome/identity.ts`.
- A store listing. The APK is installed by hand.

## Buying a server

Google's billing only runs in an app installed from the Play Store, so the Android app sells
the server on Majordome's own page: it asks the broker for the account's Stripe checkout
(`/v1/billing/checkout`, `startedOn: "phone"`), opens it in a browser tab, and when the person
comes back asks the broker whether the payment is in before making the server
(`buyOnWeb` in `apps/mobile/src/majordome/hostedSignup.ts`). Google Pay shows on that page when
it is on in the Stripe account and the phone has a card. If the app is ever listed on the Play
Store, check Google's rules on outside payment first.

## Looking at a change

`vp run mobile:install android <serial>` builds and installs the development app
(`io.github.wozacosta.majordome.dev`). An emulator reaches Metro and a server on this Mac at
`10.0.2.2`. Give the emulator 4 GB of memory; with 2 GB it freezes while the app loads.
