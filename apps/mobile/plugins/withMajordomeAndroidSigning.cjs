const { withAppBuildGradle } = require("expo/config-plugins");

// Expo signs release builds with the debug key. A release for people is signed with Majordome's
// own key, named by the environment (scripts/majordome-android-apk.sh); without it the debug key
// stays, so a build still works on a machine that has no key.
const RELEASE_CONFIG = `        release {
            if (System.getenv("MAJORDOME_ANDROID_KEYSTORE")) {
                storeFile file(System.getenv("MAJORDOME_ANDROID_KEYSTORE"))
                storePassword System.getenv("MAJORDOME_ANDROID_KEYSTORE_PASSWORD")
                keyAlias System.getenv("MAJORDOME_ANDROID_KEY_ALIAS")
                keyPassword System.getenv("MAJORDOME_ANDROID_KEYSTORE_PASSWORD")
            }
        }
`;
const SIGNING_CONFIGS = /( {4}signingConfigs \{\n)/;
const RELEASE_USES_DEBUG = /(release \{[^}]*?signingConfig )signingConfigs\.debug/;

module.exports = function withMajordomeAndroidSigning(config) {
  return withAppBuildGradle(config, (config) => {
    const gradle = config.modResults.contents;
    if (!SIGNING_CONFIGS.test(gradle) || !RELEASE_USES_DEBUG.test(gradle)) {
      throw new Error(
        "withMajordomeAndroidSigning: app/build.gradle no longer has the signing blocks it edits.",
      );
    }
    config.modResults.contents = gradle
      .replace(SIGNING_CONFIGS, `$1${RELEASE_CONFIG}`)
      .replace(
        RELEASE_USES_DEBUG,
        '$1System.getenv("MAJORDOME_ANDROID_KEYSTORE") ? signingConfigs.release : signingConfigs.debug',
      );
    return config;
  });
};
