/**
 * Firebase Cloud Messaging hook — currently a no-op stub.
 *
 * The real implementation lived here before we stripped @react-native-firebase
 * until google-services.json is provisioned. See docs/SITE_AUTO_DETECTION.md
 * for the push flow this hook will wire back up.
 *
 * To re-enable:
 *   1. Add @react-native-firebase/app + @react-native-firebase/messaging to
 *      package.json.
 *   2. Drop google-services.json into android/app/.
 *   3. Restore the original implementation from git history (permission
 *      request, onMessage, onNotificationOpenedApp, getInitialNotification,
 *      deep-link to SiteDetail on tap).
 */
import { NavigationContainerRef } from '@react-navigation/native';

export function useFCM(
  _navRef: React.RefObject<NavigationContainerRef<any>>,
): void {
  // No-op until Firebase is re-added.
}
