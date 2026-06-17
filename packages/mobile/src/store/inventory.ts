import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApi, getApiBase } from './auth';
import type { Device, Student, OfflineTransaction } from '@starfleet/shared';

const INVENTORY_QUEUE_KEY = 'starfleet_inventory_queue';

// Simple UUID generator for React Native
const generateUuid = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

/** Load the offline transaction queue from AsyncStorage */
export async function loadQueue(): Promise<OfflineTransaction[]> {
  try {
    const raw = await AsyncStorage.getItem(INVENTORY_QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.error('Failed to load inventory queue:', err);
    return [];
  }
}

/** Save the offline transaction queue to AsyncStorage */
export async function saveQueue(queue: OfflineTransaction[]): Promise<void> {
  try {
    await AsyncStorage.setItem(INVENTORY_QUEUE_KEY, JSON.stringify(queue));
  } catch (err) {
    console.error('Failed to save inventory queue:', err);
  }
}

/** Add a transaction to the offline queue and attempt sync if online */
export async function queueTransaction(
  actionType: OfflineTransaction['action_type'],
  profileNumber: string,
  payload: OfflineTransaction['payload']
): Promise<OfflineTransaction> {
  const transaction: OfflineTransaction = {
    transaction_uuid: generateUuid(),
    timestamp: new Date().toISOString(),
    action_type: actionType,
    profile_number: profileNumber,
    payload,
  };

  const queue = await loadQueue();
  queue.push(transaction);
  await saveQueue(queue);

  // Attempt optimistic background sync
  setTimeout(() => {
    syncQueue().catch((err) => console.log('Optimistic sync failed:', err.message));
  }, 100);

  return transaction;
}

/** Clear the queue */
export async function clearQueue(): Promise<void> {
  await AsyncStorage.removeItem(INVENTORY_QUEUE_KEY);
}

/** Check if the API is currently reachable */
export async function checkConnectivity(): Promise<boolean> {
  try {
    const base = getApiBase();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    const res = await fetch(`${base}/healthz` || `${base}/api/ops/freshness`, {
      method: 'GET',
      signal: controller.signal,
    }).catch(() => null);

    clearTimeout(timeoutId);
    return res !== null && res.status < 500;
  } catch {
    return false;
  }
}

/** Synchronize the offline queue with the backend API */
export async function syncQueue(): Promise<{
  successCount: number;
  failedCount: number;
  results: any[];
}> {
  const queue = await loadQueue();
  if (queue.length === 0) {
    return { successCount: 0, failedCount: 0, results: [] };
  }

  const api = getApi();
  if (!api) {
    throw new Error('API client not initialized. Must login first.');
  }

  // Double check internet
  const isOnline = await checkConnectivity();
  if (!isOnline) {
    throw new Error('Server unreachable. Offline mode active.');
  }

  const res = await api.syncOfflineQueue(queue);
  if (!res.ok) {
    throw new Error('Sync failed on server side.');
  }

  const successUuids = new Set(
    res.results
      .filter((r) => r.status === 'success')
      .map((r) => r.transaction_uuid)
  );

  // Filter out successfully processed transactions
  const remainingQueue = queue.filter((tx) => !successUuids.has(tx.transaction_uuid));
  await saveQueue(remainingQueue);

  const successCount = res.results.filter((r) => r.status === 'success').length;
  const failedCount = res.results.filter((r) => r.status === 'failed').length;

  return {
    successCount,
    failedCount,
    results: res.results,
  };
}

// ─── API Operations (Online Direct, Offline fallback) ───────────────────────

/** Onboard a brand new device or associate serial with a new sticker */
export async function onboardDevice(serialNumber: string): Promise<{ ok: boolean; device: Device }> {
  const api = getApi();
  if (!api) throw new Error('API client not initialized');

  const isOnline = await checkConnectivity();
  if (!isOnline) {
    throw new Error('Internet connection required for blind onboarding (must allocate sequential LAP-XXX ID)');
  }

  return api.onboardDevice(serialNumber);
}

/** Mark device state (Intake Broken, Start Repair, Complete Repair) */
export async function markDeviceState(
  deviceId: number,
  profileNumber: string,
  status: 'intake_broken' | 'in_repair' | 'ready_for_reissue' | 'working_in_use' | 'decommissioned',
  symptomTags?: string[],
  notes?: string
): Promise<{ synced: boolean; device?: Device; transactionUuid?: string }> {
  const isOnline = await checkConnectivity();
  const api = getApi();

  if (isOnline && api) {
    try {
      const res = await api.markDeviceState({
        deviceId,
        hardware_status: status,
        symptom_tags: symptomTags,
        repair_details: notes,
      });
      return { synced: true, device: res.device };
    } catch (err) {
      console.log('Online mark state failed, queuing locally...', err);
    }
  }

  // Queue locally
  let actionType: OfflineTransaction['action_type'] = 'INTAKE_BROKEN';
  if (status === 'in_repair') actionType = 'REPAIR_START';
  if (status === 'ready_for_reissue' || status === 'working_in_use') actionType = 'REPAIR_COMPLETE';

  const tx = await queueTransaction(actionType, profileNumber, {
    symptom_tags: symptomTags,
    notes,
  });

  return { synced: false, transactionUuid: tx.transaction_uuid };
}

/** Reassign device to a student or staff member */
export async function reassignDevice(
  deviceId: number,
  profileNumber: string,
  assigneeEmail: string,
  assigneeType: 'student' | 'staff' | 'pool',
  siteId: number | null
): Promise<{ synced: boolean; device?: Device; transactionUuid?: string }> {
  const isOnline = await checkConnectivity();
  const api = getApi();

  if (isOnline && api) {
    try {
      const res = await api.reassignDevice({
        deviceId,
        assignee_email: assigneeEmail,
        assignee_type: assigneeType,
        site_id: siteId,
      });
      return { synced: true, device: res.device };
    } catch (err) {
      console.log('Online reassign failed, queuing locally...', err);
    }
  }

  // Queue locally
  const tx = await queueTransaction('ASSIGN', profileNumber, {
    assignee_email: assigneeEmail,
    assignee_type: assigneeType,
    site_id: siteId ?? undefined,
  });

  return { synced: false, transactionUuid: tx.transaction_uuid };
}

/** Fetch students roster for assignments */
export async function fetchStudents(siteId?: number): Promise<Student[]> {
  const api = getApi();
  if (!api) return [];
  try {
    return await api.getStudents(siteId);
  } catch (err) {
    console.error('Failed to fetch students:', err);
    return [];
  }
}
