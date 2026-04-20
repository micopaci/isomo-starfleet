import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BottomTabScreenProps }    from '@react-navigation/bottom-tabs';

// ─── Bottom tabs ──────────────────────────────────────────────────────────────
export type TabParamList = {
  Overview:  undefined;
  Map:       undefined;
  Sites:     undefined;
  Starlinks: undefined;
  Alerts:    undefined;
  Settings:  undefined;
};

// ─── Sites stack ──────────────────────────────────────────────────────────────
export type SitesStackParamList = {
  SitesList:    undefined;
  SiteDetail:   { siteId: number };
  DeviceDetail: { deviceId: number; deviceName: string; siteId: number };
};

// ─── Root (wraps login + tabs) ────────────────────────────────────────────────
export type RootStackParamList = {
  Login: undefined;
  Main:  undefined;
};

// ─── Screen prop helpers ──────────────────────────────────────────────────────
export type SitesListProps   = NativeStackScreenProps<SitesStackParamList, 'SitesList'>;
export type SiteDetailProps  = NativeStackScreenProps<SitesStackParamList, 'SiteDetail'>;
export type DeviceDetailProps= NativeStackScreenProps<SitesStackParamList, 'DeviceDetail'>;
export type OverviewTabProps = BottomTabScreenProps<TabParamList, 'Overview'>;
export type AlertsTabProps   = BottomTabScreenProps<TabParamList, 'Alerts'>;
