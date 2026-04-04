import { Platform } from 'react-native';

/**
 * Wraps a reanimated exiting animation so it only runs on native.
 * On web, exiting animations cause "removeChild" DOM errors.
 */
export function webSafeExit<T>(animation: T): T | undefined {
  return Platform.OS !== 'web' ? animation : undefined;
}
