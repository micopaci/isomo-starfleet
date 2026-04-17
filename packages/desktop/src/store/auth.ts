import { StarfleetApi, setSharedApiClient } from '@starfleet/shared';
import { StarfleetWS, setSharedWsClient } from '@starfleet/shared';

const TOKEN_KEY = 'starfleet_token';
const BASE_URL_KEY = 'starfleet_base_url';
const DEFAULT_BASE = 'http://localhost:3000';

let _api: StarfleetApi | null = null;
let _ws: StarfleetWS | null = null;

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getBaseUrl(): string {
  return localStorage.getItem(BASE_URL_KEY) || DEFAULT_BASE;
}

export function saveBaseUrl(url: string): void {
  localStorage.setItem(BASE_URL_KEY, url);
}

export function initClients(token: string, onAuthError: () => void): void {
  const base = getBaseUrl();

  _api = new StarfleetApi(base, () => getStoredToken() || '', onAuthError);
  setSharedApiClient(_api);

  const wsUrl = base.replace(/^http/, 'ws');
  _ws = new StarfleetWS();
  _ws.connect(wsUrl, token);
  setSharedWsClient(_ws);
}

export function login(token: string, onAuthError: () => void): void {
  localStorage.setItem(TOKEN_KEY, token);
  initClients(token, onAuthError);
}

export function logout(): void {
  localStorage.removeItem(TOKEN_KEY);
  _ws?.disconnect();
  _api = null;
  _ws = null;
}

export function isLoggedIn(): boolean {
  return !!getStoredToken();
}
