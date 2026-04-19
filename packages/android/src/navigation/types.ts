import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BottomTabScreenProps }    from '@react-navigation/bottom-tabs';

// ─── Bottom tabs ──────────────────────────────────────────────────────────────
export type TabParamList = {
  Sites:    undefined;
  Map:      undefined;
  Ranking:  undefined;
  Settings: undefined;
};

// ─── Sites stack ──────────────────────────────────────────────────────────────
export type SitesStackParamList = {
  SitesList:    undefined;
  SiteDetail:   { siteId: number };
  LaptopDetail: { deviceId: number; deviceName: string; siteId: number };
};

// ─── Root (wraps login + tabs) ────────────────────────────────────────────────
export type RootStackParamList = {
  Login: undefined;
  Main:  undefined;
};

// ─── Screen prop helpers ──────────────────────────────────────────────────────
export type SitesListProps   = NativeStackScreenProps<SitesStackParamList, 'SitesList'>;
export type SiteDetailProps  = NativeStackScreenProps<SitesStackParamList, 'SiteDetail'>;
export type LaptopDetailProps= NativeStackScreenProps<SitesStackParamList, 'LaptopDetail'>;
export type RankingTabProps  = BottomTabScreenProps<TabParamList, 'Ranking'>;
export type SettingsTabProps = BottomTabScreenProps<TabParamList, 'Settings'>;
