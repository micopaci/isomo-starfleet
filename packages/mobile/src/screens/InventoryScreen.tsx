import React, { useEffect, useState, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Modal,
} from 'react-native';
import { Colors } from '../theme/colors';
import { getApi, setOperatorEmail } from '../store/auth';
import {
  loadQueue,
  syncQueue,
  onboardDevice,
  markDeviceState,
  reassignDevice,
  fetchStudents,
  checkConnectivity,
} from '../store/inventory';
import type { Device, Student, OfflineTransaction } from '@starfleet/shared';

interface Props {
  colors: Colors;
  role: string;
}

export function InventoryScreen({ colors, role }: Props) {
  const [profileInput, setProfileInput] = useState('');
  const [scannedDevice, setScannedDevice] = useState<Device | null>(null);
  const [loading, setLoading] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [queueLength, setQueueLength] = useState(0);
  const [queueItems, setQueueItems] = useState<OfflineTransaction[]>([]);
  const [syncing, setSyncing] = useState(false);

  // Autocomplete data
  const [allDevices, setAllDevices] = useState<Device[]>([]);

  // Modals
  const [showOnboardModal, setShowOnboardModal] = useState(false);
  const [showReassignModal, setShowReassignModal] = useState(false);
  const [showCameraModal, setShowCameraModal] = useState(false);

  // Onboard State
  const [biosSerial, setBiosSerial] = useState('');
  
  // Reassign State
  const [students, setStudents] = useState<Student[]>([]);
  const [selectedStudentEmail, setSelectedStudentEmail] = useState('');
  const [selectedStudentType, setSelectedStudentType] = useState<'student' | 'staff' | 'pool'>('student');
  const [selectedSiteId, setSelectedSiteId] = useState<number | null>(null);

  // Symptoms / Notes
  const [symptomTags, setSymptomTags] = useState<string[]>([]);
  const [repairNotes, setRepairNotes] = useState('');
  const [operatorName, setOperatorName] = useState('');

  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  async function checkStatus() {
    const online = await checkConnectivity();
    setIsOnline(online);
    const q = await loadQueue();
    setQueueLength(q.length);
    setQueueItems(q);

    // Fetch lists for autocomplete dropdowns if online
    if (online) {
      const api = getApi();
      if (api) {
        api.getDevices().then(setAllDevices).catch(() => {});
        api.getStudents().then(setStudents).catch(() => {});
      }
    }
  }

  async function handleSync() {
    if (syncing) return;
    setSyncing(true);
    try {
      const { successCount, failedCount } = await syncQueue();
      await checkStatus();
      if (successCount > 0 || failedCount > 0) {
        Alert.alert(
          'Sync Complete',
          `Successfully processed ${successCount} transactions.${
            failedCount > 0 ? ` Failed: ${failedCount}.` : ''
          }`
        );
      } else {
        Alert.alert('Sync', 'Queue is empty.');
      }
    } catch (err: any) {
      Alert.alert('Sync Error', err.message || 'Unknown error');
    } finally {
      setSyncing(false);
    }
  }

  // Scan lookup
  async function handleScanSubmit() {
    if (!profileInput) return;
    setLoading(true);
    setScannedDevice(null);
    try {
      const api = getApi();
      if (!api) {
        Alert.alert('Error', 'API client not initialized. Log in again.');
        return;
      }
      
      const normalized = profileInput.trim().toUpperCase();
      // Use cached list or fetch
      const match = allDevices.find(
        (d) =>
          d.profile_number?.toUpperCase() === normalized ||
          d.windows_sn?.toUpperCase() === normalized
      );

      if (match) {
        setScannedDevice(match);
        // Pre-populate students for assignment dropdown
        const roster = await fetchStudents(match.site_id ?? undefined);
        setStudents(roster);
      } else {
        Alert.alert(
          'Not Found',
          `Device ${normalized} is not registered in Starfleet. Use "Register Without Label" to onboard.`
        );
      }
    } catch (err: any) {
      Alert.alert('Lookup Error', err.message || 'Failed to fetch device info');
    } finally {
      setLoading(false);
      setProfileInput('');
      inputRef.current?.focus();
    }
  }

  // Action: Mark Broken
  async function handleMarkBroken() {
    if (!scannedDevice) return;
    if (role === 'guest_operator' && !operatorName.trim()) {
      Alert.alert('Operator Name Required', 'Please enter the data entry person\'s name on the screen before proceeding.');
      return;
    }
    if (operatorName.trim()) {
      setOperatorEmail(operatorName.trim());
    }
    setLoading(true);
    try {
      const status = 'intake_broken';
      const tags = symptomTags.length > 0 ? symptomTags : ['ssd_fail'];
      const notes = repairNotes || 'Intake checked-in as broken';

      const { synced } = await markDeviceState(
        scannedDevice.id,
        scannedDevice.profile_number || '',
        status,
        tags,
        notes
      );

      Alert.alert(
        synced ? 'Success' : 'Queued Offline',
        synced
          ? 'Device marked as BROKEN. Apply physical RED sticky note.'
          : 'Offline. Device mark queued locally. Apply physical RED sticky note.'
      );

      setScannedDevice(null);
      setSymptomTags([]);
      setRepairNotes('');
      await checkStatus();
    } catch (err: any) {
      Alert.alert('Action Error', err.message || 'Failed to update state');
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  // Action: Mark Ready / Reissue Pool
  async function handleMarkRepaired() {
    if (!scannedDevice) return;
    if (role === 'guest_operator' && !operatorName.trim()) {
      Alert.alert('Operator Name Required', 'Please enter the data entry person\'s name on the screen before proceeding.');
      return;
    }
    if (operatorName.trim()) {
      setOperatorEmail(operatorName.trim());
    }
    setLoading(true);
    try {
      const status = 'ready_for_reissue';
      const notes = 'Repaired and bench tested.';

      const { synced } = await markDeviceState(
        scannedDevice.id,
        scannedDevice.profile_number || '',
        status,
        [],
        notes
      );

      Alert.alert(
        synced ? 'Success' : 'Queued Offline',
        synced
          ? 'Device placed in READY pool. Apply physical GREEN sticky note.'
          : 'Offline. Placement queued locally. Apply physical GREEN sticky note.'
      );

      setScannedDevice(null);
      await checkStatus();
    } catch (err: any) {
      Alert.alert('Action Error', err.message || 'Failed to update state');
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  // Action: Reassign
  async function handleReassign() {
    if (!scannedDevice || !selectedStudentEmail) return;
    if (role === 'guest_operator' && !operatorName.trim()) {
      Alert.alert('Operator Name Required', 'Please enter the data entry person\'s name on the screen before proceeding.');
      return;
    }
    if (operatorName.trim()) {
      setOperatorEmail(operatorName.trim());
    }
    setLoading(true);
    try {
      const { synced } = await reassignDevice(
        scannedDevice.id,
        scannedDevice.profile_number || '',
        selectedStudentEmail,
        selectedStudentType,
        selectedSiteId
      );

      Alert.alert(
        synced ? 'Success' : 'Queued Offline',
        synced
          ? `Device assigned to ${selectedStudentEmail}. Remove sticky notes.`
          : 'Offline. Assignment queued locally. Remove sticky notes.'
      );

      setScannedDevice(null);
      setShowReassignModal(false);
      setSelectedStudentEmail('');
      await checkStatus();
    } catch (err: any) {
      Alert.alert('Action Error', err.message || 'Failed to assign device');
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  // Action: Onboard New Device
  async function handleOnboard() {
    if (!biosSerial) return;
    if (role === 'guest_operator' && !operatorName.trim()) {
      Alert.alert('Operator Name Required', 'Please enter the data entry person\'s name on the screen before proceeding.');
      return;
    }
    if (operatorName.trim()) {
      setOperatorEmail(operatorName.trim());
    }
    setLoading(true);
    try {
      const res = await onboardDevice(biosSerial);
      Alert.alert(
        'Onboarding Complete',
        `Device registered! Assigned Sticker ID: ${res.device.profile_number}\n\nPrinting label now. Apply label to chassis.`
      );
      setBiosSerial('');
      setShowOnboardModal(false);
      setScannedDevice(res.device);
      await checkStatus();
    } catch (err: any) {
      Alert.alert('Onboarding Error', err.message || 'Failed to onboard device');
    } finally {
      setLoading(false);
    }
  }

  const toggleSymptom = (tag: string) => {
    setSymptomTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const getHardwareStatusColor = (status?: string) => {
    switch (status) {
      case 'working_in_use':
        return colors.ok;
      case 'intake_broken':
        return colors.bad;
      case 'in_repair':
        return colors.warn;
      case 'ready_for_reissue':
        return colors.ok;
      default:
        return colors.muted;
    }
  };

  const getHardwareStatusLabel = (status?: string) => {
    switch (status) {
      case 'working_in_use':
        return 'Working (In Use)';
      case 'intake_broken':
        return 'Broken (Intake)';
      case 'in_repair':
        return 'In Repair';
      case 'ready_for_reissue':
        return 'Ready For Reissue';
      case 'decommissioned':
        return 'Decommissioned';
      default:
        return 'Unknown';
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.rule }]}>
        <Text style={[styles.headerTitle, { color: colors.ink }]}>Hardware Intake</Text>
        <View style={styles.syncContainer}>
          <View
            style={[
              styles.statusDot,
              { backgroundColor: isOnline ? colors.ok : colors.warn },
            ]}
          />
          <Text style={[styles.syncText, { color: colors.ink2 }]}>
            {isOnline ? 'Online' : 'Offline'} {queueLength > 0 && `(${queueLength} Queued)`}
          </Text>
          {queueLength > 0 && (
            <TouchableOpacity
              style={[styles.syncButton, { backgroundColor: colors.accent }]}
              onPress={handleSync}
              disabled={syncing}
            >
              {syncing ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.syncButtonText}>Sync</Text>
              )}
            </TouchableOpacity>
          )}
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        {/* Scan Entry */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.rule }]}>
          <Text style={[styles.cardLabel, { color: colors.muted }]}>SCAN OR ENTER LAPTOP ID / SERIAL</Text>
          <View style={styles.scanRow}>
            <TextInput
              ref={inputRef}
              style={[
                styles.scanInput,
                { color: colors.ink, borderColor: colors.rule, backgroundColor: colors.bg },
              ]}
              placeholder="e.g. LAP-001 or SN..."
              placeholderTextColor={colors.muted}
              value={profileInput}
              onChangeText={setProfileInput}
              onSubmitEditing={handleScanSubmit}
              autoCapitalize="characters"
              autoCorrect={false}
            />
            <TouchableOpacity
              style={[styles.cameraScanBtn, { backgroundColor: colors.accent }]}
              onPress={() => setShowCameraModal(true)}
            >
              <Text style={styles.btnText}>📷 Scan</Text>
            </TouchableOpacity>
          </View>

          {/* Autocomplete Dropdown */}
          {profileInput.length > 1 && (
            <View style={[styles.autocompleteContainer, { backgroundColor: colors.surface2, borderColor: colors.rule }]}>
              {allDevices
                .filter(
                  (d) =>
                    d.profile_number?.toUpperCase().includes(profileInput.toUpperCase()) ||
                    d.windows_sn?.toUpperCase().includes(profileInput.toUpperCase())
                )
                .slice(0, 5)
                .map((d) => (
                  <TouchableOpacity
                    key={d.id}
                    style={[styles.autocompleteRow, { borderBottomColor: colors.rule2 }]}
                    onPress={async () => {
                      setScannedDevice(d);
                      setProfileInput('');
                      // Load site students
                      const roster = await fetchStudents(d.site_id ?? undefined);
                      setStudents(roster);
                    }}
                  >
                    <Text style={[styles.autocompleteText, { color: colors.ink }]}>
                      {d.profile_number
                        ? `${d.profile_number} — SN: ${d.windows_sn}`
                        : `SN: ${d.windows_sn}`}
                    </Text>
                  </TouchableOpacity>
                ))}
            </View>
          )}

          <TouchableOpacity
            style={[styles.onboardBtn, { borderColor: colors.accent, marginTop: 8 }]}
            onPress={() => setShowOnboardModal(true)}
          >
            <Text style={[styles.onboardBtnText, { color: colors.accent }]}>
              + Register Device Without Sticker
            </Text>
          </TouchableOpacity>
        </View>

        {loading && <ActivityIndicator color={colors.accent} size="large" style={{ marginVertical: 20 }} />}

        {/* Scanned Device Details */}
        {scannedDevice && (
          <View
            style={[
              styles.card,
              { backgroundColor: colors.surface, borderColor: colors.rule, borderWidth: 1 },
            ]}
          >
            {/* Top Indicator bar */}
            <View
              style={[
                styles.topBar,
                { backgroundColor: getHardwareStatusColor(scannedDevice.hardware_status) },
              ]}
            />

            <View style={styles.deviceHeader}>
              <View>
                <Text style={[styles.deviceTitle, { color: colors.ink }]}>
                  {scannedDevice.profile_number || 'LAP-UNKNOWN'}
                </Text>
                <Text style={[styles.deviceSerial, { color: colors.muted }]}>
                  SN: {scannedDevice.windows_sn}
                </Text>
              </View>
              <View
                style={[
                  styles.statusBadge,
                  {
                    backgroundColor:
                      scannedDevice.hardware_status === 'intake_broken'
                        ? colors.badSoft
                        : colors.okSoft,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.statusBadgeText,
                    { color: getHardwareStatusColor(scannedDevice.hardware_status) },
                  ]}
                >
                  {getHardwareStatusLabel(scannedDevice.hardware_status).toUpperCase()}
                </Text>
              </View>
            </View>

            <View style={[styles.detailRow, { borderBottomColor: colors.rule2 }]}>
              <Text style={[styles.detailLabel, { color: colors.muted }]}>Model</Text>
              <Text style={[styles.detailValue, { color: colors.ink2 }]}>
                {scannedDevice.manufacturer || ''} {scannedDevice.model || 'Unknown Laptop'}
              </Text>
            </View>

            <View style={[styles.detailRow, { borderBottomColor: colors.rule2 }]}>
              <Text style={[styles.detailLabel, { color: colors.muted }]}>Last User</Text>
              <Text style={[styles.detailValue, { color: colors.ink2 }]}>
                {scannedDevice.user_principal_name || 'No assigned user'}
              </Text>
            </View>

            {/* Quick Actions */}
            <Text style={[styles.sectionTitle, { color: colors.ink }]}>Intake Actions</Text>

            {scannedDevice.hardware_status !== 'intake_broken' && (
              <View style={styles.actionBlock}>
                <Text style={[styles.actionLabel, { color: colors.muted }]}>DIAGNOSTICS & CHECK-IN</Text>
                <View style={styles.tagContainer}>
                  {['ssd_fail', 'lockout', 'screen_crack', 'keyboard_fail'].map((tag) => (
                    <TouchableOpacity
                      key={tag}
                      style={[
                        styles.tagButton,
                        symptomTags.includes(tag) && {
                          backgroundColor: colors.accentSoft,
                          borderColor: colors.accent,
                        },
                        { borderColor: colors.rule },
                      ]}
                      onPress={() => toggleSymptom(tag)}
                    >
                      <Text
                        style={[
                          styles.tagText,
                          { color: symptomTags.includes(tag) ? colors.accent : colors.ink2 },
                        ]}
                      >
                        {tag.replace('_', ' ').toUpperCase()}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TextInput
                  style={[
                    styles.notesInput,
                    { borderColor: colors.rule, color: colors.ink, backgroundColor: colors.bg },
                  ]}
                  placeholder="Technical intake notes..."
                  placeholderTextColor={colors.muted}
                  value={repairNotes}
                  onChangeText={setRepairNotes}
              />
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: colors.bad }]}
                onPress={handleMarkBroken}
              >
                <Text style={styles.actionBtnText}>[Tap 2] Mark As Broken (RED sticky)</Text>
              </TouchableOpacity>
            </View>
          )}

            {role === 'guest_operator' && (
              <View style={{ marginBottom: 16 }}>
                <Text style={[styles.cardLabel, { color: colors.muted, marginBottom: 6 }]}>DATA ENTRY PERSON</Text>
                <TextInput
                  style={[
                    styles.scanInput,
                    { color: colors.ink, borderColor: colors.rule, backgroundColor: colors.bg, marginRight: 0 },
                  ]}
                  placeholder="Enter your name (e.g. Eric)"
                  placeholderTextColor={colors.muted}
                  value={operatorName}
                  onChangeText={setOperatorName}
                  autoCapitalize="words"
                  autoCorrect={false}
                />
              </View>
            )}

            <View style={styles.actionBtnRow}>
              <TouchableOpacity
                style={[styles.halfBtn, { backgroundColor: colors.ok }]}
                onPress={handleMarkRepaired}
              >
                <Text style={styles.actionBtnText}>Place in Ready Pool (GREEN)</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.halfBtn, { backgroundColor: colors.accent }]}
                onPress={() => {
                  setSelectedSiteId(scannedDevice.site_id);
                  setShowReassignModal(true);
                }}
              >
                <Text style={styles.actionBtnText}>Issue / Re-Assign</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Offline Queue Display */}
        {queueItems.length > 0 && (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.rule }]}>
            <Text style={[styles.cardLabel, { color: colors.muted }]}>OFFLINE QUEUE ({queueLength})</Text>
            {queueItems.map((item, idx) => (
              <View key={item.transaction_uuid} style={[styles.queueItem, idx > 0 && { borderTopColor: colors.rule2 }]}>
                <View style={styles.queueHeader}>
                  <Text style={[styles.queueProfile, { color: colors.ink }]}>{item.profile_number}</Text>
                  <Text style={[styles.queueAction, { color: colors.accent }]}>
                    {item.action_type}
                  </Text>
                </View>
                <Text style={[styles.queueMeta, { color: colors.muted }]}>
                  {new Date(item.timestamp).toLocaleTimeString()}
                </Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Modal: Onboard / Register Serial */}
      <Modal visible={showOnboardModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
            <Text style={[styles.modalTitle, { color: colors.ink }]}>Register Device</Text>
            <Text style={[styles.modalDesc, { color: colors.muted }]}>
              Enter the BIOS Serial Number printed underneath the chassis. This binds it to a new LAP-XXX sequence.
            </Text>
            
            <TextInput
              style={[styles.modalInput, { borderColor: colors.rule, color: colors.ink }]}
              placeholder="Manufacturer BIOS Serial (e.g. Dell Tag)"
              placeholderTextColor={colors.muted}
              value={biosSerial}
              onChangeText={setBiosSerial}
              autoCapitalize="characters"
              autoCorrect={false}
            />

            {/* BIOS Serial Autocomplete from synced devices without sticker */}
            {biosSerial.length > 1 && (
              <View style={[styles.autocompleteContainer, { backgroundColor: colors.surface2, borderColor: colors.rule, maxHeight: 120, marginBottom: 12 }]}>
                {allDevices
                  .filter(
                    (d) =>
                      !d.profile_number &&
                      d.windows_sn.toUpperCase().includes(biosSerial.toUpperCase())
                  )
                  .slice(0, 5)
                  .map((d) => (
                    <TouchableOpacity
                      key={d.id}
                      style={[styles.autocompleteRow, { borderBottomColor: colors.rule2, padding: 8 }]}
                      onPress={() => setBiosSerial(d.windows_sn)}
                    >
                      <Text style={{ color: colors.ink, fontSize: 13 }}>
                        {d.windows_sn} {d.model ? `(${d.model})` : ''}
                      </Text>
                    </TouchableOpacity>
                  ))}
              </View>
            )}

            {role === 'guest_operator' && (
              <TextInput
                style={[styles.modalInput, { borderColor: colors.rule, color: colors.ink }]}
                placeholder="Data Entry Person (Your Name)"
                placeholderTextColor={colors.muted}
                value={operatorName}
                onChangeText={setOperatorName}
                autoCapitalize="words"
                autoCorrect={false}
              />
            )}

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalCancelBtn, { borderColor: colors.rule }]}
                onPress={() => setShowOnboardModal(false)}
              >
                <Text style={[styles.modalCancelText, { color: colors.ink2 }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalConfirmBtn, { backgroundColor: colors.accent }]}
                onPress={handleOnboard}
                disabled={!biosSerial}
              >
                <Text style={styles.modalConfirmText}>Register & Print</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal: Reassign */}
      <Modal visible={showReassignModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
            <Text style={[styles.modalTitle, { color: colors.ink }]}>Assign Laptop</Text>
            
            <Text style={[styles.modalDesc, { color: colors.muted }]}>
              Enter or choose the student or staff member from the roster.
            </Text>

            <TextInput
              style={[styles.modalInput, { borderColor: colors.rule, color: colors.ink }]}
              placeholder="Enter User Email (UPN)"
              placeholderTextColor={colors.muted}
              value={selectedStudentEmail}
              onChangeText={setSelectedStudentEmail}
              autoCapitalize="none"
              autoCorrect={false}
            />

            {role === 'guest_operator' && (
              <TextInput
                style={[styles.modalInput, { borderColor: colors.rule, color: colors.ink }]}
                placeholder="Data Entry Person (Your Name)"
                placeholderTextColor={colors.muted}
                value={operatorName}
                onChangeText={setOperatorName}
                autoCapitalize="words"
                autoCorrect={false}
              />
            )}

            <View style={styles.typeSelector}>
              {['student', 'staff', 'pool'].map((type) => (
                <TouchableOpacity
                  key={type}
                  style={[
                    styles.typeBtn,
                    selectedStudentType === type && {
                      backgroundColor: colors.accentSoft,
                      borderColor: colors.accent,
                    },
                    { borderColor: colors.rule },
                  ]}
                  onPress={() => setSelectedStudentType(type as any)}
                >
                  <Text
                    style={[
                      styles.typeBtnText,
                      { color: selectedStudentType === type ? colors.accent : colors.ink2 },
                    ]}
                  >
                    {type.toUpperCase()}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Filtered suggestions list (Name & Email search suggestion autofill) */}
            {students.length > 0 && (
              <View style={styles.suggestionsContainer}>
                <Text style={[styles.suggestionsTitle, { color: colors.muted }]}>
                  {selectedStudentEmail ? 'MATCHING USERS' : 'SMART SUGGESTIONS'}
                </Text>
                <ScrollView style={styles.suggestionsScroll} keyboardShouldPersistTaps="handled">
                  {students
                    .filter(
                      (st) =>
                        !selectedStudentEmail ||
                        st.email.toLowerCase().includes(selectedStudentEmail.toLowerCase()) ||
                        st.full_name.toLowerCase().includes(selectedStudentEmail.toLowerCase())
                    )
                    .slice(0, 5)
                    .map((st) => (
                      <TouchableOpacity
                        key={st.id}
                        style={[styles.suggestionRow, { borderBottomColor: colors.rule2 }]}
                        onPress={() => {
                          setSelectedStudentEmail(st.email);
                          setSelectedStudentType('student');
                        }}
                      >
                        <Text style={[styles.suggestionName, { color: colors.ink }]}>
                          {st.full_name}
                        </Text>
                        <Text style={[styles.suggestionEmail, { color: colors.muted }]}>
                          {st.email}
                        </Text>
                      </TouchableOpacity>
                    ))}
                </ScrollView>
              </View>
            )}

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalCancelBtn, { borderColor: colors.rule }]}
                onPress={() => setShowReassignModal(false)}
              >
                <Text style={[styles.modalCancelText, { color: colors.ink2 }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalConfirmBtn, { backgroundColor: colors.ok }]}
                onPress={handleReassign}
                disabled={!selectedStudentEmail}
              >
                <Text style={styles.modalConfirmText}>Confirm Reissue</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal: Camera Barcode Simulator */}
      <Modal visible={showCameraModal} animationType="fade" transparent>
        <View style={styles.cameraOverlay}>
          <View style={styles.cameraFrame}>
            <Text style={styles.cameraText}>Simulating Camera Barcode Scanner</Text>
            <View style={styles.laserLine} />
            <Text style={styles.cameraSubtext}>Align the LAP-XXX sticker inside the frame</Text>
            
            <TextInput
              style={styles.simScannerInput}
              placeholder="Type simulated sticker code..."
              placeholderTextColor="#999"
              onSubmitEditing={(e) => {
                setProfileInput(e.nativeEvent.text);
                setShowCameraModal(false);
                setTimeout(handleScanSubmit, 100);
              }}
              autoFocus
            />

            <TouchableOpacity
              style={styles.cameraCloseBtn}
              onPress={() => setShowCameraModal(false)}
            >
              <Text style={styles.cameraCloseText}>Close Scanner</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    height: 60,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    fontFamily: 'Newsreader',
  },
  syncContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 0,
    marginRight: 6,
  },
  syncText: {
    fontSize: 12,
    marginRight: 8,
  },
  syncButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 0,
  },
  syncButtonText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  scrollContent: {
    padding: 16,
  },
  card: {
    borderRadius: 0,
    borderWidth: 1,
    padding: 16,
    marginBottom: 16,
  },
  cardLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: 8,
  },
  scanRow: {
    flexDirection: 'row',
  },
  scanInput: {
    flex: 1,
    height: 44,
    borderWidth: 1,
    borderRadius: 0,
    paddingHorizontal: 12,
    fontSize: 16,
    marginRight: 8,
  },
  cameraScanBtn: {
    width: 80,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 0,
  },
  btnText: {
    color: '#fff',
    fontWeight: '600',
  },
  onboardBtn: {
    height: 40,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  onboardBtnText: {
    fontWeight: '600',
    fontSize: 13,
  },
  topBar: {
    height: 4,
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
  },
  deviceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  deviceTitle: {
    fontSize: 24,
    fontWeight: '700',
    fontFamily: 'Newsreader',
  },
  deviceSerial: {
    fontSize: 12,
    marginTop: 2,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 0,
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  detailLabel: {
    fontSize: 13,
  },
  detailValue: {
    fontSize: 13,
    fontWeight: '600',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginTop: 20,
    marginBottom: 12,
  },
  actionBlock: {
    marginBottom: 16,
  },
  actionLabel: {
    fontSize: 10,
    fontWeight: '700',
    marginBottom: 8,
  },
  tagContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 12,
  },
  tagButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 0,
    borderWidth: 1,
    marginRight: 8,
    marginBottom: 8,
  },
  tagText: {
    fontSize: 11,
    fontWeight: '600',
  },
  notesInput: {
    borderWidth: 1,
    borderRadius: 0,
    padding: 8,
    height: 60,
    textAlignVertical: 'top',
    marginBottom: 12,
    fontSize: 13,
  },
  actionBtn: {
    height: 48,
    borderRadius: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionBtnRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  halfBtn: {
    width: '48%',
    height: 44,
    borderRadius: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
    textAlign: 'center',
  },
  queueItem: {
    paddingVertical: 10,
    borderTopWidth: 1,
  },
  queueHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  queueProfile: {
    fontWeight: '600',
  },
  queueAction: {
    fontWeight: '700',
    fontSize: 12,
  },
  queueMeta: {
    fontSize: 11,
    marginTop: 2,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 24,
  },
  modalContent: {
    borderRadius: 0,
    padding: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
  },
  modalDesc: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 16,
  },
  modalInput: {
    borderWidth: 1,
    borderRadius: 0,
    height: 44,
    paddingHorizontal: 12,
    fontSize: 14,
    marginBottom: 16,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  modalCancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: 1,
    borderRadius: 0,
    marginRight: 12,
  },
  modalCancelText: {
    fontWeight: '600',
  },
  modalConfirmBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 0,
    justifyContent: 'center',
  },
  modalConfirmText: {
    color: '#fff',
    fontWeight: '600',
  },
  typeSelector: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  typeBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 0,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 4,
  },
  typeBtnText: {
    fontSize: 11,
    fontWeight: '600',
  },
  suggestionsContainer: {
    maxHeight: 180,
    marginBottom: 16,
  },
  suggestionsTitle: {
    fontSize: 10,
    fontWeight: '700',
    marginBottom: 8,
  },
  suggestionsScroll: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 0,
  },
  suggestionRow: {
    padding: 10,
    borderBottomWidth: 1,
  },
  suggestionName: {
    fontWeight: '600',
  },
  suggestionEmail: {
    fontSize: 11,
    marginTop: 2,
  },
  cameraOverlay: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cameraFrame: {
    width: '80%',
    height: 300,
    borderColor: '#fff',
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 0,
    position: 'relative',
  },
  cameraText: {
    color: '#fff',
    fontWeight: '600',
    marginBottom: 8,
  },
  cameraSubtext: {
    color: '#999',
    fontSize: 12,
    marginBottom: 20,
  },
  laserLine: {
    height: 2,
    backgroundColor: 'red',
    width: '100%',
    position: 'absolute',
    top: 150,
  },
  simScannerInput: {
    width: '80%',
    height: 40,
    backgroundColor: '#333',
    color: '#fff',
    borderRadius: 0,
    paddingHorizontal: 12,
    textAlign: 'center',
    marginBottom: 20,
  },
  cameraCloseBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#333',
    borderRadius: 0,
  },
  cameraCloseText: {
    color: '#fff',
    fontWeight: '600',
  },
  autocompleteContainer: {
    borderWidth: 1,
    borderRadius: 0,
    marginBottom: 12,
    maxHeight: 150,
    overflow: 'scroll',
  },
  autocompleteRow: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  autocompleteText: {
    fontSize: 13,
  },
});
