# Starfleet Android Native Project

This directory is the Android native project for the canonical React Native app
in `packages/mobile`. It is not a separate app surface and should not carry a
second copy of the product documentation.

Use the canonical mobile README for screens, architecture, API behavior, and
developer commands:

```text
packages/mobile/README.md
```

Android-specific notes:

| File | Purpose |
|---|---|
| `app/build.gradle` | Android app build configuration |
| `settings.gradle` | React Native/Gradle project settings |
| `local.properties` | Local Android SDK path, machine-specific |
| `run-android.command` | Convenience launcher for local Android runs |
| `app/debug.keystore` | Development signing key |

Push notifications are currently disabled in the React Native entry point. To
enable Firebase Cloud Messaging, install the React Native Firebase packages and
add `google-services.json` under `android/app/`.
