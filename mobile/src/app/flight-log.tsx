/**
 * Flight Log Screen - Digital Logbook
 *
 * Displays all flights with OOOI times from live tracking.
 * Also shows prior logbook hours imported from physical/previous logbooks.
 * Grand totals combine both so this can serve as a primary logbook.
 */

import {
  View,
  Text,
  ScrollView,
  Pressable,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import {
  BookOpen,
  ChevronLeft,
  Plane,
  Clock,
  Calendar,
  TrendingUp,
  ChevronDown,
  ChevronUp,
  Plus,
  Edit3,
  Trash2,
  X,
  Check,
  Archive,
  BarChart3,
  History,
  ChevronRight,
  Info,
} from "lucide-react-native";
import Animated, {
  FadeInDown,
  FadeIn,
  useAnimatedStyle,
  withTiming,
  withSpring,
  useSharedValue,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useMemo, useState, useCallback } from "react";
import type { BackendTrip, BackendTripDutyDay, BackendTripDutyLeg } from "@/lib/useTripsData";

// ============================================
// TYPES
// ============================================

interface FlightLogEntry {
  id: string;
  date: string;
  flightNumber: string;
  origin: string;
  destination: string;
  scheduledOut: string | null;
  scheduledIn: string | null;
  actualOut: string | null;
  actualOff: string | null;
  actualOn: string | null;
  actualIn: string | null;
  blockMinutes: number;
  flightMinutes: number;
  tripNumber: string;
  hasOOOI: boolean;
}

interface TimeSummary {
  totalBlockMinutes: number;
  totalFlightMinutes: number;
  flightCount: number;
}

type TimeFilter = "week" | "month" | "year" | "all";

interface LogbookImport {
  id: string;
  label: string;
  totalBlockMinutes: number;
  totalFlightMinutes: number;
  totalFlights: number;
  notes: string | null;
  startDateISO: string | null;
  endDateISO: string | null;
  createdAt: string;
}

interface LogbookImportsResponse {
  imports: LogbookImport[];
  totals: {
    totalBlockMinutes: number;
    totalFlightMinutes: number;
    totalFlights: number;
  };
}

// ============================================
// HOOKS
// ============================================

function useFlightLog() {
  return useQuery({
    queryKey: ["flight-log"],
    queryFn: async () => {
      const response = await api.get<{ trips: BackendTrip[] }>("/api/trips");
      return response.trips;
    },
    staleTime: 1000 * 60,
  });
}

function useLogbookImports() {
  return useQuery({
    queryKey: ["logbook-imports"],
    queryFn: () => api.get<LogbookImportsResponse>("/api/logbook-imports"),
    staleTime: 1000 * 60,
  });
}

// ============================================
// HELPERS
// ============================================

function formatMinutes(minutes: number): string {
  if (!minutes || minutes < 0) return "0:00";
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}:${String(mins).padStart(2, "0")}`;
}

function formatHours(minutes: number): string {
  if (!minutes || minutes < 0) return "0";
  return String(Math.round(minutes / 60));
}

function parseHHMM(value: string): number {
  const trimmed = value.trim();
  if (trimmed.includes(":")) {
    const [h, m] = trimmed.split(":").map((s) => parseInt(s, 10) || 0);
    return h * 60 + m;
  }
  if (trimmed.includes(".")) {
    return Math.round(parseFloat(trimmed) * 60);
  }
  const n = parseInt(trimmed, 10) || 0;
  if (n >= 100) {
    const h = Math.floor(n / 100);
    const m = n % 100;
    return h * 60 + m;
  }
  return n;
}

function formatTime(isoString: string | null): string {
  if (!isoString) return "--:--";
  try {
    const date = new Date(isoString);
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return "--:--";
  }
}

function formatDate(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return isoString;
  }
}

function formatDateFull(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return isoString;
  }
}

function getWeekStart(): Date {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const diff = now.getDate() - dayOfWeek;
  return new Date(now.setDate(diff));
}

function getMonthStart(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function getYearStart(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), 0, 1);
}

// ============================================
// LOGBOOK IMPORT FORM MODAL
// ============================================

function LogbookImportModal({
  visible,
  existing,
  onClose,
  onSave,
}: {
  visible: boolean;
  existing: LogbookImport | null;
  onClose: () => void;
  onSave: (data: {
    label: string;
    totalBlockMinutes: number;
    totalFlightMinutes: number;
    totalFlights: number;
    notes: string;
    startDateISO: string;
    endDateISO: string;
  }) => void;
}) {
  const isEdit = !!existing;

  const [label, setLabel] = useState(existing?.label ?? "");
  const [blockTime, setBlockTime] = useState(
    existing ? formatMinutes(existing.totalBlockMinutes) : ""
  );
  const [flightTime, setFlightTime] = useState(
    existing ? formatMinutes(existing.totalFlightMinutes) : ""
  );
  const [flights, setFlights] = useState(
    existing ? String(existing.totalFlights) : ""
  );
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [startDate, setStartDate] = useState(existing?.startDateISO ?? "");
  const [endDate, setEndDate] = useState(existing?.endDateISO ?? "");

  const prevExisting = existing;

  const handleSave = () => {
    if (!label.trim()) {
      Alert.alert("Required", "Please enter a label for this logbook entry.");
      return;
    }
    const bm = parseHHMM(blockTime);
    const fm = parseHHMM(flightTime);
    const fc = parseInt(flights, 10) || 0;
    onSave({
      label: label.trim(),
      totalBlockMinutes: bm,
      totalFlightMinutes: fm,
      totalFlights: fc,
      notes: notes.trim(),
      startDateISO: startDate.trim(),
      endDateISO: endDate.trim(),
    });
  };

  const inputStyle = {
    backgroundColor: "#111827",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    color: "#f1f5f9",
    fontSize: 15,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.12)",
    fontWeight: "500" as const,
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1, backgroundColor: "#080d1a" }}
      >
        {/* Header */}
        <LinearGradient
          colors={["#0c1628", "#080d1a"]}
          style={{ paddingHorizontal: 20, paddingTop: 24, paddingBottom: 18, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.05)" }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <LinearGradient
                colors={["#0ea5e9", "#0284c7"]}
                style={{ width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center" }}
              >
                <Archive size={16} color="#fff" />
              </LinearGradient>
              <View>
                <Text style={{ color: "#fff", fontSize: 17, fontWeight: "700", letterSpacing: -0.3 }}>
                  {isEdit ? "Edit Prior Logbook" : "Add Prior Logbook"}
                </Text>
                <Text style={{ color: "#475569", fontSize: 12, marginTop: 1 }}>
                  {isEdit ? "Update your logbook entry" : "Import previous flight hours"}
                </Text>
              </View>
            </View>
            <Pressable onPress={onClose} style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: "rgba(255,255,255,0.06)", alignItems: "center", justifyContent: "center" }}>
              <X size={15} color="#64748b" />
            </Pressable>
          </View>
        </LinearGradient>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">

          {/* Info banner */}
          <View style={{ backgroundColor: "rgba(14,165,233,0.06)", borderRadius: 14, padding: 14, marginBottom: 24, flexDirection: "row", gap: 10, borderWidth: 1, borderColor: "rgba(14,165,233,0.18)" }}>
            <View style={{ width: 24, height: 24, borderRadius: 7, backgroundColor: "rgba(14,165,233,0.15)", alignItems: "center", justifyContent: "center", marginTop: 0 }}>
              <Info size={12} color="#38bdf8" />
            </View>
            <Text style={{ color: "#7dd3fc", fontSize: 12.5, lineHeight: 19, flex: 1 }}>
              Enter totals from previous logbooks. The app adds these to your live-tracked time for a complete career total.
            </Text>
          </View>

          {/* Label */}
          <Text style={{ color: "#64748b", fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
            Label *
          </Text>
          <TextInput
            value={label}
            onChangeText={setLabel}
            placeholder="e.g. Before UPS, Flight Training, Previous Airline"
            placeholderTextColor="#374151"
            style={{ ...inputStyle, marginBottom: 24 }}
          />

          {/* Time fields row */}
          <Text style={{ color: "#64748b", fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
            Hours (H:MM or decimal)
          </Text>
          <View style={{ flexDirection: "row", gap: 10, marginBottom: 24 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: "#374151", fontSize: 11, marginBottom: 6, fontWeight: "600" }}>Block Time</Text>
              <TextInput
                value={blockTime}
                onChangeText={setBlockTime}
                placeholder="3420:00"
                placeholderTextColor="#1f2937"
                keyboardType="numbers-and-punctuation"
                style={inputStyle}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: "#374151", fontSize: 11, marginBottom: 6, fontWeight: "600" }}>Flight Time</Text>
              <TextInput
                value={flightTime}
                onChangeText={setFlightTime}
                placeholder="3200:00"
                placeholderTextColor="#1f2937"
                keyboardType="numbers-and-punctuation"
                style={inputStyle}
              />
            </View>
          </View>

          {/* Flights count */}
          <Text style={{ color: "#64748b", fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
            Total Flights / Legs
          </Text>
          <TextInput
            value={flights}
            onChangeText={setFlights}
            placeholder="e.g. 4200"
            placeholderTextColor="#374151"
            keyboardType="number-pad"
            style={{ ...inputStyle, marginBottom: 24 }}
          />

          {/* Date range */}
          <Text style={{ color: "#64748b", fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
            Date Range (Optional)
          </Text>
          <View style={{ flexDirection: "row", gap: 10, marginBottom: 24 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: "#374151", fontSize: 11, marginBottom: 6, fontWeight: "600" }}>From</Text>
              <TextInput
                value={startDate}
                onChangeText={setStartDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#1f2937"
                style={inputStyle}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: "#374151", fontSize: 11, marginBottom: 6, fontWeight: "600" }}>To</Text>
              <TextInput
                value={endDate}
                onChangeText={setEndDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#1f2937"
                style={inputStyle}
              />
            </View>
          </View>

          {/* Notes */}
          <Text style={{ color: "#64748b", fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
            Notes (Optional)
          </Text>
          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholder="e.g. Beech 1900, regional ops, ATP time..."
            placeholderTextColor="#374151"
            multiline
            numberOfLines={3}
            style={{ ...inputStyle, marginBottom: 32, minHeight: 80, textAlignVertical: "top" }}
          />

          {/* Save */}
          <Pressable
            onPress={() => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); handleSave(); }}
          >
            <LinearGradient
              colors={["#0ea5e9", "#0284c7"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={{ borderRadius: 14, paddingVertical: 16, alignItems: "center", marginBottom: 8 }}
            >
              <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700", letterSpacing: -0.2 }}>
                {isEdit ? "Save Changes" : "Add to Logbook"}
              </Text>
            </LinearGradient>
          </Pressable>
          <Pressable onPress={onClose} style={{ paddingVertical: 14, alignItems: "center" }}>
            <Text style={{ color: "#374151", fontSize: 14 }}>Cancel</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ============================================
// PRIOR LOGBOOK SECTION
// ============================================

function PriorLogbookSection({
  importsData,
  onAdd,
  onEdit,
  onDelete,
}: {
  importsData: LogbookImportsResponse | undefined;
  onAdd: () => void;
  onEdit: (item: LogbookImport) => void;
  onDelete: (item: LogbookImport) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const imports = importsData?.imports ?? [];
  const totals = importsData?.totals;

  return (
    <Animated.View entering={FadeInDown.duration(400).delay(80)} style={{ marginBottom: 24 }}>
      {/* Section header */}
      <Pressable
        onPress={() => { setExpanded(!expanded); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
        style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: expanded ? 14 : 0 }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ width: 22, height: 22, borderRadius: 6, backgroundColor: "rgba(14,165,233,0.15)", alignItems: "center", justifyContent: "center" }}>
            <History size={12} color="#38bdf8" />
          </View>
          <Text style={{ color: "#94a3b8", fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1 }}>
            Prior Logbook
          </Text>
          {imports.length > 0 && (
            <View style={{ backgroundColor: "rgba(14,165,233,0.12)", borderRadius: 99, paddingHorizontal: 8, paddingVertical: 2, borderWidth: 1, borderColor: "rgba(14,165,233,0.2)" }}>
              <Text style={{ color: "#38bdf8", fontSize: 10, fontWeight: "700" }}>{imports.length}</Text>
            </View>
          )}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Pressable
            onPress={(e) => { e.stopPropagation(); onAdd(); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); }}
            style={{ flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "rgba(14,165,233,0.1)", borderRadius: 99, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: "rgba(14,165,233,0.25)" }}
          >
            <Plus size={11} color="#38bdf8" />
            <Text style={{ color: "#38bdf8", fontSize: 12, fontWeight: "600" }}>Add</Text>
          </Pressable>
          {expanded ? <ChevronUp size={14} color="#334155" /> : <ChevronDown size={14} color="#334155" />}
        </View>
      </Pressable>

      {expanded && (
        <>
          {imports.length === 0 ? (
            /* Empty state */
            <Pressable
              onPress={onAdd}
              style={{ borderRadius: 18, overflow: "hidden" }}
            >
              <LinearGradient
                colors={["rgba(14,165,233,0.06)", "rgba(14,165,233,0.02)"]}
                style={{ padding: 22, alignItems: "center", borderWidth: 1, borderColor: "rgba(14,165,233,0.15)", borderRadius: 18 }}
              >
                <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: "rgba(14,165,233,0.12)", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
                  <Archive size={22} color="#38bdf8" />
                </View>
                <Text style={{ color: "#e2e8f0", fontSize: 15, fontWeight: "700", marginBottom: 6, letterSpacing: -0.2 }}>
                  Import Prior Logbook
                </Text>
                <Text style={{ color: "#475569", fontSize: 13, textAlign: "center", lineHeight: 20 }}>
                  Add block time, flight time and flight count from previous logbooks to get your complete career totals.
                </Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 18, backgroundColor: "rgba(14,165,233,0.15)", borderRadius: 99, paddingHorizontal: 18, paddingVertical: 9, borderWidth: 1, borderColor: "rgba(14,165,233,0.25)" }}>
                  <Plus size={13} color="#38bdf8" />
                  <Text style={{ color: "#38bdf8", fontSize: 13, fontWeight: "600" }}>Add Prior Hours</Text>
                </View>
              </LinearGradient>
            </Pressable>
          ) : (
            <>
              {/* Summary row across all imports */}
              {totals && (
                <LinearGradient
                  colors={["rgba(14,165,233,0.1)", "rgba(7,89,133,0.08)"]}
                  style={{ borderRadius: 14, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: "rgba(56,189,248,0.18)" }}
                >
                  <View style={{ flexDirection: "row" }}>
                    {[
                      { label: "Block", value: formatHours(totals.totalBlockMinutes) },
                      { label: "Flight", value: formatHours(totals.totalFlightMinutes) },
                      { label: "Flights", value: totals.totalFlights.toLocaleString() },
                    ].map(({ label, value }, i) => (
                      <View key={label} style={{ flex: 1, alignItems: "center", borderRightWidth: i < 2 ? 1 : 0, borderRightColor: "rgba(255,255,255,0.06)" }}>
                        <Text style={{ color: "#7dd3fc", fontSize: 18, fontWeight: "800", letterSpacing: -0.5 }}>{value}</Text>
                        <Text style={{ color: "#334155", fontSize: 11, marginTop: 3, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</Text>
                      </View>
                    ))}
                  </View>
                </LinearGradient>
              )}

              {/* Import entries */}
              {imports.map((item, i) => (
                <Animated.View
                  key={item.id}
                  entering={FadeInDown.duration(300).delay(i * 50)}
                  style={{ backgroundColor: "#0d1525", borderRadius: 16, marginBottom: 8, borderWidth: 1, borderColor: "rgba(255,255,255,0.06)", overflow: "hidden" }}
                >
                  {/* Colored accent bar */}
                  <View style={{ height: 2, backgroundColor: "#0ea5e9", opacity: 0.4 }} />
                  <View style={{ padding: 15 }}>
                    <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" }}>
                      <View style={{ flex: 1, marginRight: 12 }}>
                        <Text style={{ color: "#e2e8f0", fontSize: 14.5, fontWeight: "700", marginBottom: 4, letterSpacing: -0.2 }}>
                          {item.label}
                        </Text>
                        {(item.startDateISO || item.endDateISO) && (
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 8 }}>
                            <Calendar size={10} color="#334155" />
                            <Text style={{ color: "#334155", fontSize: 11, fontWeight: "500" }}>
                              {item.startDateISO ? formatDate(item.startDateISO) : "?"} — {item.endDateISO ? formatDate(item.endDateISO) : "present"}
                            </Text>
                          </View>
                        )}
                        <View style={{ flexDirection: "row", gap: 18, marginTop: 4 }}>
                          {[
                            { label: "Block", value: formatHours(item.totalBlockMinutes) },
                            { label: "Flight", value: formatHours(item.totalFlightMinutes) },
                            { label: "Flights", value: item.totalFlights.toLocaleString() },
                          ].map(({ label, value }) => (
                            <View key={label}>
                              <Text style={{ color: "#334155", fontSize: 9.5, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: "700" }}>{label}</Text>
                              <Text style={{ color: "#94a3b8", fontSize: 14, fontWeight: "700", marginTop: 2 }}>{value}</Text>
                            </View>
                          ))}
                        </View>
                        {item.notes ? (
                          <Text style={{ color: "#334155", fontSize: 11, marginTop: 8, lineHeight: 16 }} numberOfLines={2}>{item.notes}</Text>
                        ) : null}
                      </View>

                      {/* Actions */}
                      <View style={{ flexDirection: "row", gap: 6 }}>
                        <Pressable
                          onPress={() => { onEdit(item); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                          style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: "rgba(148,163,184,0.08)", alignItems: "center", justifyContent: "center" }}
                        >
                          <Edit3 size={13} color="#64748b" />
                        </Pressable>
                        <Pressable
                          onPress={() => { onDelete(item); }}
                          style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: "rgba(239,68,68,0.08)", alignItems: "center", justifyContent: "center" }}
                        >
                          <Trash2 size={13} color="#ef4444" />
                        </Pressable>
                      </View>
                    </View>
                  </View>
                </Animated.View>
              ))}
            </>
          )}
        </>
      )}
    </Animated.View>
  );
}

// ============================================
// GRAND TOTALS BANNER (live + prior combined)
// ============================================

function GrandTotalsBanner({
  liveSummary,
  priorTotals,
}: {
  liveSummary: TimeSummary;
  priorTotals: { totalBlockMinutes: number; totalFlightMinutes: number; totalFlights: number } | undefined;
}) {
  const combinedBlock = liveSummary.totalBlockMinutes + (priorTotals?.totalBlockMinutes ?? 0);
  const combinedFlight = liveSummary.totalFlightMinutes + (priorTotals?.totalFlightMinutes ?? 0);
  const combinedFlights = liveSummary.flightCount + (priorTotals?.totalFlights ?? 0);
  const hasPrior = (priorTotals?.totalBlockMinutes ?? 0) > 0;

  return (
    <Animated.View entering={FadeInDown.duration(500)} style={{ marginBottom: 14 }}>
      <LinearGradient
        colors={["#0c3460", "#0a2540", "#071c35"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ borderRadius: 22, overflow: "hidden", borderWidth: 1, borderColor: "rgba(56,189,248,0.18)" }}
      >
        {/* Top accent shimmer */}
        <LinearGradient
          colors={["rgba(56,189,248,0.25)", "transparent"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={{ height: 1 }}
        />

        <View style={{ padding: 22 }}>
          {/* Label row */}
          <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: "#4d7fa8", fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 6 }}>
                {hasPrior ? "Career Total · Live + Prior" : "Total Block Time"}
              </Text>
              <Text style={{ color: "#fff", fontSize: 42, fontWeight: "800", letterSpacing: -2, lineHeight: 46 }}>
                {formatHours(combinedBlock)}
              </Text>
              <Text style={{ color: "#4d7fa8", fontSize: 12, marginTop: 4 }}>hours block time</Text>
            </View>
            <View style={{ width: 46, height: 46, borderRadius: 15, backgroundColor: "rgba(56,189,248,0.12)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(56,189,248,0.2)" }}>
              <BarChart3 size={22} color="#38bdf8" />
            </View>
          </View>

          {/* Divider */}
          <View style={{ height: 1, backgroundColor: "rgba(255,255,255,0.05)", marginBottom: 18 }} />

          {/* Stats row */}
          <View style={{ flexDirection: "row", gap: 4 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: "#2d5a7a", fontSize: 10, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4 }}>Flight Time</Text>
              <Text style={{ color: "#7dd3fc", fontSize: 22, fontWeight: "800", letterSpacing: -1 }}>
                {formatHours(combinedFlight)}
              </Text>
            </View>
            <View style={{ width: 1, backgroundColor: "rgba(255,255,255,0.04)", marginHorizontal: 4 }} />
            <View style={{ flex: 1, paddingLeft: 12 }}>
              <Text style={{ color: "#2d5a7a", fontSize: 10, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4 }}>Total Flights</Text>
              <Text style={{ color: "#e2e8f0", fontSize: 22, fontWeight: "800", letterSpacing: -1 }}>
                {combinedFlights.toLocaleString()}
              </Text>
            </View>
          </View>

          {/* Prior contribution strip */}
          {hasPrior && (
            <View style={{ marginTop: 18, paddingTop: 14, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.04)", flexDirection: "row", gap: 16 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: "#38bdf8" }} />
                <Text style={{ color: "#2d5a7a", fontSize: 11, fontWeight: "500" }}>
                  Live: {formatHours(liveSummary.totalBlockMinutes)} · {liveSummary.flightCount} flights
                </Text>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: "#1e3a4f" }} />
                <Text style={{ color: "#2d5a7a", fontSize: 11, fontWeight: "500" }}>
                  Prior: {formatHours(priorTotals?.totalBlockMinutes ?? 0)}
                </Text>
              </View>
            </View>
          )}
        </View>
      </LinearGradient>
    </Animated.View>
  );
}

// ============================================
// SUMMARY CARD (filter pill)
// ============================================

function SummaryCard({
  label,
  blockTime,
  flightTime,
  flightCount,
  isActive,
  onPress,
}: {
  label: string;
  blockTime: string;
  flightTime: string;
  flightCount: number;
  isActive: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onPress(); }}
      style={{ flex: 1 }}
    >
      <LinearGradient
        colors={isActive ? ["rgba(14,165,233,0.18)", "rgba(14,165,233,0.08)"] : ["rgba(13,21,37,0.9)", "rgba(10,15,30,0.9)"]}
        style={{
          borderRadius: 14,
          padding: 13,
          borderWidth: 1,
          borderColor: isActive ? "rgba(56,189,248,0.45)" : "rgba(255,255,255,0.05)",
        }}
      >
        <Text style={{ color: isActive ? "#38bdf8" : "#2d4a5e", fontSize: 9.5, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, marginBottom: 7 }}>
          {label}
        </Text>
        <Text style={{ color: isActive ? "#fff" : "#64748b", fontSize: 17, fontWeight: "800", letterSpacing: -0.5 }}>{blockTime}</Text>
        <Text style={{ color: isActive ? "rgba(56,189,248,0.6)" : "#1e2d3d", fontSize: 10.5, marginTop: 3, fontWeight: "500" }}>
          {flightCount} {flightCount !== 1 ? "flights" : "flight"}
        </Text>
      </LinearGradient>
    </Pressable>
  );
}

// ============================================
// FLIGHT ENTRY ROW
// ============================================

function FlightEntryRow({
  entry,
  index,
  isExpanded,
  onToggle,
}: {
  entry: FlightLogEntry;
  index: number;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const expandedHeight = useSharedValue(isExpanded ? 1 : 0);

  const animatedStyle = useAnimatedStyle(() => ({
    height: withTiming(expandedHeight.value * 118, { duration: 220 }),
    opacity: withTiming(expandedHeight.value, { duration: 200 }),
  }));

  expandedHeight.value = isExpanded ? 1 : 0;

  return (
    <Animated.View entering={FadeInDown.duration(400).delay(index * 25)} style={{ marginBottom: 8 }}>
      <Pressable
        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onToggle(); }}
        style={{
          backgroundColor: "#0d1525",
          borderRadius: 16,
          borderWidth: 1,
          borderColor: isExpanded ? "rgba(56,189,248,0.22)" : "rgba(255,255,255,0.055)",
          overflow: "hidden",
          opacity: entry.hasOOOI ? 1 : 0.7,
        }}
      >
        {/* Main Row */}
        <View style={{ padding: 14 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            {/* Left: icon + flight number */}
            <View style={{ flexDirection: "row", alignItems: "center", flex: 1 }}>
              <LinearGradient
                colors={entry.hasOOOI ? ["rgba(14,165,233,0.22)", "rgba(7,89,133,0.12)"] : ["rgba(30,41,59,0.6)", "rgba(15,23,42,0.4)"]}
                style={{ width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: entry.hasOOOI ? "rgba(56,189,248,0.2)" : "rgba(255,255,255,0.04)" }}
              >
                <Plane size={17} color={entry.hasOOOI ? "#38bdf8" : "#334155"} />
              </LinearGradient>
              <View style={{ marginLeft: 11 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={{ color: "#e2e8f0", fontWeight: "700", fontSize: 14, letterSpacing: -0.3 }}>
                    {entry.flightNumber || "----"}
                  </Text>
                  {entry.hasOOOI && (
                    <View style={{ backgroundColor: "rgba(34,197,94,0.12)", borderRadius: 5, paddingHorizontal: 5, paddingVertical: 2, borderWidth: 1, borderColor: "rgba(34,197,94,0.2)" }}>
                      <Text style={{ color: "#4ade80", fontSize: 8.5, fontWeight: "800", letterSpacing: 0.5 }}>OOOI</Text>
                    </View>
                  )}
                </View>
                <Text style={{ color: "#2d4a5e", fontSize: 11, marginTop: 2, fontWeight: "500" }}>{formatDate(entry.date)}</Text>
              </View>
            </View>

            {/* Center: route */}
            <View style={{ alignItems: "center" }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <Text style={{ color: "#64748b", fontWeight: "700", fontSize: 13, letterSpacing: 0.5 }}>
                  {entry.origin || "---"}
                </Text>
                <View style={{ width: 20, height: 1, backgroundColor: "rgba(100,116,139,0.3)" }} />
                <Text style={{ color: "#64748b", fontWeight: "700", fontSize: 13, letterSpacing: 0.5 }}>
                  {entry.destination || "---"}
                </Text>
              </View>
            </View>

            {/* Right: block time + chevron */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginLeft: 12 }}>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={{ color: "#e2e8f0", fontWeight: "800", fontSize: 15, letterSpacing: -0.5 }}>{formatMinutes(entry.blockMinutes)}</Text>
                <Text style={{ color: "#1e3a4f", fontSize: 9.5, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 }}>Block</Text>
              </View>
              <View style={{ width: 22, height: 22, borderRadius: 7, backgroundColor: "rgba(255,255,255,0.04)", alignItems: "center", justifyContent: "center" }}>
                {isExpanded ? <ChevronUp size={12} color="#334155" /> : <ChevronDown size={12} color="#334155" />}
              </View>
            </View>
          </View>
        </View>

        {/* Expanded Details */}
        {isExpanded && (
          <Animated.View style={animatedStyle}>
            <View style={{ paddingHorizontal: 14, paddingBottom: 14, borderTopWidth: 1, borderTopColor: "rgba(56,189,248,0.07)", paddingTop: 13 }}>
              {/* OOOI grid */}
              <View style={{ flexDirection: "row", gap: 6, marginBottom: 12 }}>
                {[
                  { label: "Out", value: formatTime(entry.actualOut) },
                  { label: "Off", value: formatTime(entry.actualOff) },
                  { label: "On",  value: formatTime(entry.actualOn) },
                  { label: "In",  value: formatTime(entry.actualIn) },
                ].map(({ label, value }) => (
                  <View key={label} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.3)", borderRadius: 10, padding: 9, borderWidth: 1, borderColor: "rgba(255,255,255,0.03)" }}>
                    <Text style={{ color: "#1e3a4f", fontSize: 8.5, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: "700" }}>{label}</Text>
                    <Text style={{ color: "#94a3b8", fontWeight: "700", fontSize: 13, marginTop: 3 }}>{value}</Text>
                  </View>
                ))}
              </View>

              {/* Times summary */}
              <View style={{ flexDirection: "row", gap: 14 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Clock size={11} color="#1e3a4f" />
                  <Text style={{ color: "#2d4a5e", fontSize: 11, fontWeight: "500" }}>Block: {formatMinutes(entry.blockMinutes)}</Text>
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Plane size={11} color="#1e3a4f" />
                  <Text style={{ color: "#2d4a5e", fontSize: 11, fontWeight: "500" }}>Flight: {formatMinutes(entry.flightMinutes)}</Text>
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Calendar size={11} color="#1e3a4f" />
                  <Text style={{ color: "#2d4a5e", fontSize: 11, fontWeight: "500" }}>Trip {entry.tripNumber}</Text>
                </View>
              </View>
            </View>
          </Animated.View>
        )}
      </Pressable>
    </Animated.View>
  );
}

// ============================================
// TOTALS HEADER (filter pills)
// ============================================

function TotalsHeader({
  summary,
  filter,
  onFilterChange,
}: {
  summary: Record<TimeFilter, TimeSummary>;
  filter: TimeFilter;
  onFilterChange: (filter: TimeFilter) => void;
}) {
  return (
    <View style={{ flexDirection: "row", gap: 8, marginBottom: 24 }}>
      {(["week", "month", "year"] as TimeFilter[]).map((key) => (
        <SummaryCard
          key={key}
          label={key === "week" ? "This Week" : key === "month" ? "This Month" : "This Year"}
          blockTime={formatHours(summary[key].totalBlockMinutes)}
          flightTime={formatHours(summary[key].totalFlightMinutes)}
          flightCount={summary[key].flightCount}
          isActive={filter === key}
          onPress={() => onFilterChange(key)}
        />
      ))}
    </View>
  );
}

// ============================================
// MAIN SCREEN
// ============================================

export default function FlightLogScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: trips, isLoading: tripsLoading } = useFlightLog();
  const { data: importsData, isLoading: importsLoading } = useLogbookImports();

  const [timeFilter, setTimeFilter] = useState<TimeFilter>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [editingImport, setEditingImport] = useState<LogbookImport | null>(null);

  // ── Mutations ──────────────────────────────────────────────────────────────

  const { mutate: createImportMutate } = useMutation({
    mutationFn: (data: object) => api.post("/api/logbook-imports", data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["logbook-imports"] }); setShowImportModal(false); },
  });

  const { mutate: updateImportMutate } = useMutation({
    mutationFn: ({ id, data }: { id: string; data: object }) => api.put(`/api/logbook-imports/${id}`, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["logbook-imports"] }); setEditingImport(null); },
  });

  const { mutate: deleteImportMutate } = useMutation({
    mutationFn: (id: string) => api.delete(`/api/logbook-imports/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["logbook-imports"] }),
  });

  // ── Flight entries from live tracking ──────────────────────────────────────

  const flightEntries = useMemo<FlightLogEntry[]>(() => {
    if (!trips) return [];
    const entries: FlightLogEntry[] = [];
    trips.forEach((trip) => {
      const dutyDays = trip.tripDutyDays || [];
      dutyDays.forEach((dutyDay: BackendTripDutyDay) => {
        dutyDay.legs.forEach((leg: BackendTripDutyLeg) => {
          if (leg.isDeadhead) return;
          const hasOOOI = !!(leg.actualOutISO && leg.actualOffISO && leg.actualOnISO && leg.actualInISO);
          let flightMinutes = 0;
          if (leg.actualOffISO && leg.actualOnISO) {
            flightMinutes = Math.max(0, Math.round((new Date(leg.actualOnISO).getTime() - new Date(leg.actualOffISO).getTime()) / 60000));
          }
          let blockMinutes = leg.actualBlockMinutes || leg.plannedBlockMinutes || 0;
          if (leg.actualOutISO && leg.actualInISO) {
            blockMinutes = Math.max(0, Math.round((new Date(leg.actualInISO).getTime() - new Date(leg.actualOutISO).getTime()) / 60000));
          }
          entries.push({
            id: leg.id,
            date: dutyDay.dutyDate,
            flightNumber: leg.flightNumber || "",
            origin: leg.origin || "",
            destination: leg.destination || "",
            scheduledOut: leg.scheduledOutISO,
            scheduledIn: leg.scheduledInISO,
            actualOut: leg.actualOutISO,
            actualOff: leg.actualOffISO,
            actualOn: leg.actualOnISO,
            actualIn: leg.actualInISO,
            blockMinutes,
            flightMinutes,
            tripNumber: trip.tripNumber || "Unknown",
            hasOOOI,
          });
        });
      });
    });
    entries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return entries;
  }, [trips]);

  // ── Time summaries ─────────────────────────────────────────────────────────

  const summaries = useMemo<Record<TimeFilter, TimeSummary>>(() => {
    const weekStart = getWeekStart();
    const monthStart = getMonthStart();
    const yearStart = getYearStart();
    const calc = (arr: FlightLogEntry[]): TimeSummary => ({
      totalBlockMinutes: arr.reduce((s, e) => s + e.blockMinutes, 0),
      totalFlightMinutes: arr.reduce((s, e) => s + e.flightMinutes, 0),
      flightCount: arr.length,
    });
    const byDate = (arr: FlightLogEntry[], start: Date) => arr.filter((e) => new Date(e.date) >= start);
    return {
      week: calc(byDate(flightEntries, weekStart)),
      month: calc(byDate(flightEntries, monthStart)),
      year: calc(byDate(flightEntries, yearStart)),
      all: calc(flightEntries),
    };
  }, [flightEntries]);

  const filteredEntries = useMemo<FlightLogEntry[]>(() => {
    if (timeFilter === "all") return flightEntries;
    const startDate = timeFilter === "week" ? getWeekStart() : timeFilter === "month" ? getMonthStart() : getYearStart();
    return flightEntries.filter((e) => new Date(e.date) >= startDate);
  }, [flightEntries, timeFilter]);

  const handleToggleExpand = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  const handleSaveImport = useCallback((data: {
    label: string;
    totalBlockMinutes: number;
    totalFlightMinutes: number;
    totalFlights: number;
    notes: string;
    startDateISO: string;
    endDateISO: string;
  }) => {
    const payload = {
      label: data.label,
      totalBlockMinutes: data.totalBlockMinutes,
      totalFlightMinutes: data.totalFlightMinutes,
      totalFlights: data.totalFlights,
      notes: data.notes || undefined,
      startDateISO: data.startDateISO || undefined,
      endDateISO: data.endDateISO || undefined,
    };
    if (editingImport) {
      updateImportMutate({ id: editingImport.id, data: payload });
    } else {
      createImportMutate(payload);
    }
  }, [editingImport, createImportMutate, updateImportMutate]);

  const handleDeleteImport = useCallback((item: LogbookImport) => {
    Alert.alert(
      "Delete Logbook Entry",
      `Remove "${item.label}"? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); deleteImportMutate(item.id); },
        },
      ]
    );
  }, [deleteImportMutate]);

  const isLoading = tripsLoading || importsLoading;

  return (
    <View style={{ flex: 1, backgroundColor: "#050a14" }}>
      <LinearGradient
        colors={["#08112a", "#050c1e", "#040914"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={{ flex: 1 }}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 100 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <Animated.View entering={FadeInDown.duration(500)} style={{ paddingTop: insets.top + 10, paddingHorizontal: 20 }}>
            <Pressable
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.back(); }}
              style={{ flexDirection: "row", alignItems: "center", marginBottom: 20, gap: 4 }}
            >
              <ChevronLeft size={18} color="#2d4a5e" />
              <Text style={{ color: "#2d4a5e", fontSize: 14, fontWeight: "600" }}>Tools</Text>
            </Pressable>

            {/* Title row */}
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 28, gap: 14 }}>
              <LinearGradient
                colors={["rgba(14,165,233,0.25)", "rgba(7,89,133,0.15)"]}
                style={{ width: 50, height: 50, borderRadius: 16, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(56,189,248,0.2)" }}
              >
                <BookOpen size={22} color="#38bdf8" />
              </LinearGradient>
              <View>
                <Text style={{ color: "#fff", fontSize: 26, fontWeight: "800", letterSpacing: -1, lineHeight: 30 }}>Flight Log</Text>
                <Text style={{ color: "#1e3a4f", fontSize: 12.5, marginTop: 3, fontWeight: "500" }}>Digital logbook · OOOI tracking</Text>
              </View>
            </View>
          </Animated.View>

          {/* Content */}
          <Animated.View entering={FadeInDown.duration(500).delay(60)} style={{ paddingHorizontal: 20 }}>
            {isLoading ? (
              <View style={{ alignItems: "center", justifyContent: "center", paddingVertical: 80 }}>
                <Text style={{ color: "#1e3a4f", fontSize: 14, fontWeight: "500" }}>Loading logbook...</Text>
              </View>
            ) : (
              <>
                {/* Grand Totals Banner */}
                <GrandTotalsBanner
                  liveSummary={summaries.all}
                  priorTotals={importsData?.totals}
                />

                {/* Filter pills */}
                <TotalsHeader
                  summary={summaries}
                  filter={timeFilter}
                  onFilterChange={setTimeFilter}
                />

                {/* Prior Logbook Section */}
                <PriorLogbookSection
                  importsData={importsData}
                  onAdd={() => { setEditingImport(null); setShowImportModal(true); }}
                  onEdit={(item) => { setEditingImport(item); setShowImportModal(true); }}
                  onDelete={handleDeleteImport}
                />

                {/* Live Flight List */}
                <View>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <View style={{ width: 22, height: 22, borderRadius: 6, backgroundColor: "rgba(14,165,233,0.12)", alignItems: "center", justifyContent: "center" }}>
                        <Plane size={12} color="#38bdf8" />
                      </View>
                      <Text style={{ color: "#94a3b8", fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1 }}>
                        {timeFilter === "all" ? "Live Tracked Flights" : `This ${timeFilter.charAt(0).toUpperCase() + timeFilter.slice(1)}`}
                      </Text>
                    </View>
                    <View style={{ backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 99, paddingHorizontal: 10, paddingVertical: 4 }}>
                      <Text style={{ color: "#2d4a5e", fontSize: 11, fontWeight: "600" }}>
                        {filteredEntries.length} {filteredEntries.length !== 1 ? "flights" : "flight"}
                      </Text>
                    </View>
                  </View>

                  {filteredEntries.length === 0 ? (
                    <View style={{ alignItems: "center", paddingVertical: 44, backgroundColor: "rgba(13,21,37,0.6)", borderRadius: 18, borderWidth: 1, borderColor: "rgba(255,255,255,0.04)" }}>
                      <View style={{ width: 60, height: 60, borderRadius: 18, backgroundColor: "rgba(13,21,37,0.9)", alignItems: "center", justifyContent: "center", marginBottom: 14, borderWidth: 1, borderColor: "rgba(255,255,255,0.04)" }}>
                        <Plane size={24} color="#1e2d3d" />
                      </View>
                      <Text style={{ color: "#64748b", fontSize: 15, fontWeight: "700", marginBottom: 6, letterSpacing: -0.2 }}>
                        No Flights Yet
                      </Text>
                      <Text style={{ color: "#1e3a4f", fontSize: 13, textAlign: "center", paddingHorizontal: 28, lineHeight: 20 }}>
                        Capture OOOI times from your trips to build your live logbook.
                      </Text>
                    </View>
                  ) : (
                    filteredEntries.map((entry, index) => (
                      <FlightEntryRow
                        key={entry.id}
                        entry={entry}
                        index={index}
                        isExpanded={expandedId === entry.id}
                        onToggle={() => handleToggleExpand(entry.id)}
                      />
                    ))
                  )}
                </View>
              </>
            )}
          </Animated.View>
        </ScrollView>
      </LinearGradient>

      {/* Import / Edit Modal */}
      {(showImportModal || editingImport !== null) && (
        <LogbookImportModal
          visible={showImportModal || editingImport !== null}
          existing={editingImport}
          onClose={() => { setShowImportModal(false); setEditingImport(null); }}
          onSave={handleSaveImport}
        />
      )}
    </View>
  );
}
