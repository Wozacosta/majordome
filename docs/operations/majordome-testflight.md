# Majordome on TestFlight

`scripts/majordome-testflight.sh` builds the iPhone app from this checkout and uploads it to
TestFlight. It runs on the owner's Mac, not in CI: signing uses a certificate kept there.

```sh
vp run mobile:testflight                         # the same as the first line below
scripts/majordome-testflight.sh                  # prebuild, archive, upload
scripts/majordome-testflight.sh --skip-prebuild  # reuse apps/mobile/ios as it is
```

It picks the build number itself, one past the newest build in App Store Connect. Apple takes
a few minutes to process an upload; internal testers then see it in the TestFlight app.

## What it needs on the Mac

`~/.majordome/testflight.env`, which is never committed:

```sh
ASC_KEY_ID=...            # an App Store Connect API key with the App Manager role
ASC_ISSUER_ID=...         # Users and Access > Integrations, above the key list
ASC_KEY_PATH="$HOME/.appstoreconnect/private_keys/AuthKey_<id>.p8"
ASC_APP_ID=...            # the app's id in App Store Connect
CLERK_PUBLISHABLE_KEY=... # the account service's public key
DIST_KEYCHAIN="$HOME/Library/Keychains/majordome-dist.keychain-db"
DIST_KEYCHAIN_PASSWORD_ITEM=majordome-dist-keychain-password
```

Signing is manual because Apple refuses cloud signing to API keys below Admin:

- An **Apple Distribution** certificate with its private key in `DIST_KEYCHAIN`, a keychain of
  its own so `codesign` never prompts. Its password is a generic password in the login
  keychain, named by `DIST_KEYCHAIN_PASSWORD_ITEM`. A keychain locks at restart; the script
  unlocks it.
- Two **App Store** provisioning profiles, named `Majordome App Store ios` and `sharing`,
  for the app and its share extension. Upstream's widgets are left out of Majordome's build
  (`apps/mobile/majordome/identity.ts`), so they need none. The profiles expire with the
  certificate, after a year: make new ones in the developer portal, or with
  `POST /v1/profiles`, under the same names.

## Traps

- The build must name the production account service (`CLERK_PUBLISHABLE_KEY`). A build made
  with a development key signs in to the wrong service and lists no servers.
- `expo run:ios --device` wants the phone's hardware identifier from
  `xcrun xctrace list devices`, not the one `devicectl` prints.
- The store listing is "Majordome: Your Second Brain": plain "Majordome" is taken. The name
  under the icon comes from the app, and stays Majordome.
