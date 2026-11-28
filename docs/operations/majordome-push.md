# Notifications for the phone apps

The iPhone and Android apps get notifications from each person's own computer or server, through
the address broker (`infra/broker`, "Phone notifications"). The code is in place; these are the
steps only the owner can do. Until they are done, every phone's Notifications page says "Your
computer can't send them yet" and nothing else changes.

The two halves are independent: iPhones work once steps 1 to 3 are done, Android once 4 to 7 are.
Keep every file named here out of the repository.

## iPhone

1. **Check the app's identifier has Push Notifications.** In the developer portal, Certificates,
   Identifiers & Profiles > Identifiers > `io.github.wozacosta.majordome.ios` > Push
   Notifications is ticked. The app has asked for the push entitlement since its first build
   (upstream's `expo-notifications` plugin adds `aps-environment`), so the profiles named in
   [majordome-testflight.md](./majordome-testflight.md) should already carry it. If the box was
   not ticked, tick it and make the two App Store profiles again under the same names.
2. **Make the push key.** Keys > "+" > Apple Push Notifications service (APNs). Choose both
   Sandbox and Production if the portal asks. Download `AuthKey_XXXXXXXXXX.p8` once (Apple gives
   it once) and note the key id. This is not the In-App Purchase key the broker already has.
3. **Give it to the broker**, from `infra/broker`:

   ```sh
   pnpm dlx wrangler secret put APNS_KEY --config wrangler.deploy.jsonc < AuthKey_XXXXXXXXXX.p8
   ```

   and in `wrangler.deploy.jsonc` set `APNS_KEY_ID` to the key's id. `APNS_TEAM_ID` is already
   the team.

No new build of the iPhone app is needed for the key. A build with the Notifications page is.

## Android

4. **Make a Firebase project** at <https://console.firebase.google.com> (no Analytics needed) and
   add an Android app for each package that will be built: `io.github.wozacosta.majordome`, and
   `io.github.wozacosta.majordome.dev` if the development app should get notifications too.
5. **Download `google-services.json`** from the project's settings (one file covers every package
   added) and keep it at `~/.majordome/android/google-services.json`. Add to
   `~/.majordome/android.env`:

   ```sh
   ANDROID_GOOGLE_SERVICES_FILE="$HOME/.majordome/android/google-services.json"
   ```

   `vp run mobile:apk` then builds it in. For a development install, export
   `T3CODE_ANDROID_GOOGLE_SERVICES_FILE` with the same path before `vp run mobile:install android`.

6. **Make a service account key.** Project settings > Service accounts > Generate new private
   key. It needs only Firebase Cloud Messaging; the default Firebase Admin SDK account has it.
7. **Give it to the broker**, from `infra/broker`:

   ```sh
   pnpm dlx wrangler secret put FCM_SERVICE_ACCOUNT --config wrangler.deploy.jsonc < service-account.json
   ```

   Then delete the downloaded file, or keep it where the signing key's copy is kept.

## Both

8. **Apply the migration and deploy the broker**, from `infra/broker`:

   ```sh
   pnpm dlx wrangler d1 migrations apply majord-broker --remote --config wrangler.deploy.jsonc
   pnpm dlx wrangler deploy --config wrangler.deploy.jsonc
   curl https://broker.majord.link/v1/push   # {"ios":true,"android":true}
   ```

9. **Release Majordome** so computers and hosted servers know how to send (hosted servers take
   the release the following night), then build both apps: `vp run mobile:testflight` and
   `vp run mobile:apk`.
10. **Try it.** On the phone: Settings > Notifications, turn the switch on, **Send a test**. The
    phone then shows in **Settings > Phone & notifications** on the computer.

## When a test does not arrive

- The phone's page says "Your computer can't send them yet": the computer is on an older
  version, or `curl https://broker.majord.link/v1/push` says `false` for that kind of phone. A
  computer remembers the broker's answer for ten minutes.
- "The test couldn't be sent" on the phone: look at the Worker's logs for "A notification was
  refused" with Apple's or Google's status and reason. `403 InvalidProviderToken` is a wrong key
  id or team id; `403 PERMISSION_DENIED` is a service account from another project.
- A development build of the iPhone app uses Apple's sandbox service and says so itself; a
  TestFlight or App Store build uses production. A token sent to the wrong one comes back as
  gone, and the computer forgets the phone until the app is opened again.
- A computer whose organization's policy turns outside connections off (`limits.connect`) sends
  no notification to a phone app.
