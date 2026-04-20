#!/bin/bash
# ──────────────────────────────────────────────────────────────────────────────
# Starfleet Monitor — one-click Android launcher
#
# Double-click this from Finder. It will:
#   1. cd to the monorepo root (this script's directory).
#   2. Install JS deps with yarn (or npm) if node_modules is missing/stale.
#   3. Start Metro in a new Terminal tab on :8081.
#   4. Run react-native run-android to build + install + launch on the
#      currently connected emulator or device.
#
# Prereqs (must exist on the user's machine, NOT on Claude's sandbox):
#   - Node ≥ 18
#   - Android Studio with a running emulator or a device via adb
#   - $ANDROID_HOME / $ANDROID_SDK_ROOT pointing at the Android SDK
#   - Either yarn or npm on $PATH
# ──────────────────────────────────────────────────────────────────────────────
set -e

# cd to the directory containing this script (the monorepo root)
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

echo ""
echo "🚀  Starfleet Monitor — Android launcher"
echo "     Working dir: $SCRIPT_DIR"
echo ""

# ── Pick a package manager ────────────────────────────────────────────────────
if command -v yarn >/dev/null 2>&1; then
  PM="yarn"
  # --check-files makes yarn re-verify every file in node_modules against the
  # lock instead of trusting the `.yarn-integrity` shortcut. Needed because we
  # manually swap on-disk packages (e.g. downgrade react-native-svg).
  INSTALL_CMD="yarn install --check-files"
elif command -v npm >/dev/null 2>&1; then
  PM="npm"
  INSTALL_CMD="npm install --legacy-peer-deps"
else
  echo "❌ Neither yarn nor npm found on PATH. Install Node first."
  read -n 1 -s -r -p "Press any key to close."
  exit 1
fi
echo "📦  Using $PM"

# ── Drop stale react-native-svg so yarn reinstalls the pinned version ────────
# react-native-svg ≥ 15.3 calls super.setBorderRadius(view, int, Dynamic),
# but RN 0.74 only exposes the (view, int, float) overload — compile fails.
# packages/android/package.json pins 15.2.0 for RN 0.74 compatibility.
if [ -d "node_modules/react-native-svg" ]; then
  INSTALLED_SVG=$(node -p "try{require('./node_modules/react-native-svg/package.json').version}catch(e){''}" 2>/dev/null)
  if [ "$INSTALLED_SVG" != "15.2.0" ] && [ -n "$INSTALLED_SVG" ]; then
    echo "🧹  Removing stale react-native-svg@$INSTALLED_SVG (need 15.2.0 for RN 0.74)..."
    rm -rf node_modules/react-native-svg
    # Drop integrity file so yarn actually reinstalls.
    rm -f node_modules/.yarn-integrity
  fi
fi

# ── Install / sync deps ──────────────────────────────────────────────────────
echo "📥  Syncing JS dependencies ($PM install)..."
$INSTALL_CMD

# ── Sanity: Android SDK ───────────────────────────────────────────────────────
: "${ANDROID_HOME:=${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
export ANDROID_HOME
export PATH="$ANDROID_HOME/platform-tools:$PATH"
if ! command -v adb >/dev/null 2>&1; then
  echo "⚠️   adb not on PATH and $ANDROID_HOME/platform-tools/adb missing."
  echo "     Open Android Studio → Settings → Appearance & Behavior → System Settings → Android SDK"
  echo "     and ensure Platform-Tools is installed."
fi

# ── Try to auto-start an emulator if adb doesn't see one ─────────────────────
DEVICES=$(adb devices 2>/dev/null | awk 'NR>1 && $2=="device" {print $1}' | wc -l | xargs)
if [ "$DEVICES" = "0" ]; then
  echo "⚠️   No emulator or device detected by adb."
  EMULATOR_BIN="$ANDROID_HOME/emulator/emulator"
  if [ -x "$EMULATOR_BIN" ]; then
    AVD=$("$EMULATOR_BIN" -list-avds 2>/dev/null | head -n 1)
    if [ -n "$AVD" ]; then
      echo "🚀  Booting AVD '$AVD' in the background..."
      # Run detached so this script keeps going.
      ("$EMULATOR_BIN" -avd "$AVD" -no-snapshot-save >/tmp/starfleet-emulator.log 2>&1 &)
      # adb appears quickly, but a cold boot takes 60–120 seconds until the
      # device reports sys.boot_completed=1. Gradle's installDebug fails fast
      # if the device isn't fully booted, so we MUST wait here.
      echo "     Waiting for emulator to connect to adb..."
      adb wait-for-device
      echo "     Waiting for Android to finish booting (up to 3 min)..."
      BOOTED=""
      for i in $(seq 1 180); do
        BOOTED=$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')
        if [ "$BOOTED" = "1" ]; then
          echo "✅  Emulator fully booted after ${i}s."
          break
        fi
        sleep 1
      done
      if [ "$BOOTED" != "1" ]; then
        echo "⚠️   Emulator didn't finish booting in 180s — continuing anyway."
      fi
    else
      echo "     No AVDs found. Create one in Android Studio → Device Manager."
    fi
  else
    echo "     emulator binary not found at $EMULATOR_BIN"
    echo "     Start an emulator manually from Android Studio → Device Manager."
  fi
  echo "     (Gradle will wait up to its default timeout for a device to appear.)"
fi

# ── Kill any Metro on :8081 (may be a stale one from a different project) ────
# The bundle request includes the app ID but Metro serves JS from whatever
# project dir it was launched in. If a stale Metro is pointed at a different
# copy of the repo, you get cryptic 500s (e.g. "Cannot find module
# 'babel-plugin-module-resolver'"). Always reset 8081 before launching.
if lsof -nP -iTCP:8081 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "🛑  Killing stale process(es) on :8081..."
  lsof -nP -iTCP:8081 -sTCP:LISTEN -t | xargs kill -9 2>/dev/null || true
  # Wait for the port to actually free up
  for i in 1 2 3 4 5; do
    lsof -nP -iTCP:8081 -sTCP:LISTEN >/dev/null 2>&1 || break
    sleep 1
  done
fi

# ── Gradle clean guard ───────────────────────────────────────────────────────
# AGP 8.x / RN 0.74 bug: createDebugApkListingFileRedirect validates
# output-metadata.json as an @InputFile at configuration time, but the file
# only exists after a prior successful build. On a fresh checkout (or after
# a partial build), this causes a configuration-phase failure. Running
# `./gradlew clean` resets the build dir so Gradle sees a consistent state.
METADATA_FILE="$SCRIPT_DIR/packages/android/android/app/build/output-metadata.json"
if [ ! -f "$METADATA_FILE" ]; then
  echo "🧹  First build detected — running Gradle clean to avoid AGP listing-file error..."
  (cd "$SCRIPT_DIR/packages/android/android" && ./gradlew clean) || true
fi

# ── Start Metro in a new Terminal tab ────────────────────────────────────────
echo "🌀  Starting Metro bundler in a new Terminal window (from $SCRIPT_DIR/packages/android)..."
osascript <<OSA
tell application "Terminal"
  activate
  do script "cd \"$SCRIPT_DIR/packages/android\" && $PM start --reset-cache"
end tell
OSA
# Give Metro a moment to bind the port
sleep 4

# ── Build + install + launch ──────────────────────────────────────────────────
# --no-packager: Metro is already running (above), so skip the CLI's
# built-in prompt that asks "port 8081 is taken, use 8082 instead?"
# --active-arch-only: skip cross-compile for arm64 when the emulator is x86_64
echo ""
echo "🔨  Running yarn android (this triggers Gradle build)..."
cd packages/android
$PM android --no-packager --active-arch-only

echo ""
echo "🎉  Done. If the app launched on your emulator, you're good."
echo "     Press Ctrl+C in the Metro Terminal window to stop the dev server."
read -n 1 -s -r -p "Press any key to close this window."
echo ""
