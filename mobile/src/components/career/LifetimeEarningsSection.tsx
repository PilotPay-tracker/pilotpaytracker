/**
 * Lifetime Earnings Section
 *
 * Historical record of annual earnings at current airline.
 * Users can add any year and edit any existing year amount at any time.
 */

import { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  TrendingUp,
  DollarSign,
  Calendar,
  Plus,
  Trash2,
  Edit3,
  Info,
  X,
  CheckCircle,
  AlertCircle,
  Pencil,
} from "lucide-react-native";
import Animated, { FadeInDown, FadeIn } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";

// ============================================
// TYPES
// ============================================

interface LifetimeEarningsYear {
  id: string;
  year: number;
  grossEarningsCents: number;
  source: "user" | "app";
  isFinalized: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

interface LifetimeEarningsConfig {
  id: string;
  airline: string;
  startYear: number | null;
  priorYearsAdded: boolean;
  createdAt: string;
  updatedAt: string;
}

interface LifetimeEarningsSummary {
  totalCareerEarningsCents: number;
  yearsActive: number;
  averageAnnualEarningsCents: number;
  highestEarningYear: { year: number; grossEarningsCents: number } | null;
  lowestEarningYear: { year: number; grossEarningsCents: number } | null;
  currentYearEarningsCents: number;
  currentYearIsInProgress: boolean;
}

interface LifetimeEarningsResponse {
  config: LifetimeEarningsConfig | null;
  years: LifetimeEarningsYear[];
  summary: LifetimeEarningsSummary;
  airline: string;
}

// ============================================
// HOOKS
// ============================================

function useLifetimeEarnings() {
  return useQuery({
    queryKey: ["lifetime-earnings"],
    queryFn: () => api.get<LifetimeEarningsResponse>("/api/lifetime-earnings"),
  });
}

function useAddPriorYears() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (years: Array<{ year: number; grossEarningsCents: number; notes?: string }>) =>
      api.post("/api/lifetime-earnings/prior-years", { years }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lifetime-earnings"] });
    },
  });
}

function useUpdateYear() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ year, grossEarningsCents, notes }: { year: number; grossEarningsCents: number; notes?: string }) =>
      api.put(`/api/lifetime-earnings/years/${year}`, { grossEarningsCents, notes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lifetime-earnings"] });
    },
  });
}

function useDeleteYear() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (year: number) => api.delete(`/api/lifetime-earnings/years/${year}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lifetime-earnings"] });
    },
  });
}

function useSyncCurrentYear() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post("/api/lifetime-earnings/sync-current-year", {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lifetime-earnings"] });
    },
  });
}

// ============================================
// HELPERS
// ============================================

function formatCurrency(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

function formatCurrencyShort(cents: number): string {
  const dollars = cents / 100;
  if (dollars >= 1000000) return `$${(dollars / 1000000).toFixed(2)}M`;
  if (dollars >= 1000) return `$${(dollars / 1000).toFixed(0)}K`;
  return `$${dollars.toFixed(0)}`;
}

// ============================================
// EDIT / ADD YEAR MODAL
// ============================================

function EditYearModal({
  visible,
  initialYear,
  initialAmount,
  initialNotes,
  isEdit,
  existingYears,
  onClose,
  onSave,
  isLoading,
}: {
  visible: boolean;
  initialYear?: number;
  initialAmount?: number;
  initialNotes?: string;
  isEdit: boolean;
  existingYears: number[];
  onClose: () => void;
  onSave: (year: number, grossEarningsCents: number, notes?: string) => void;
  isLoading: boolean;
}) {
  const insets = useSafeAreaInsets();
  const currentYear = new Date().getFullYear();
  const [yearInput, setYearInput] = useState(
    initialYear !== undefined ? String(initialYear) : ""
  );
  const [amountInput, setAmountInput] = useState(
    initialAmount !== undefined ? String(Math.round(initialAmount / 100)) : ""
  );
  const [notesInput, setNotesInput] = useState(initialNotes ?? "");

  // Reset when modal opens
  const [prevVisible, setPrevVisible] = useState(false);
  if (visible && !prevVisible) {
    setPrevVisible(true);
    setYearInput(initialYear !== undefined ? String(initialYear) : "");
    setAmountInput(initialAmount !== undefined ? String(Math.round(initialAmount / 100)) : "");
    setNotesInput(initialNotes ?? "");
  }
  if (!visible && prevVisible) setPrevVisible(false);

  const handleSave = () => {
    const yr = parseInt(yearInput, 10);
    const amt = parseFloat(amountInput.replace(/,/g, ""));
    if (isNaN(yr) || yr < 1990 || yr > currentYear + 1) {
      Alert.alert("Invalid Year", `Please enter a year between 1990 and ${currentYear + 1}.`);
      return;
    }
    if (!isEdit && existingYears.includes(yr)) {
      Alert.alert("Year Exists", `${yr} is already in your earnings history. Use the edit button on that row.`);
      return;
    }
    if (isNaN(amt) || amt <= 0) {
      Alert.alert("Invalid Amount", "Please enter a valid earnings amount.");
      return;
    }
    onSave(yr, Math.round(amt * 100), notesInput.trim() || undefined);
  };

  return (
    <Modal visible={visible} transparent animationType="slide">
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        className="flex-1"
      >
        <Pressable className="flex-1 bg-black/60" onPress={onClose} />
        <View
          className="bg-slate-900 rounded-t-3xl"
          style={{ paddingBottom: insets.bottom + 16 }}
        >
          <View className="p-6">
            {/* Header */}
            <View className="flex-row items-center justify-between mb-5">
              <View>
                <Text className="text-white text-xl font-bold">
                  {isEdit ? "Edit Earnings" : "Add Year"}
                </Text>
                <Text className="text-slate-400 text-sm mt-0.5">
                  {isEdit ? `Editing ${initialYear}` : "Enter a year and your gross earnings"}
                </Text>
              </View>
              <Pressable
                onPress={onClose}
                className="w-10 h-10 rounded-full bg-slate-800 items-center justify-center"
              >
                <X size={20} color="#94a3b8" />
              </Pressable>
            </View>

            {/* Year input (disabled for edits) */}
            <View className="mb-4">
              <Text className="text-slate-400 text-xs mb-2 uppercase tracking-wider">Year</Text>
              <TextInput
                value={yearInput}
                onChangeText={setYearInput}
                keyboardType="numeric"
                placeholder={String(currentYear - 1)}
                placeholderTextColor="#475569"
                editable={!isEdit}
                className="bg-slate-800 rounded-xl px-4 py-4 text-white text-lg font-semibold border border-slate-700/40"
                style={{ opacity: isEdit ? 0.6 : 1 }}
                maxLength={4}
              />
              {isEdit && (
                <Text className="text-slate-500 text-xs mt-1 ml-1">Year cannot be changed after entry</Text>
              )}
            </View>

            {/* Gross earnings input */}
            <View className="mb-4">
              <Text className="text-slate-400 text-xs mb-2 uppercase tracking-wider">Gross Earnings ($)</Text>
              <View className="flex-row items-center bg-slate-800 rounded-xl border border-slate-700/40 px-4">
                <Text className="text-slate-400 text-xl font-semibold mr-1">$</Text>
                <TextInput
                  value={amountInput}
                  onChangeText={setAmountInput}
                  keyboardType="numeric"
                  placeholder="185,000"
                  placeholderTextColor="#475569"
                  className="flex-1 py-4 text-white text-xl font-semibold"
                  autoFocus={isEdit}
                />
              </View>
              <Text className="text-slate-500 text-xs mt-1 ml-1">Enter as a whole number (e.g. 245000)</Text>
            </View>

            {/* Notes (optional) */}
            <View className="mb-5">
              <Text className="text-slate-400 text-xs mb-2 uppercase tracking-wider">Notes (optional)</Text>
              <TextInput
                value={notesInput}
                onChangeText={setNotesInput}
                placeholder="e.g. First year at UPS, partial year"
                placeholderTextColor="#475569"
                className="bg-slate-800 rounded-xl px-4 py-3 text-white border border-slate-700/40"
              />
            </View>

            {/* Buttons */}
            <View className="flex-row gap-3">
              <Pressable
                onPress={onClose}
                className="flex-1 py-4 rounded-xl bg-slate-800"
              >
                <Text className="text-slate-300 text-center font-semibold">Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleSave}
                disabled={isLoading}
                className="flex-1 py-4 rounded-xl bg-amber-500"
              >
                {isLoading ? (
                  <ActivityIndicator size="small" color="#0f172a" />
                ) : (
                  <Text className="text-slate-900 text-center font-bold">
                    {isEdit ? "Save Changes" : "Add Year"}
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ============================================
// STAT CARD
// ============================================

function StatCard({
  label,
  value,
  sublabel,
  icon,
  color,
}: {
  label: string;
  value: string;
  sublabel?: string;
  icon: React.ReactNode;
  color: string;
}) {
  return (
    <View className="flex-1 bg-slate-800/60 rounded-xl p-4 border border-slate-700/50">
      <View className="flex-row items-center mb-2">
        <View
          className="w-8 h-8 rounded-lg items-center justify-center"
          style={{ backgroundColor: color + "20" }}
        >
          {icon}
        </View>
      </View>
      <Text className="text-slate-400 text-xs">{label}</Text>
      <Text className="text-white text-xl font-bold mt-1">{value}</Text>
      {sublabel && <Text className="text-slate-500 text-xs mt-1">{sublabel}</Text>}
    </View>
  );
}

// ============================================
// YEAR ROW
// ============================================

function YearRow({
  yearData,
  isHighest,
  isLowest,
  isCurrent,
  onEdit,
  onDelete,
}: {
  yearData: LifetimeEarningsYear;
  isHighest: boolean;
  isLowest: boolean;
  isCurrent: boolean;
  onEdit: () => void;
  onDelete?: () => void;
}) {
  const canDelete = yearData.source === "user" && !isCurrent;
  const canEdit = true; // always allow edit

  return (
    <View
      className={`flex-row items-center py-3 px-4 ${
        isCurrent ? "bg-amber-500/10" : isHighest ? "bg-green-500/5" : isLowest ? "bg-red-500/5" : ""
      }`}
    >
      {/* Year */}
      <View className="w-16">
        <Text className={`font-semibold text-base ${isCurrent ? "text-amber-400" : "text-white"}`}>
          {yearData.year}
        </Text>
      </View>

      {/* Earnings */}
      <View className="flex-1">
        <Text className={`font-semibold ${isHighest && !isCurrent ? "text-green-400" : isLowest && !isCurrent ? "text-red-400" : "text-white"}`}>
          {formatCurrency(yearData.grossEarningsCents)}
        </Text>
      </View>

      {/* Status badges + actions */}
      <View className="flex-row items-center gap-1.5">
        {isCurrent && (
          <View className="bg-amber-500/20 px-2 py-0.5 rounded">
            <Text className="text-amber-400 text-xs">In Progress</Text>
          </View>
        )}
        {yearData.source === "user" && (
          <View className="bg-blue-500/20 px-2 py-0.5 rounded">
            <Text className="text-blue-400 text-xs">User</Text>
          </View>
        )}
        {isHighest && !isCurrent && (
          <View className="bg-green-500/20 px-2 py-0.5 rounded">
            <Text className="text-green-400 text-xs">Highest</Text>
          </View>
        )}
        {isLowest && !isCurrent && (
          <View className="bg-red-500/20 px-2 py-0.5 rounded">
            <Text className="text-red-400 text-xs">Lowest</Text>
          </View>
        )}

        {/* Edit button — always shown */}
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onEdit();
          }}
          className="w-8 h-8 rounded-full bg-slate-700/60 items-center justify-center"
        >
          <Pencil size={14} color="#94a3b8" />
        </Pressable>

        {/* Delete button — only for user-entered non-current rows */}
        {canDelete && onDelete ? (
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              onDelete();
            }}
            className="w-8 h-8 rounded-full bg-red-500/10 items-center justify-center"
          >
            <Trash2 size={14} color="#ef4444" />
          </Pressable>
        ) : (
          <View className="w-8" />
        )}
      </View>
    </View>
  );
}

// ============================================
// MAIN COMPONENT
// ============================================

export function LifetimeEarningsSection() {
  const insets = useSafeAreaInsets();
  const currentYear = new Date().getFullYear();

  // Modal state
  const [modalVisible, setModalVisible] = useState(false);
  const [editingYear, setEditingYear] = useState<LifetimeEarningsYear | null>(null);

  const { data, isLoading, error } = useLifetimeEarnings();
  const addPriorYears = useAddPriorYears();
  const updateYear = useUpdateYear();
  const deleteYear = useDeleteYear();
  const syncCurrentYear = useSyncCurrentYear();

  // Sync on mount
  useState(() => {
    syncCurrentYear.mutate();
  });

  const openAddModal = () => {
    setEditingYear(null);
    setModalVisible(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const openEditModal = (yearData: LifetimeEarningsYear) => {
    setEditingYear(yearData);
    setModalVisible(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleSave = (year: number, grossEarningsCents: number, notes?: string) => {
    if (editingYear) {
      // Edit mode: use PUT
      updateYear.mutate(
        { year, grossEarningsCents, notes },
        {
          onSuccess: () => {
            setModalVisible(false);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          },
          onError: (err: any) => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            Alert.alert("Error", err?.message ?? "Failed to update earnings.");
          },
        }
      );
    } else {
      // Add mode: use POST prior-years endpoint (which handles upserts)
      addPriorYears.mutate(
        [{ year, grossEarningsCents, notes }],
        {
          onSuccess: () => {
            setModalVisible(false);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          },
          onError: (err: any) => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            Alert.alert("Error", err?.message ?? "Failed to add year.");
          },
        }
      );
    }
  };

  const handleDelete = (year: number) => {
    Alert.alert(
      "Delete Year",
      `Remove ${year} earnings from your history?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            deleteYear.mutate(year, {
              onError: (err: any) => {
                Alert.alert("Error", err?.message ?? "Failed to delete year.");
              },
            });
          },
        },
      ]
    );
  };

  const isSaving = addPriorYears.isPending || updateYear.isPending;
  const existingYears = data?.years.map((y) => y.year) ?? [];

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center py-20">
        <ActivityIndicator size="large" color="#f59e0b" />
        <Text className="text-slate-400 mt-4">Loading earnings...</Text>
      </View>
    );
  }

  if (error || !data) {
    return (
      <View className="flex-1 items-center justify-center py-20 px-6">
        <AlertCircle size={48} color="#ef4444" />
        <Text className="text-slate-400 text-center mt-4">
          Unable to load lifetime earnings data.
        </Text>
      </View>
    );
  }

  const { summary, years, airline } = data;

  return (
    <ScrollView
      className="flex-1"
      contentContainerStyle={{ paddingBottom: 100 }}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <Animated.View
        entering={FadeInDown.duration(600).delay(100)}
        style={{ paddingTop: insets.top + 16 }}
        className="px-5"
      >
        <View className="flex-row items-center mb-2">
          <DollarSign size={24} color="#22c55e" />
          <Text className="text-green-500 text-base font-semibold ml-2">Historical Record</Text>
        </View>
        <Text className="text-white text-3xl font-bold">Lifetime Earnings</Text>
        <Text className="text-slate-400 text-base mt-1">Career earnings at {airline}</Text>
      </Animated.View>

      {/* Trust Line */}
      <Animated.View entering={FadeInDown.duration(600).delay(150)} className="mx-5 mt-4">
        <View className="bg-green-500/10 rounded-xl px-4 py-3 border border-green-500/30">
          <View className="flex-row items-center">
            <CheckCircle size={16} color="#22c55e" />
            <Text className="text-green-400 text-sm font-medium ml-2 flex-1">
              Includes user-verified historical earnings and app-tracked totals
            </Text>
          </View>
        </View>
      </Animated.View>

      {/* Summary Stats */}
      <Animated.View entering={FadeInDown.duration(600).delay(200)} className="mx-5 mt-6">
        <Text className="text-slate-400 text-sm font-semibold mb-3 uppercase tracking-wider">
          Career Summary
        </Text>
        <View className="flex-row gap-3 mb-3">
          <StatCard
            label="Total Career Earnings"
            value={formatCurrency(summary.totalCareerEarningsCents)}
            sublabel={airline}
            icon={<DollarSign size={16} color="#22c55e" />}
            color="#22c55e"
          />
          <StatCard
            label="Years Active"
            value={summary.yearsActive.toString()}
            sublabel="at current airline"
            icon={<Calendar size={16} color="#3b82f6" />}
            color="#3b82f6"
          />
        </View>
        <View className="flex-row gap-3">
          <StatCard
            label="Average Annual"
            value={formatCurrencyShort(summary.averageAnnualEarningsCents)}
            sublabel="prior years"
            icon={<TrendingUp size={16} color="#a78bfa" />}
            color="#a78bfa"
          />
          <StatCard
            label={`${currentYear} (In Progress)`}
            value={formatCurrencyShort(summary.currentYearEarningsCents)}
            sublabel="year to date"
            icon={<DollarSign size={16} color="#f59e0b" />}
            color="#f59e0b"
          />
        </View>
      </Animated.View>

      {/* Year-by-Year Breakdown */}
      <Animated.View entering={FadeInDown.duration(600).delay(250)} className="mx-5 mt-6">
        <View className="flex-row items-center justify-between mb-3">
          <Text className="text-slate-400 text-sm font-semibold uppercase tracking-wider">
            Year-by-Year
          </Text>
          {/* Always-visible + Add Year button */}
          <Pressable
            onPress={openAddModal}
            className="flex-row items-center bg-amber-500/20 px-3 py-1.5 rounded-lg active:opacity-70"
          >
            <Plus size={14} color="#f59e0b" />
            <Text className="text-amber-400 text-sm font-medium ml-1">Add Year</Text>
          </Pressable>
        </View>

        <View className="bg-slate-900/60 rounded-2xl border border-slate-700/50 overflow-hidden">
          {/* Table header */}
          <View className="flex-row items-center py-2.5 px-4 bg-slate-800/60 border-b border-slate-700/50">
            <View className="w-16">
              <Text className="text-slate-500 text-xs font-semibold">YEAR</Text>
            </View>
            <View className="flex-1">
              <Text className="text-slate-500 text-xs font-semibold">EARNINGS</Text>
            </View>
            <View>
              <Text className="text-slate-500 text-xs font-semibold">STATUS</Text>
            </View>
          </View>

          {years.length > 0 ? (
            years.map((yearData, index) => (
              <View key={yearData.id}>
                {index > 0 && <View className="h-px bg-slate-800/60 mx-4" />}
                <YearRow
                  yearData={yearData}
                  isHighest={
                    summary.highestEarningYear?.year === yearData.year && yearData.isFinalized
                  }
                  isLowest={
                    summary.lowestEarningYear?.year === yearData.year && yearData.isFinalized
                  }
                  isCurrent={yearData.year === currentYear}
                  onEdit={() => openEditModal(yearData)}
                  onDelete={() => handleDelete(yearData.year)}
                />
              </View>
            ))
          ) : (
            <View className="py-10 items-center">
              <DollarSign size={40} color="#1e293b" />
              <Text className="text-slate-500 mt-3 text-sm">No earnings data yet</Text>
              <Pressable
                onPress={openAddModal}
                className="mt-4 bg-amber-500/20 px-5 py-2.5 rounded-xl"
              >
                <Text className="text-amber-400 font-semibold">Add Your First Year</Text>
              </Pressable>
            </View>
          )}
        </View>
      </Animated.View>

      {/* Disclaimer */}
      <Animated.View entering={FadeInDown.duration(600).delay(350)} className="mx-5 mt-6">
        <View className="bg-slate-800/40 rounded-xl p-3">
          <View className="flex-row items-start">
            <Info size={14} color="#64748b" />
            <Text className="text-slate-500 text-xs ml-2 flex-1">
              Historical years are user-verified. Current year updates automatically as you log trips and pay events.
              Use the pencil icon to correct any amount at any time. This record does not affect Career Benchmarks
              or Upgrade Simulation calculations.
            </Text>
          </View>
        </View>
      </Animated.View>

      {/* Edit / Add Modal */}
      <EditYearModal
        visible={modalVisible}
        initialYear={editingYear?.year}
        initialAmount={editingYear?.grossEarningsCents}
        initialNotes={editingYear?.notes ?? undefined}
        isEdit={editingYear !== null}
        existingYears={existingYears}
        onClose={() => setModalVisible(false)}
        onSave={handleSave}
        isLoading={isSaving}
      />
    </ScrollView>
  );
}
