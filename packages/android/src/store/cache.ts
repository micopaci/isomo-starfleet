/**
 * Offline cache — persists last-known fleet/site data in AsyncStorage.
 * On launch, if the API is unreachable, we fall back to cached data and
 * display a "Last updated X min ago" banner.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Site, SiteDetail } from '@starfleet/shared';

const FLEET_KEY      = 'cache_fleet_sites';
const FLEET_TS_KEY   = 'cache_fleet_ts';
const SITE_KEY       = (id: number) => `cache_site_${id}`;
const SITE_TS_KEY    = (id: number) => `cache_site_ts_${id}`;

export interface CachedData<T> {
  data: T;
  cachedAt: number; // epoch ms
}

// ─── Fleet list ───────────────────────────────────────────────────────────────

export async function saveFleet(sites: Site[]): Promise<void> {
  await AsyncStorage.multiSet([
    [FLEET_KEY,    JSON.stringify(sites)],
    [FLEET_TS_KEY, String(Date.now())],
  ]);
}

export async function loadFleet(): Promise<CachedData<Site[]> | null> {
  const [raw, ts] = await AsyncStorage.multiGet([FLEET_KEY, FLEET_TS_KEY]);
  const data = raw[1] ? JSON.parse(raw[1]) : null;
  const cachedAt = ts[1] ? Number(ts[1]) : 0;
  if (!data) return null;
  return { data, cachedAt };
}

// ─── Individual site ──────────────────────────────────────────────────────────

export async function saveSite(id: number, site: SiteDetail): Promise<void> {
  await AsyncStorage.multiSet([
    [SITE_KEY(id),    JSON.stringify(site)],
    [SITE_TS_KEY(id), String(Date.now())],
  ]);
}

export async function loadSite(id: number): Promise<CachedData<SiteDetail> | null> {
  const [raw, ts] = await AsyncStorage.multiGet([SITE_KEY(id), SITE_TS_KEY(id)]);
  const data = raw[1] ? JSON.parse(raw[1]) : null;
  const cachedAt = ts[1] ? Number(ts[1]) : 0;
  if (!data) return null;
  return { data, cachedAt };
}

// ─── Helper ───────────────────────────────────────────────────────────────────

export function ageLabel(cachedAt: number): string {
  const mins = Math.round((Date.now() - cachedAt) / 60_000);
  if (mins < 1)   return 'just now';
  if (mins === 1) return '1 min ago';
  if (mins < 60)  return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  return `${hrs} hr ago`;
}
