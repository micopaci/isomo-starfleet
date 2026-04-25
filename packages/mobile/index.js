/**
 * Starfleet Monitor — Android entry point
 *
 * Firebase messaging intentionally omitted for now. Re-enable by installing
 * @react-native-firebase/app + /messaging and dropping google-services.json
 * into android/app/. See docs/SITE_AUTO_DETECTION.md for the push flow.
 */
import 'react-native-gesture-handler';
import { AppRegistry } from 'react-native';
import App from './src/App'
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
