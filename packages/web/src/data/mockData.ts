/* ═══════════════════════════════════════════════════════════════
   Mock data — realistic Rwanda fleet telemetry
   Matches the unified mockup's data arrays
   ═══════════════════════════════════════════════════════════════ */

export type Status = 'online' | 'degraded' | 'offline';
export type DeviceStatus = 'working' | 'broken' | 'ready' | 'decommissioned';
export type AlertSev = 'critical' | 'warning' | 'info' | 'inventory';

export interface Dish {
  name: string;
  campus: string;
  region: string;
  status: Status;
  latency: number;
  snr: number;
  down: number;
  up: number;
  uptime: number;
  rain: number;
  laptops: number;
  spark: number[];
  lat: number[];
  pingDrop: number;
  agent: boolean;
  serial: string;
  lat_coord?: number;
  lng_coord?: number;
}

export interface Computer {
  tag: string;
  email: string;
  model: string;
  os: string;
  status: string;
  storage: number;
  battery: number;
  seen: string;
}

export interface Alert {
  id: string;
  sev: AlertSev;
  time: string;
  msg: string;
  meta: string;
  open: boolean;
  ageDays: number;
}

export interface InventoryDevice {
  profile: string;
  serial: string;
  model: string;
  status: DeviceStatus;
  assignee: string;
  lastIntake: string;
  operator: string;
  mismatch: boolean;
  hoursOnline?: number;
}

export const dishes: Dish[] = [
  { name: "GS Kinigi", campus: "Musanze", region: "Northern", status: "offline", latency: 0, snr: 0.0, down: 0, up: 0, uptime: 94.1, rain: 8.5, laptops: 15, spark: [40,20,10,5,0,0,0,0,0,0], lat: [0,0,0,0,0,0,0], pingDrop: 100, agent: false, serial: "SL-606-KNG-01", lat_coord: -1.47, lng_coord: 29.56 },
  { name: "GS St Mathieu", campus: "Busasamana", region: "Western", status: "offline", latency: 0, snr: 0.0, down: 0, up: 0, uptime: 97.2, rain: 0.2, laptops: 22, spark: [44,30,10,0,0,0,0,0,0,0], lat: [0,0,0,0,0,0,0], pingDrop: 100, agent: false, serial: "SL-908-STM-02", lat_coord: -2.49, lng_coord: 29.14 },
  { name: "GS Gishyita", campus: "Karongi", region: "Western", status: "degraded", latency: 184, snr: 6.2, down: 48, up: 5, uptime: 99.1, rain: 12.0, laptops: 18, spark: [82,80,78,70,62,51,45,41,39,38], lat: [62,64,70,94,121,168,184], pingDrop: 8, agent: true, serial: "SL-583967-GSH-62", lat_coord: -2.06, lng_coord: 29.43 },
  { name: "ES Kirambo", campus: "Burera", region: "Northern", status: "degraded", latency: 320, snr: 8.1, down: 136, up: 12, uptime: 99.4, rain: 2.3, laptops: 23, spark: [86,85,84,83,80,78,76,73,71,70], lat: [80,92,118,160,210,280,320], pingDrop: 12, agent: true, serial: "SL-204-KIR-08", lat_coord: -1.37, lng_coord: 29.81 },
  { name: "Maranyundo Girls", campus: "Bugesera", region: "Eastern", status: "online", latency: 42, snr: 11.8, down: 232, up: 24, uptime: 99.9, rain: 0.8, laptops: 38, spark: [91,92,91,93,94,93,95,96,94,95], lat: [35,37,36,40,42,39,42], pingDrop: 0, agent: true, serial: "SL-999-MRN-99", lat_coord: -2.36, lng_coord: 30.24 },
  { name: "CIC Muramba", campus: "Kigali", region: "Central", status: "online", latency: 31, snr: 12.6, down: 281, up: 28, uptime: 99.8, rain: 0.1, laptops: 27, spark: [88,89,91,93,92,94,95,94,96,95], lat: [28,29,30,32,31,30,31], pingDrop: 0, agent: true, serial: "SL-445-CIC-12", lat_coord: -1.94, lng_coord: 30.06 },
  { name: "St Paul Muko", campus: "Musanze", region: "Northern", status: "online", latency: 47, snr: 10.1, down: 176, up: 17, uptime: 99.5, rain: 1.2, laptops: 31, spark: [87,88,86,90,89,91,90,92,91,90], lat: [41,44,43,47,45,46,47], pingDrop: 1, agent: true, serial: "SL-312-MUK-04", lat_coord: -1.50, lng_coord: 29.63 },
  { name: "Rwamagana Leaders", campus: "Rwamagana", region: "Eastern", status: "online", latency: 36, snr: 13.0, down: 314, up: 31, uptime: 99.7, rain: 0.0, laptops: 25, spark: [92,91,93,94,95,94,96,95,97,96], lat: [35,36,34,37,36,35,36], pingDrop: 0, agent: true, serial: "SL-111-RWA-07", lat_coord: -1.95, lng_coord: 30.43 },
  { name: "SOPERM Rukomo", campus: "Gicumbi", region: "Northern", status: "online", latency: 52, snr: 9.7, down: 146, up: 13, uptime: 99.2, rain: 3.6, laptops: 20, spark: [80,83,84,82,85,84,86,83,85,84], lat: [48,49,52,51,53,52,52], pingDrop: 2, agent: true, serial: "SL-554-RUK-11", lat_coord: -1.58, lng_coord: 30.09 },
  { name: "ES Gisenyi", campus: "Rubavu", region: "Western", status: "online", latency: 44, snr: 10.8, down: 218, up: 21, uptime: 99.6, rain: 5.8, laptops: 24, spark: [86,87,88,87,90,88,91,89,90,90], lat: [42,43,44,45,44,43,44], pingDrop: 1, agent: false, serial: "SL-209-GIS-15", lat_coord: -1.70, lng_coord: 29.26 },
  { name: "ENDP", campus: "Butare", region: "Southern", status: "online", latency: 33, snr: 12.2, down: 247, up: 25, uptime: 99.8, rain: 0.0, laptops: 26, spark: [90,91,92,91,93,92,94,93,94,93], lat: [31,33,32,34,33,32,33], pingDrop: 0, agent: true, serial: "SL-583967-BUT-48", lat_coord: -2.60, lng_coord: 29.74 },
  { name: "Lycee de Kigali", campus: "Kigali", region: "Central", status: "online", latency: 30, snr: 12.9, down: 290, up: 30, uptime: 99.9, rain: 0.0, laptops: 35, spark: [93,94,95,95,96,95,97,96,97,96], lat: [28,29,29,31,30,29,30], pingDrop: 0, agent: true, serial: "SL-800-LDK-01", lat_coord: -1.96, lng_coord: 30.06 },
  { name: "Maranyundo Girls", campus: "Bugesera", region: "Eastern", status: "online", latency: 39, snr: 11.2, down: 205, up: 19, uptime: 99.3, rain: 0.4, laptops: 19, spark: [84,86,87,88,87,89,88,89,89,89], lat: [35,38,39,37,39,38,39], pingDrop: 0, agent: true, serial: "SL-389-JUR-23", lat_coord: -2.38, lng_coord: 30.28 },
];

export const computers: Computer[] = [
  { tag: "RW-NYA-042", email: "alice.n@isomo.ac.rw", model: "Lenovo 300e", os: "ChromeOS 126", status: "offline", storage: 68, battery: 0, seen: "12m" },
  { tag: "RW-GIS-018", email: "claude.g@isomo.ac.rw", model: "Dell Latitude 3420", os: "Windows 11 23H2", status: "critical", storage: 91, battery: 18, seen: "38m" },
  { tag: "RW-MAR-014", email: "pacifique@isomo.ac.rw", model: "Lenovo 100w", os: "Windows 11 22H2", status: "update-due", storage: 54, battery: 62, seen: "3h" },
  { tag: "RW-KIR-023", email: "tech.kirambo@isomo.ac.rw", model: "HP Chromebook 11", os: "ChromeOS 125", status: "low-storage", storage: 88, battery: 71, seen: "44m" },
  { tag: "RW-CIC-005", email: "teacher.cic@isomo.ac.rw", model: "Dell 3120", os: "Windows 11 23H2", status: "healthy", storage: 42, battery: 94, seen: "5m" },
  { tag: "RW-MUK-031", email: "muko.lab@isomo.ac.rw", model: "Lenovo 300e", os: "ChromeOS 126", status: "healthy", storage: 36, battery: 88, seen: "9m" },
  { tag: "RW-RWA-025", email: "leaders@isomo.ac.rw", model: "HP ProBook", os: "Windows 11 23H2", status: "healthy", storage: 49, battery: 77, seen: "7m" },
  { tag: "RW-RUK-020", email: "rukomo@isomo.ac.rw", model: "Lenovo 100w", os: "Windows 10 22H2", status: "update-due", storage: 63, battery: 52, seen: "2h" },
  { tag: "RW-GIS-024", email: "gisenyi@isomo.ac.rw", model: "Dell Latitude", os: "Windows 11 23H2", status: "offline", storage: 52, battery: 0, seen: "1d" },
  { tag: "RW-JUR-019", email: "juru@isomo.ac.rw", model: "HP Chromebook 11", os: "ChromeOS 126", status: "healthy", storage: 28, battery: 83, seen: "11m" },
];

export const alerts: Alert[] = [
  { id: "a1", sev: "critical", time: "14:20", msg: "GS Kinigi went offline, cloud heartbeat lost", meta: "starlink · Musanze · unassigned", open: true, ageDays: 0 },
  { id: "a2", sev: "critical", time: "13:54", msg: "GS St Mathieu offline since morning sweep", meta: "starlink · Busasamana · Pacifique", open: true, ageDays: 0 },
  { id: "a3", sev: "warning", time: "14:02", msg: "GS Gishyita signal SNR dropped below 7dB", meta: "signal · Karongi · Pacifique", open: true, ageDays: 1 },
  { id: "a4", sev: "warning", time: "13:48", msg: "ES Kirambo latency p95 crossed 300ms threshold", meta: "starlink · Burera · unassigned", open: true, ageDays: 2 },
  { id: "a5", sev: "inventory", time: "12:45", msg: "LAP-012 heartbeating online while marked intake_broken", meta: "inventory · operator: Eric · +72h", open: true, ageDays: 3 },
  { id: "a6", sev: "inventory", time: "11:30", msg: "LAP-088 active while decommissioned — possible unauthorised use", meta: "inventory · operator: Pacifique · +26h", open: true, ageDays: 2 },
  { id: "a7", sev: "warning", time: "12:30", msg: "Maranyundo Girls has 14 laptops stale", meta: "computers · Bugesera · Pacifique", open: true, ageDays: 8 },
  { id: "a8", sev: "info", time: "11:15", msg: "CIC Muramba recovered, back online", meta: "starlink · Kigali · auto", open: false, ageDays: 12 },
  { id: "a9", sev: "info", time: "10:40", msg: "Six sites are reporting rainfall above 5mm", meta: "weather · fleet-wide · watch", open: true, ageDays: 0 },
];

export const inventory: InventoryDevice[] = [
  { profile: "LAP-001", serial: "SN-A9283F", model: "Dell Latitude 5490", status: "working", assignee: "alice.n@isomo.ac.rw", lastIntake: "2026-05-12", operator: "Eric", mismatch: false },
  { profile: "LAP-002", serial: "SN-B1102E", model: "HP ProBook 440", status: "working", assignee: "claude.g@isomo.ac.rw", lastIntake: "2026-05-18", operator: "Eric", mismatch: false },
  { profile: "LAP-003", serial: "SN-C7738B", model: "ThinkPad E14", status: "decommissioned", assignee: "—", lastIntake: "2026-06-02", operator: "Pacifique", mismatch: true, hoursOnline: 26 },
  { profile: "LAP-004", serial: "SN-D2291K", model: "Lenovo 300e", status: "broken", assignee: "—", lastIntake: "2026-06-10", operator: "Eric", mismatch: false },
  { profile: "LAP-005", serial: "SN-E8841Z", model: "Dell Latitude 3420", status: "broken", assignee: "—", lastIntake: "2026-06-13", operator: "Pacifique", mismatch: false },
  { profile: "LAP-006", serial: "SN-F3390M", model: "HP Chromebook 11", status: "ready", assignee: "—", lastIntake: "2026-06-11", operator: "Eric", mismatch: false },
  { profile: "LAP-007", serial: "SN-G5542N", model: "Lenovo 100w", status: "working", assignee: "teacher.jean@isomo.ac.rw", lastIntake: "2026-04-28", operator: "Pacifique", mismatch: false },
  { profile: "LAP-008", serial: "SN-H9921Q", model: "Dell 3120", status: "working", assignee: "sandrine.m@isomo.ac.rw", lastIntake: "2026-04-14", operator: "Eric", mismatch: false },
  { profile: "LAP-009", serial: "SN-I7723R", model: "HP ProBook 450", status: "ready", assignee: "—", lastIntake: "2026-06-08", operator: "Pacifique", mismatch: false },
  { profile: "LAP-010", serial: "SN-J4412S", model: "Lenovo 300e", status: "broken", assignee: "—", lastIntake: "2026-06-15", operator: "Eric", mismatch: false },
  { profile: "LAP-011", serial: "SN-K6670T", model: "ThinkPad L14", status: "working", assignee: "john.doe@isomo.ac.rw", lastIntake: "2026-03-22", operator: "Pacifique", mismatch: false },
  { profile: "LAP-012", serial: "SN-A9283F", model: "Dell Latitude 5490", status: "broken", assignee: "—", lastIntake: "2026-06-14", operator: "Eric", mismatch: true, hoursOnline: 72 },
  { profile: "LAP-013", serial: "SN-L3318P", model: "HP Chromebook 11", status: "working", assignee: "grace.m@isomo.ac.rw", lastIntake: "2026-04-05", operator: "Eric", mismatch: false },
  { profile: "LAP-014", serial: "SN-M8824V", model: "Dell Latitude 5490", status: "working", assignee: "eric.m@isomo.ac.rw", lastIntake: "2026-02-18", operator: "Pacifique", mismatch: false },
];

export const STUDENTS = [
  "alice.n@isomo.ac.rw",
  "claude.g@isomo.ac.rw",
  "pacifique.m@isomo.ac.rw",
  "sandrine.m@isomo.ac.rw",
  "grace.k@isomo.ac.rw",
  "jean.b@isomo.ac.rw",
  "eric.n@isomo.ac.rw",
  "celestine.m@isomo.ac.rw",
];

export const KNOWN_SERIALS = inventory.map(d => ({
  serial: d.serial,
  model: d.model,
  profile: d.profile,
}));
