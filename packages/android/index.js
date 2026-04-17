import {AppRegistry} from 'react-native';
import App from './src/App';
import {name as appName} from './app.json';

// Handle FCM background messages
import messaging from '@react-native-firebase/messaging';
messaging().setBackgroundMessageHandler(async remoteMessage => {
  console.log('[FCM] Background message:', remoteMessage);
});

AppRegistry.registerComponent(appName, () => App);
