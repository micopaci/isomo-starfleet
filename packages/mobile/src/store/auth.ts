import AsyncStorage from '@react-native-async-storage/async-storage';
import { StarfleetApi, StarfleetWS, setSharedApiClient, setSharedWsClient } from '@starfleet/shared';

const TOKEN_KEY = 'starfleet_token';
const API_BASE_KEY = 'starfleet_api_base';

const DEFAULT_API_BASE = 'https://starfleet.yourdomain.com';

let _token: string | null = null;
let _apiBase: string = DEFAULT_API_BASE;
let _api: StarfleetApi | null = null;
let _ws: StarfleetWS | null = null;

export async function loadStoredCredentials(): Promise<boolean> {
  try {
    const [token, base] = await Promise.all([
      AsyncStorage.getItem(TOKEN_KEY),
      AsyncStorage.getItem(API_BASE_KEY),
    ]);
    if (token) {
      _token   = token;
      _apiBase = base ?? DEFAULT_API_BASE;
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export async function storeToken(token: string, base?: string): Promise<void> {
  _token   = token;
  _apiBase = base ?? DEFAULT_API_BASE;
  await AsyncStorage.multiSet([
    [TOKEN_KEY,    token],
    [API_BASE_KEY, _apiBase],
  ]);
}

export async function clearToken(): Promise<void> {
  _token = null;
  _ws?.close();
  _ws  = null;
  _api = null;
  await AsyncStorage.multiRemove([TOKEN_KEY, API_BASE_KEY]);
}

export function initClients(onAuthError: () => void): void {
  if (!_token) return;
  _api = new StarfleetApi(_apiBase, () => _token ?? '', onAuthError);
  _ws  = new StarfleetWS(_apiBase.replace(/^http/, 'ws') + '/ws', () => _token ?? '');
  setSharedApiClient(_api);
  setSharedWsClient(_ws);
}

export function getToken(): string | null { return _token; }
export function getApi():   StarfleetApi | null { return _api; }
export function getWs():    StarfleetWS  | null { return _ws; }
export function getApiBase(): string { return _apiBase; }

/** Decode JWT payload without verifying (display only). */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    return JSON.parse(atob(token.split('.')[1]));
  } catch {
    return null;
  }
}
