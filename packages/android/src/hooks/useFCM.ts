/**
 * Firebase Cloud Messaging hook.
 * - Requests notification permission on first launch.
 * - Listens for foreground messages and dark-site notifications.
 * - Handles notification taps (background / killed state) to deep-link to a site.
 */
import { useEffect } from 'react';
import messaging from '@react-native-firebase/messaging';
import { NavigationContainerRef } from '@react-navigation/native';

export function useFCM(
  navRef: React.RefObject<NavigationContainerRef<any>>,
): void {
  useEffect(() => {
    // 1. Request permission (Android 13+ requires explicit permission)
    const requestPermission = async () => {
      const authStatus = await messaging().requestPermission();
      const enabled =
        authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
        authStatus === messaging.AuthorizationStatus.PROVISIONAL;
      if (enabled) {
        const token = await messaging().getToken();
        console.log('[FCM] Token:', token);
        // TODO: send token to backend POST /api/fcm-token
      }
    };
    requestPermission();

    // 2. Foreground messages
    const unsubForeground = messaging().onMessage(async remoteMessage => {
      console.log('[FCM] Foreground message:', remoteMessage);
      // Notifee handles the local notification display
    });

    // 3. App opened from a notification (background → foreground)
    const unsubOpened = messaging().onNotificationOpenedApp(remoteMessage => {
      const siteId = remoteMessage?.data?.site_id;
      if (siteId && navRef.current) {
        navRef.current.navigate('Sites' as any, {
          screen: 'SiteDetail',
          params: { siteId: Number(siteId) },
        } as any);
      }
    });

    // 4. App opened from a notification (killed state)
    messaging()
      .getInitialNotification()
      .then(remoteMessage => {
        const siteId = remoteMessage?.data?.site_id;
        if (siteId && navRef.current) {
          navRef.current.navigate('Sites' as any, {
            screen: 'SiteDetail',
            params: { siteId: Number(siteId) },
          } as any);
        }
      });

    return () => {
      unsubForeground();
      unsubOpened();
    };
  }, [navRef]);
}
