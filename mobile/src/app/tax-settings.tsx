/**
 * Tax Profile & Deductions Settings Screen
 *
 * Configure tax withholding settings for net pay estimation.
 * No address collection - only state selection.
 */

import { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Animated, { FadeInDown, FadeIn } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft,
  ChevronRight,
  MapPin,
  Users,
  Calendar,
  DollarSign,
  Plus,
  Trash2,
  Check,
  X,
  Info,
  Building2,
  Percent,
  ToggleLeft,
  ToggleRight,
  AlertCircle,
} from 'lucide-react-native';
import { useTaxSettings, useStates } from '@/lib/useTax';
import {
  useTaxStore,
  FILING_STATUS_LABELS,
  PAY_FREQUENCY_LABELS,
  type FilingStatus,
  type PayFrequency,
  type Deduction,
} from '@/lib/state/tax-store';

// ============================================
// COMPONENTS
// ============================================

interface SelectModalProps {
  visible: boolean;
  title: string;
  options: Array<{ value: string; label: string; subtitle?: string }>;
  selected: string;
  onSelect: (value: string) => void;
  onClose: () => void;
}

function SelectModal({
  visible,
  title,
  options,
  selected,
  onSelect,
  onClose,
}: SelectModalProps) {
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View className="flex-1 bg-black/60">
        <Pressable className="flex-1" onPress={onClose} />
        <Animated.View
          entering={FadeIn}
          className="bg-slate-900 rounded-t-3xl"
          style={{ paddingBottom: insets.bottom + 16 }}
        >
          <View className="flex-row items-center justify-between px-5 py-4 border-b border-slate-700/50">
            <Text className="text-white text-lg font-semibold">{title}</Text>
            <Pressable onPress={onClose} className="p-2">
              <X size={20} color="#64748b" />
            </Pressable>
          </View>
          <ScrollView className="max-h-96">
            {options.map((option) => (
              <Pressable
                key={option.value}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  onSelect(option.value);
                  onClose();
                }}
                className="flex-row items-center px-5 py-4 border-b border-slate-800/50 active:bg-slate-800/50"
              >
                <View className="flex-1">
                  <Text className="text-white font-medium">{option.label}</Text>
                  {option.subtitle && (
                    <Text className="text-slate-400 text-sm mt-0.5">
                      {option.subtitle}
                    </Text>
                  )}
                </View>
                {selected === option.value && (
                  <Check size={20} color="#f59e0b" />
                )}
              </Pressable>
            ))}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

interface SettingRowProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  onPress: () => void;
  disabled?: boolean;
}

function SettingRow({
  icon,
  label,
  value,
  onPress,
  disabled,
}: SettingRowProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className="flex-row items-center justify-between py-4 px-4 active:opacity-70"
    >
      <View className="flex-row items-center flex-1">
        {icon}
        <Text className="text-white font-medium ml-3">{label}</Text>
      </View>
      <View className="flex-row items-center">
        <Text className="text-slate-400 text-sm mr-2" numberOfLines={1}>
          {value}
        </Text>
        <ChevronRight size={18} color="#64748b" />
      </View>
    </Pressable>
  );
}

interface DeductionRowProps {
  deduction: Deduction;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
}

function DeductionRow({
  deduction,
  onEdit,
  onToggle,
  onDelete,
}: DeductionRowProps) {
  const formatAmount = () => {
    if (deduction.deductionType === 'fixed') {
      return `$${(deduction.amount / 100).toFixed(2)}`;
    }
    return `${(deduction.amount / 100).toFixed(1)}%`;
  };

  return (
    <Pressable
      onPress={onEdit}
      className="flex-row items-center py-3 px-4 active:opacity-70"
    >
      <Pressable
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onToggle();
        }}
        className="mr-3"
      >
        {deduction.isEnabled ? (
          <ToggleRight size={28} color="#22c55e" />
        ) : (
          <ToggleLeft size={28} color="#64748b" />
        )}
      </Pressable>
      <View className="flex-1">
        <Text
          className={`font-medium ${deduction.isEnabled ? 'text-white' : 'text-slate-500'}`}
        >
          {deduction.name}
        </Text>
        <Text className="text-slate-500 text-xs mt-0.5">
          {formatAmount()} · {deduction.timing === 'pretax' ? 'Pre-tax' : 'Post-tax'} ·{' '}
          {deduction.frequency === 'per_paycheck' ? 'Per paycheck' : 'Monthly'}
        </Text>
      </View>
      <Pressable
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          onDelete();
        }}
        className="p-2"
      >
        <Trash2 size={18} color="#ef4444" />
      </Pressable>
    </Pressable>
  );
}

// ============================================
// DEDUCTION EDITOR MODAL
// ============================================

interface DeductionEditorProps {
  visible: boolean;
  deduction?: Deduction | null;
  onSave: (data: Omit<Deduction, 'id' | 'sortOrder'>) => void;
  onClose: () => void;
}

function DeductionEditor({
  visible,
  deduction,
  onSave,
  onClose,
}: DeductionEditorProps) {
  const insets = useSafeAreaInsets();
  const isEditing = !!deduction;

  const [name, setName] = useState(deduction?.name ?? '');
  const [deductionType, setDeductionType] = useState<'fixed' | 'percent'>(
    deduction?.deductionType ?? 'fixed'
  );
  const [amount, setAmount] = useState(
    deduction ? String(deduction.amount / 100) : ''
  );
  const [timing, setTiming] = useState<'pretax' | 'posttax'>(
    deduction?.timing ?? 'pretax'
  );
  const [frequency, setFrequency] = useState<'per_paycheck' | 'monthly'>(
    deduction?.frequency ?? 'per_paycheck'
  );

  // Reinitialize state when deduction prop changes (editing different deductions)
  useEffect(() => {
    if (visible) {
      setName(deduction?.name ?? '');
      setDeductionType(deduction?.deductionType ?? 'fixed');
      setAmount(deduction ? String(deduction.amount / 100) : '');
      setTiming(deduction?.timing ?? 'pretax');
      setFrequency(deduction?.frequency ?? 'per_paycheck');
    }
  }, [visible, deduction?.id]);

  const handleSave = () => {
    if (!name.trim()) return;
    const amountValue = parseFloat(amount) || 0;
    onSave({
      name: name.trim(),
      deductionType,
      amount: Math.round(amountValue * 100), // Convert to cents or basis points
      timing,
      frequency,
      isEnabled: deduction?.isEnabled ?? true,
    });
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View className="flex-1 bg-black/60">
        <Pressable className="flex-1" onPress={onClose} />
        <Animated.View
          entering={FadeIn}
          className="bg-slate-900 rounded-t-3xl"
          style={{ paddingBottom: insets.bottom + 16 }}
        >
          {/* Header */}
          <View className="flex-row items-center justify-between px-5 py-4 border-b border-slate-700/50">
            <Pressable onPress={onClose}>
              <Text className="text-slate-400">Cancel</Text>
            </Pressable>
            <Text className="text-white text-lg font-semibold">
              {isEditing ? 'Edit Deduction' : 'Add Deduction'}
            </Text>
            <Pressable
              onPress={handleSave}
              disabled={!name.trim()}
              className="active:opacity-70"
            >
              <Text
                className={name.trim() ? 'text-amber-500 font-semibold' : 'text-slate-600'}
              >
                Save
              </Text>
            </Pressable>
          </View>

          <ScrollView className="px-5 py-4">
            {/* Name */}
            <Text className="text-slate-400 text-sm mb-2">Name</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="e.g., 401(k), Medical, Union Dues"
              placeholderTextColor="#64748b"
              className="bg-slate-800 rounded-xl px-4 py-3 text-white mb-4"
            />

            {/* Type */}
            <Text className="text-slate-400 text-sm mb-2">Type</Text>
            <View className="flex-row mb-4">
              <Pressable
                onPress={() => setDeductionType('fixed')}
                className={`flex-1 py-3 rounded-l-xl items-center ${
                  deductionType === 'fixed' ? 'bg-amber-500' : 'bg-slate-800'
                }`}
              >
                <Text
                  className={
                    deductionType === 'fixed' ? 'text-slate-900 font-semibold' : 'text-white'
                  }
                >
                  Fixed $
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setDeductionType('percent')}
                className={`flex-1 py-3 rounded-r-xl items-center ${
                  deductionType === 'percent' ? 'bg-amber-500' : 'bg-slate-800'
                }`}
              >
                <Text
                  className={
                    deductionType === 'percent' ? 'text-slate-900 font-semibold' : 'text-white'
                  }
                >
                  % of Gross
                </Text>
              </Pressable>
            </View>

            {/* Amount */}
            <Text className="text-slate-400 text-sm mb-2">
              {deductionType === 'fixed' ? 'Amount ($)' : 'Percentage (%)'}
            </Text>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              placeholder={deductionType === 'fixed' ? '0.00' : '0.0'}
              placeholderTextColor="#64748b"
              keyboardType="decimal-pad"
              className="bg-slate-800 rounded-xl px-4 py-3 text-white mb-4"
            />

            {/* Timing */}
            <Text className="text-slate-400 text-sm mb-2">Timing</Text>
            <View className="flex-row mb-4">
              <Pressable
                onPress={() => setTiming('pretax')}
                className={`flex-1 py-3 rounded-l-xl items-center ${
                  timing === 'pretax' ? 'bg-amber-500' : 'bg-slate-800'
                }`}
              >
                <Text
                  className={
                    timing === 'pretax' ? 'text-slate-900 font-semibold' : 'text-white'
                  }
                >
                  Pre-tax
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setTiming('posttax')}
                className={`flex-1 py-3 rounded-r-xl items-center ${
                  timing === 'posttax' ? 'bg-amber-500' : 'bg-slate-800'
                }`}
              >
                <Text
                  className={
                    timing === 'posttax' ? 'text-slate-900 font-semibold' : 'text-white'
                  }
                >
                  Post-tax
                </Text>
              </Pressable>
            </View>

            {/* Frequency */}
            <Text className="text-slate-400 text-sm mb-2">Frequency</Text>
            <View className="flex-row mb-4">
              <Pressable
                onPress={() => setFrequency('per_paycheck')}
                className={`flex-1 py-3 rounded-l-xl items-center ${
                  frequency === 'per_paycheck' ? 'bg-amber-500' : 'bg-slate-800'
                }`}
              >
                <Text
                  className={
                    frequency === 'per_paycheck'
                      ? 'text-slate-900 font-semibold'
                      : 'text-white'
                  }
                >
                  Per Paycheck
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setFrequency('monthly')}
                className={`flex-1 py-3 rounded-r-xl items-center ${
                  frequency === 'monthly' ? 'bg-amber-500' : 'bg-slate-800'
                }`}
              >
                <Text
                  className={
                    frequency === 'monthly' ? 'text-slate-900 font-semibold' : 'text-white'
                  }
                >
                  Monthly
                </Text>
              </Pressable>
            </View>
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

// ============================================
// MAIN SCREEN
// ============================================

export default function TaxSettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  // Data & mutations
  const {
    profile,
    deductions,
    states,
    noTaxStates,
    isLoading,
    isUpdating,
    updateProfile,
    createDeduction,
    updateDeduction,
    deleteDeduction,
  } = useTaxSettings();

  // Local state from store
  const storeProfile = useTaxStore((s) => s.profile);
  const storeDeductions = useTaxStore((s) => s.deductions);

  // Use API data if available, otherwise store
  const currentProfile = profile ?? storeProfile;
  const currentDeductions = deductions.length > 0 ? deductions : storeDeductions;

  // Modal states
  const [stateModalVisible, setStateModalVisible] = useState(false);
  const [filingModalVisible, setFilingModalVisible] = useState(false);
  const [frequencyModalVisible, setFrequencyModalVisible] = useState(false);
  const [deductionEditorVisible, setDeductionEditorVisible] = useState(false);
  const [editingDeduction, setEditingDeduction] = useState<Deduction | null>(null);

  // Local text input state (to avoid calling API on every keystroke)
  const [extraWithholdingText, setExtraWithholdingText] = useState('');
  const [stateOverrideText, setStateOverrideText] = useState('');

  // Sync local text state when profile loads
  useEffect(() => {
    setExtraWithholdingText(
      currentProfile.extraWithholdingValue > 0
        ? String(currentProfile.extraWithholdingValue / 100)
        : ''
    );
    setStateOverrideText(
      currentProfile.stateWithholdingOverride != null
        ? String(currentProfile.stateWithholdingOverride / 100)
        : ''
    );
  }, [currentProfile.extraWithholdingValue, currentProfile.stateWithholdingOverride]);

  // State options
  const stateOptions = states.map((s) => ({
    value: s.code,
    label: s.name,
    subtitle: s.hasIncomeTax
      ? `~${((s.defaultRate ?? 0) / 100).toFixed(1)}% state tax`
      : 'No state income tax',
  }));

  // Filing status options
  const filingOptions = Object.entries(FILING_STATUS_LABELS).map(([value, label]) => ({
    value,
    label,
  }));

  // Pay frequency options
  const frequencyOptions = Object.entries(PAY_FREQUENCY_LABELS).map(
    ([value, label]) => ({
      value,
      label,
    })
  );

  // Handlers
  const handleUpdateProfile = async (updates: Record<string, unknown>) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await updateProfile(updates);
    } catch (error) {
      console.error('Failed to update profile:', error);
    }
  };

  const handleAddDeduction = () => {
    setEditingDeduction(null);
    setDeductionEditorVisible(true);
  };

  const handleEditDeduction = (deduction: Deduction) => {
    setEditingDeduction(deduction);
    setDeductionEditorVisible(true);
  };

  const handleSaveDeduction = async (
    data: Omit<Deduction, 'id' | 'sortOrder'>
  ) => {
    try {
      if (editingDeduction) {
        await updateDeduction({ id: editingDeduction.id, ...data });
      } else {
        await createDeduction(data);
      }
    } catch (error) {
      console.error('Failed to save deduction:', error);
    }
  };

  const handleToggleDeduction = async (deduction: Deduction) => {
    try {
      await updateDeduction({
        id: deduction.id,
        isEnabled: !deduction.isEnabled,
      });
    } catch (error) {
      console.error('Failed to toggle deduction:', error);
    }
  };

  const handleDeleteDeduction = async (id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await deleteDeduction(id);
    } catch (error) {
      console.error('Failed to delete deduction:', error);
    }
  };

  const isNoTaxState = noTaxStates.includes(currentProfile.stateOfResidence);

  return (
    <View className="flex-1 bg-slate-950">
      <LinearGradient
        colors={['#0f172a', '#1e3a5a', '#0f172a']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ flex: 1 }}
      >
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
            <View className="flex-row items-center mb-4">
              <Pressable
                onPress={() => router.back()}
                className="w-10 h-10 rounded-full bg-slate-800/60 items-center justify-center active:opacity-70"
              >
                <ChevronLeft size={24} color="#f59e0b" />
              </Pressable>
              <View className="flex-1 items-center">
                <DollarSign size={24} color="#f59e0b" />
              </View>
              <View className="w-10" />
            </View>

            <Text className="text-white text-3xl font-bold text-center">
              Tax Settings
            </Text>
            <Text className="text-slate-400 text-base mt-2 text-center">
              Configure withholding for net pay estimates
            </Text>
          </Animated.View>

          {/* Loading */}
          {isLoading && (
            <View className="items-center py-8">
              <ActivityIndicator size="large" color="#f59e0b" />
            </View>
          )}

          {/* Disclaimer */}
          <Animated.View
            entering={FadeInDown.duration(600).delay(150)}
            className="mx-5 mt-6"
          >
            <View className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4 flex-row">
              <Info size={18} color="#3b82f6" />
              <Text className="text-blue-300 text-sm ml-3 flex-1">
                Net pay is an estimate based on your settings. Actual withholding
                may vary. This is not tax advice.
              </Text>
            </View>
          </Animated.View>

          {/* Tax Profile Section */}
          <Animated.View
            entering={FadeInDown.duration(600).delay(200)}
            className="mx-5 mt-6"
          >
            <Text className="text-slate-400 text-sm font-semibold mb-3 uppercase tracking-wider">
              Tax Profile
            </Text>
            <View className="bg-slate-900/60 rounded-2xl border border-slate-700/50">
              {/* State */}
              <SettingRow
                icon={<MapPin size={18} color="#64748b" />}
                label="State of Residence"
                value={
                  states.find((s) => s.code === currentProfile.stateOfResidence)?.name ??
                  currentProfile.stateOfResidence
                }
                onPress={() => setStateModalVisible(true)}
              />
              {isNoTaxState && (
                <View className="mx-4 mb-3 bg-green-500/10 rounded-lg p-2.5">
                  <Text className="text-green-400 text-xs text-center">
                    No state income tax
                  </Text>
                </View>
              )}
              <View className="h-px bg-slate-700/30 mx-4" />

              {/* Filing Status */}
              <SettingRow
                icon={<Users size={18} color="#64748b" />}
                label="Filing Status"
                value={FILING_STATUS_LABELS[currentProfile.filingStatus as FilingStatus]}
                onPress={() => setFilingModalVisible(true)}
              />
              <View className="h-px bg-slate-700/30 mx-4" />

              {/* Pay Frequency */}
              <SettingRow
                icon={<Calendar size={18} color="#64748b" />}
                label="Pay Frequency"
                value={PAY_FREQUENCY_LABELS[currentProfile.payFrequency as PayFrequency]}
                onPress={() => setFrequencyModalVisible(true)}
              />
              <View className="h-px bg-slate-700/30 mx-4" />

              {/* Dependents */}
              <View className="flex-row items-center justify-between py-4 px-4">
                <View className="flex-row items-center">
                  <Users size={18} color="#64748b" />
                  <Text className="text-white font-medium ml-3">Dependents</Text>
                </View>
                <View className="flex-row items-center">
                  <Pressable
                    onPress={() =>
                      handleUpdateProfile({
                        dependents: Math.max(0, currentProfile.dependents - 1),
                      })
                    }
                    className="w-8 h-8 rounded-full bg-slate-700 items-center justify-center active:opacity-70"
                  >
                    <Text className="text-white text-lg">−</Text>
                  </Pressable>
                  <Text className="text-white font-bold mx-4 min-w-[24px] text-center">
                    {currentProfile.dependents}
                  </Text>
                  <Pressable
                    onPress={() =>
                      handleUpdateProfile({
                        dependents: currentProfile.dependents + 1,
                      })
                    }
                    className="w-8 h-8 rounded-full bg-slate-700 items-center justify-center active:opacity-70"
                  >
                    <Text className="text-white text-lg">+</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </Animated.View>

          {/* Extra Withholding Section */}
          <Animated.View
            entering={FadeInDown.duration(600).delay(250)}
            className="mx-5 mt-6"
          >
            <Text className="text-slate-400 text-sm font-semibold mb-3 uppercase tracking-wider">
              Extra Withholding (Optional)
            </Text>
            <View className="bg-slate-900/60 rounded-2xl border border-slate-700/50 p-4">
              <Text className="text-slate-400 text-sm mb-3">
                Additional federal withholding per paycheck
              </Text>
              <View className="flex-row mb-3">
                <Pressable
                  onPress={() =>
                    handleUpdateProfile({ extraWithholdingType: 'fixed' })
                  }
                  className={`flex-1 py-2.5 rounded-l-xl items-center ${
                    currentProfile.extraWithholdingType === 'fixed'
                      ? 'bg-amber-500'
                      : 'bg-slate-800'
                  }`}
                >
                  <Text
                    className={
                      currentProfile.extraWithholdingType === 'fixed'
                        ? 'text-slate-900 font-semibold'
                        : 'text-white'
                    }
                  >
                    Fixed $
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() =>
                    handleUpdateProfile({ extraWithholdingType: 'percent' })
                  }
                  className={`flex-1 py-2.5 rounded-r-xl items-center ${
                    currentProfile.extraWithholdingType === 'percent'
                      ? 'bg-amber-500'
                      : 'bg-slate-800'
                  }`}
                >
                  <Text
                    className={
                      currentProfile.extraWithholdingType === 'percent'
                        ? 'text-slate-900 font-semibold'
                        : 'text-white'
                    }
                  >
                    % of Gross
                  </Text>
                </Pressable>
              </View>
              <View className="flex-row items-center bg-slate-800 rounded-xl px-4">
                <Text className="text-slate-400 mr-2">
                  {currentProfile.extraWithholdingType === 'fixed' ? '$' : ''}
                </Text>
                <TextInput
                  value={extraWithholdingText}
                  onChangeText={setExtraWithholdingText}
                  onBlur={() => {
                    const value = parseFloat(extraWithholdingText) || 0;
                    handleUpdateProfile({
                      extraWithholdingValue: Math.round(value * 100),
                    });
                  }}
                  placeholder="0.00"
                  placeholderTextColor="#64748b"
                  keyboardType="decimal-pad"
                  className="flex-1 py-3 text-white"
                />
                {currentProfile.extraWithholdingType === 'percent' && (
                  <Text className="text-slate-400 ml-2">%</Text>
                )}
              </View>
            </View>
          </Animated.View>

          {/* Deductions Section */}
          <Animated.View
            entering={FadeInDown.duration(600).delay(300)}
            className="mx-5 mt-6"
          >
            <View className="flex-row items-center justify-between mb-3">
              <Text className="text-slate-400 text-sm font-semibold uppercase tracking-wider">
                Deductions
              </Text>
              <Pressable
                onPress={handleAddDeduction}
                className="flex-row items-center active:opacity-70"
              >
                <Plus size={16} color="#f59e0b" />
                <Text className="text-amber-500 text-sm font-semibold ml-1">
                  Add
                </Text>
              </Pressable>
            </View>

            <View className="bg-slate-900/60 rounded-2xl border border-slate-700/50">
              {currentDeductions.length === 0 ? (
                <View className="items-center py-8">
                  <Building2 size={32} color="#64748b" />
                  <Text className="text-slate-400 text-sm mt-3">
                    No deductions configured
                  </Text>
                  <Text className="text-slate-500 text-xs mt-1 text-center px-4">
                    Add 401(k), medical, union dues, etc.
                  </Text>
                </View>
              ) : (
                currentDeductions.map((deduction, index) => (
                  <View key={deduction.id}>
                    {index > 0 && <View className="h-px bg-slate-700/30 mx-4" />}
                    <DeductionRow
                      deduction={deduction}
                      onEdit={() => handleEditDeduction(deduction)}
                      onToggle={() => handleToggleDeduction(deduction)}
                      onDelete={() => handleDeleteDeduction(deduction.id)}
                    />
                  </View>
                ))
              )}
            </View>
          </Animated.View>

          {/* State Override Section (if has income tax) */}
          {!isNoTaxState && (
            <Animated.View
              entering={FadeInDown.duration(600).delay(350)}
              className="mx-5 mt-6"
            >
              <Text className="text-slate-400 text-sm font-semibold mb-3 uppercase tracking-wider">
                State Tax Override (Optional)
              </Text>
              <View className="bg-slate-900/60 rounded-2xl border border-slate-700/50 p-4">
                <Text className="text-slate-400 text-sm mb-3">
                  Override the default state withholding rate
                </Text>
                <View className="flex-row items-center bg-slate-800 rounded-xl px-4">
                  <TextInput
                    value={stateOverrideText}
                    onChangeText={setStateOverrideText}
                    onBlur={() => {
                      const value = stateOverrideText ? parseFloat(stateOverrideText) : null;
                      handleUpdateProfile({
                        stateWithholdingOverride:
                          value != null ? Math.round(value * 100) : null,
                      });
                    }}
                    placeholder={`Default: ~${(
                      (states.find((s) => s.code === currentProfile.stateOfResidence)
                        ?.defaultRate ?? 500) / 100
                    ).toFixed(1)}%`}
                    placeholderTextColor="#64748b"
                    keyboardType="decimal-pad"
                    className="flex-1 py-3 text-white"
                  />
                  <Text className="text-slate-400 ml-2">%</Text>
                </View>
              </View>
            </Animated.View>
          )}

          {/* Updating indicator */}
          {isUpdating && (
            <View className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
              <ActivityIndicator size="small" color="#f59e0b" />
            </View>
          )}
        </ScrollView>

        {/* Modals */}
        <SelectModal
          visible={stateModalVisible}
          title="Select State"
          options={stateOptions}
          selected={currentProfile.stateOfResidence}
          onSelect={(value) => handleUpdateProfile({ stateOfResidence: value })}
          onClose={() => setStateModalVisible(false)}
        />

        <SelectModal
          visible={filingModalVisible}
          title="Filing Status"
          options={filingOptions}
          selected={currentProfile.filingStatus}
          onSelect={(value) => handleUpdateProfile({ filingStatus: value })}
          onClose={() => setFilingModalVisible(false)}
        />

        <SelectModal
          visible={frequencyModalVisible}
          title="Pay Frequency"
          options={frequencyOptions}
          selected={currentProfile.payFrequency}
          onSelect={(value) => handleUpdateProfile({ payFrequency: value })}
          onClose={() => setFrequencyModalVisible(false)}
        />

        <DeductionEditor
          visible={deductionEditorVisible}
          deduction={editingDeduction}
          onSave={handleSaveDeduction}
          onClose={() => {
            setDeductionEditorVisible(false);
            setEditingDeduction(null);
          }}
        />
      </LinearGradient>
    </View>
  );
}
