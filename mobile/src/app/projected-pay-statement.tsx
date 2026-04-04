/**
 * Projected Pay Statement Screen
 *
 * UPS-style pay statement layout with Pilot Pay Tracker branding.
 * Uses the tax/deduction estimator for net pay calculation.
 * Includes AI-powered explanations for each section.
 */

import { useState, useMemo, useEffect } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Animated, { FadeInDown, FadeIn } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft,
  FileText,
  Plane,
  AlertCircle,
  Info,
  Share2,
  Sparkles,
} from 'lucide-react-native';
import { useProfile } from '@/lib/state/profile-store';
import { useDashboard } from '@/lib/useFlightData';
import { usePayEvents } from '@/lib/usePayEvents';
import { useCalculateNetPay } from '@/lib/useTax';
import { useTaxProfile, useDeductions } from '@/lib/useTax';
import { useTaxStore, FILING_STATUS_LABELS, type TaxBreakdown } from '@/lib/state/tax-store';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useSession } from '@/lib/useSession';
import { PayExplanationModal } from '@/components/PayExplanationModal';
import { useUserBenchmarkComparison } from '@/lib/usePayBenchmarks';
import type { PayExplanationSection, PayExplanationRequest } from '@/lib/usePayExplanation';

// ============================================
// HELPERS
// ============================================

function formatCentsAsCurrency(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDecimalHours(minutes: number): string {
  return (minutes / 60).toFixed(2);
}

function formatDate(dateISO: string): string {
  const date = new Date(dateISO + 'T12:00:00');
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function getCurrentDateFormatted(): string {
  return new Date().toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// ============================================
// HOOKS
// ============================================

interface ProfileStatsResponse {
  allTime: { totalPayCents: number };
  currentYear: { totalPayCents: number; year: number };
  currentMonth: { totalPayCents: number; month: string };
}

function useProfileStats() {
  const { data: session } = useSession();
  const isAuthenticated = !!session?.user;

  return useQuery({
    queryKey: ['profile-stats'],
    queryFn: () => api.get<ProfileStatsResponse>('/api/profile/stats'),
    enabled: isAuthenticated,
  });
}

// ============================================
// COMPONENTS
// ============================================

// Statement Section Header with optional explain button
function SectionHeader({
  title,
  section,
  onExplain,
}: {
  title: string;
  section?: PayExplanationSection;
  onExplain?: (section: PayExplanationSection) => void;
}) {
  return (
    <View className="bg-slate-700/50 px-4 py-2 border-b border-slate-600/50 flex-row items-center justify-between">
      <Text className="text-slate-300 text-xs font-bold uppercase tracking-wider">
        {title}
      </Text>
      {section && onExplain && (
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onExplain(section);
          }}
          hitSlop={8}
          className="flex-row items-center active:opacity-70"
        >
          <Info size={14} color="#f59e0b" />
        </Pressable>
      )}
    </View>
  );
}

// Line Item Row
function LineItem({
  label,
  units,
  rate,
  amount,
  isDeduction = false,
  isTotal = false,
  isMuted = false,
}: {
  label: string;
  units?: string;
  rate?: string;
  amount: number;
  isDeduction?: boolean;
  isTotal?: boolean;
  isMuted?: boolean;
}) {
  return (
    <View
      className={`flex-row items-center px-4 py-2 ${
        isTotal ? 'bg-slate-800/30' : ''
      } border-b border-slate-700/30`}
    >
      <View className="flex-1">
        <Text
          className={`${
            isTotal
              ? 'text-white font-bold'
              : isMuted
                ? 'text-slate-500'
                : 'text-slate-300'
          } text-sm`}
        >
          {label}
        </Text>
      </View>
      {units && (
        <Text className="text-slate-400 text-xs w-16 text-right mr-2">
          {units}
        </Text>
      )}
      {rate && (
        <Text className="text-slate-400 text-xs w-20 text-right mr-2">{rate}</Text>
      )}
      <Text
        className={`w-24 text-right ${
          isTotal
            ? 'text-white font-bold'
            : isDeduction
              ? 'text-red-400'
              : isMuted
                ? 'text-slate-500'
                : 'text-green-400'
        } text-sm font-medium`}
      >
        {isDeduction && amount > 0 ? '-' : ''}
        {formatCentsAsCurrency(Math.abs(amount))}
      </Text>
    </View>
  );
}

// Net Pay Summary Box with explain option
function NetPayBox({
  netPayCents,
  onExplain,
}: {
  netPayCents: number;
  onExplain?: () => void;
}) {
  return (
    <Pressable
      onPress={onExplain}
      disabled={!onExplain}
      className="mx-4 my-4 bg-green-500/10 border-2 border-green-500/50 rounded-xl p-4 active:opacity-80"
    >
      <View className="flex-row items-center justify-center mb-1">
        <Text className="text-green-400 text-sm font-semibold text-center">
          NET PAY (ESTIMATED)
        </Text>
        {onExplain && (
          <Pressable
            onPress={onExplain}
            hitSlop={8}
            className="ml-2"
          >
            <Info size={14} color="#4ade80" />
          </Pressable>
        )}
      </View>
      <Text className="text-green-400 text-3xl font-bold text-center">
        {formatCentsAsCurrency(netPayCents)}
      </Text>
    </Pressable>
  );
}

// ============================================
// MAIN SCREEN
// ============================================

export default function ProjectedPayStatementScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const profile = useProfile();

  // AI Explanation modal state
  const [explanationModalVisible, setExplanationModalVisible] = useState(false);
  const [selectedSection, setSelectedSection] = useState<PayExplanationSection>('FULL_STATEMENT');

  // Data hooks
  const { data: dashboard, isLoading: dashboardLoading } = useDashboard();
  const { data: payEventsData } = usePayEvents({
    startDate: dashboard?.periodStart,
    endDate: dashboard?.periodEnd,
  });
  const { data: taxProfile } = useTaxProfile();
  const { data: deductions } = useDeductions();
  const { data: stats } = useProfileStats();
  const { data: benchmarkComparison } = useUserBenchmarkComparison();

  // Tax calculation
  const calculateNetPayMutation = useCalculateNetPay();
  const lastBreakdown = useTaxStore((s) => s.lastBreakdown);

  // Calculate taxes when data is ready
  useEffect(() => {
    if (dashboard?.totalPayCents) {
      calculateNetPayMutation.mutate({
        grossPayCents: dashboard.totalPayCents,
        ytdWagesCents: stats?.currentYear.totalPayCents ?? 0,
      });
    }
  }, [dashboard?.totalPayCents, stats?.currentYear.totalPayCents]);

  const breakdown = lastBreakdown;
  const isLoading = dashboardLoading || calculateNetPayMutation.isPending;

  // Calculate pay components
  const hourlyRate = (profile?.hourlyRateCents ?? 0) / 100;
  const creditHours = (dashboard?.totalCreditMinutes ?? 0) / 60;
  const blockHours = (dashboard?.totalBlockMinutes ?? 0) / 60;
  const basePay = Math.round(creditHours * hourlyRate * 100);
  const overageMinutes = Math.max(
    0,
    (dashboard?.totalBlockMinutes ?? 0) - (dashboard?.totalCreditMinutes ?? 0)
  );
  const overagePay = Math.round((overageMinutes / 60) * hourlyRate * 100);

  // Pilot name
  const pilotName = profile
    ? `${profile.firstName ?? ''} ${profile.lastName ?? ''}`.trim()
    : 'Pilot';

  // Calculate year of service for benchmark context
  const yearOfService = useMemo(() => {
    if (!profile?.dateOfHire) return 1;
    const hireDate = new Date(profile.dateOfHire);
    const now = new Date();
    return Math.max(1, Math.floor((now.getTime() - hireDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000)) + 1);
  }, [profile?.dateOfHire]);

  // Build explanation request data
  const explanationRequest: Omit<PayExplanationRequest, 'section'> = useMemo(() => ({
    projectedData: {
      grossPayCents: dashboard?.totalPayCents ?? 0,
      netPayCents: breakdown?.netPayCents,
      creditMinutes: dashboard?.totalCreditMinutes ?? 0,
      blockMinutes: dashboard?.totalBlockMinutes ?? 0,
      hourlyRateCents: profile?.hourlyRateCents ?? 0,
      federalWithholdingCents: breakdown?.federalWithholdingCents,
      stateWithholdingCents: breakdown?.stateWithholdingCents,
      socialSecurityCents: breakdown?.socialSecurityCents,
      medicareCents: breakdown?.medicareCents,
      pretaxDeductionsCents: breakdown?.pretaxDeductionsCents,
      posttaxDeductionsCents: breakdown?.posttaxDeductionsCents,
      perDiemCents: (dashboard as any)?.totalPdiemCents,
    },
    context: {
      airline: profile?.airline ?? 'UPS',
      position: profile?.position ?? 'FO',
      yearOfService,
      filingStatus: taxProfile?.filingStatus,
      stateOfResidence: taxProfile?.stateOfResidence,
      payPeriodStart: dashboard?.periodStart,
      payPeriodEnd: dashboard?.periodEnd,
      payEvents: payEventsData?.events.map((e) => ({
        type: e.eventType,
        label: e.airlineLabel ?? undefined,
        amountCents: e.payDifferenceCents ?? undefined,
      })),
      benchmarkData: benchmarkComparison?.currentBenchmark ? {
        hourlyRateCents: benchmarkComparison.currentBenchmark.hourlyRateCents,
        payAtGuaranteeCents: benchmarkComparison.currentBenchmark.payAtGuaranteeCents,
        avgLinePayCents: benchmarkComparison.currentBenchmark.avgLinePayCents,
        avgTotalPayCents: benchmarkComparison.currentBenchmark.avgTotalPayCents,
        sourceNote: benchmarkComparison.currentBenchmark.sourceNote ?? undefined,
      } : undefined,
    },
  }), [dashboard, breakdown, profile, taxProfile, payEventsData, benchmarkComparison, yearOfService]);

  // Handle opening explanation modal
  const handleExplain = (section: PayExplanationSection) => {
    setSelectedSection(section);
    setExplanationModalVisible(true);
  };

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
                <FileText size={24} color="#f59e0b" />
              </View>
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  // Future: Share functionality
                }}
                className="w-10 h-10 rounded-full bg-slate-800/60 items-center justify-center active:opacity-70"
              >
                <Share2 size={18} color="#64748b" />
              </Pressable>
            </View>

            <Text className="text-white text-2xl font-bold text-center">
              Projected Pay Statement
            </Text>
            <Text className="text-slate-400 text-sm mt-1 text-center">
              Estimated projection for current pay period
            </Text>

            {/* Explain This Pay Button */}
            {!isLoading && dashboard && (
              <Pressable
                onPress={() => handleExplain('FULL_STATEMENT')}
                className="mt-4 flex-row items-center justify-center bg-amber-500/20 border border-amber-500/40 rounded-xl py-3 px-4 active:opacity-70"
              >
                <Sparkles size={18} color="#f59e0b" />
                <Text className="text-amber-400 font-semibold ml-2">
                  Explain This Pay
                </Text>
              </Pressable>
            )}
          </Animated.View>

          {/* Loading */}
          {isLoading && (
            <View className="items-center py-8">
              <ActivityIndicator size="large" color="#f59e0b" />
              <Text className="text-slate-400 mt-3">Calculating...</Text>
            </View>
          )}

          {/* Statement Content */}
          {!isLoading && dashboard && (
            <Animated.View
              entering={FadeIn.duration(600).delay(200)}
              className="mx-5 mt-6"
            >
              {/* Statement Card */}
              <View className="bg-slate-900/80 rounded-2xl border border-slate-700/50 overflow-hidden">
                {/* Branding Header */}
                <LinearGradient
                  colors={['#1e3a5a', '#0f4c75']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={{ padding: 16 }}
                >
                  <View className="flex-row items-center justify-between">
                    <View className="flex-row items-center">
                      <Plane size={28} color="#f59e0b" />
                      <View className="ml-3">
                        <Text className="text-amber-500 text-lg font-bold">
                          Pilot Pay Tracker
                        </Text>
                        <Text className="text-slate-400 text-xs">
                          Pay Period Projection
                        </Text>
                      </View>
                    </View>
                    <View className="items-end">
                      <Text className="text-slate-400 text-xs">Generated</Text>
                      <Text className="text-white text-sm font-medium">
                        {getCurrentDateFormatted()}
                      </Text>
                    </View>
                  </View>
                </LinearGradient>

                {/* Employee Info */}
                <View className="px-4 py-3 bg-slate-800/50 border-b border-slate-700/50">
                  <View className="flex-row flex-wrap">
                    <View className="w-1/2 mb-2">
                      <Text className="text-slate-500 text-xs">Employee</Text>
                      <Text className="text-white font-medium">{pilotName}</Text>
                    </View>
                    <View className="w-1/2 mb-2">
                      <Text className="text-slate-500 text-xs">Airline</Text>
                      <Text className="text-white font-medium">
                        {profile?.airline ?? 'UPS'}
                      </Text>
                    </View>
                    <View className="w-1/2">
                      <Text className="text-slate-500 text-xs">Pay Period</Text>
                      <Text className="text-white font-medium">
                        {formatDate(dashboard.periodStart)} -{' '}
                        {formatDate(dashboard.periodEnd)}
                      </Text>
                    </View>
                    <View className="w-1/2">
                      <Text className="text-slate-500 text-xs">Position</Text>
                      <Text className="text-white font-medium">
                        {profile?.position === 'CPT'
                          ? 'Captain'
                          : profile?.position === 'FO'
                            ? 'First Officer'
                            : '--'}
                      </Text>
                    </View>
                  </View>
                </View>

                {/* Tax Info */}
                {taxProfile && (
                  <View className="px-4 py-2 bg-slate-800/30 border-b border-slate-700/50">
                    <View className="flex-row flex-wrap">
                      <View className="w-1/2">
                        <Text className="text-slate-500 text-xs">
                          Filing Status
                        </Text>
                        <Text className="text-slate-300 text-sm">
                          {FILING_STATUS_LABELS[taxProfile.filingStatus]}
                        </Text>
                      </View>
                      <View className="w-1/2">
                        <Text className="text-slate-500 text-xs">State</Text>
                        <Text className="text-slate-300 text-sm">
                          {taxProfile.stateOfResidence}
                        </Text>
                      </View>
                    </View>
                  </View>
                )}

                {/* EARNINGS Section */}
                <SectionHeader title="Earnings (Projected)" section="EARNINGS" onExplain={handleExplain} />

                {/* Base Credit Pay */}
                <LineItem
                  label="Flight Credit Pay"
                  units={`${creditHours.toFixed(2)} hrs`}
                  rate={`$${hourlyRate.toFixed(2)}/hr`}
                  amount={basePay}
                />

                {/* Block Overage */}
                {overageMinutes > 0 && (
                  <LineItem
                    label="Block Overage"
                    units={`${(overageMinutes / 60).toFixed(2)} hrs`}
                    rate={`$${hourlyRate.toFixed(2)}/hr`}
                    amount={overagePay}
                  />
                )}

                {/* Pay Events (if any) */}
                {payEventsData?.events.slice(0, 5).map((event) => (
                  <LineItem
                    key={event.id}
                    label={event.airlineLabel ?? event.eventType}
                    amount={event.payDifferenceCents ?? 0}
                  />
                ))}

                {/* Gross Total */}
                <LineItem
                  label="Gross Pay"
                  amount={dashboard.totalPayCents}
                  isTotal
                />

                {/* PRE-TAX DEDUCTIONS Section */}
                {breakdown && breakdown.pretaxDeductionsCents > 0 && (
                  <>
                    <SectionHeader title="Pre-Tax Deductions" section="DEDUCTIONS" onExplain={handleExplain} />
                    {breakdown.pretaxDeductions.map((d, i) => (
                      <LineItem
                        key={i}
                        label={d.name}
                        amount={d.amountCents}
                        isDeduction
                      />
                    ))}
                  </>
                )}

                {/* TAXES Section */}
                {breakdown && (
                  <>
                    <SectionHeader title="Taxes (Estimated)" section="TAXES" onExplain={handleExplain} />

                    <LineItem
                      label="Federal Income Tax"
                      amount={breakdown.federalWithholdingCents}
                      isDeduction
                    />

                    <LineItem
                      label="Social Security (6.2%)"
                      amount={breakdown.socialSecurityCents}
                      isDeduction
                    />

                    <LineItem
                      label="Medicare (1.45%)"
                      amount={breakdown.medicareCents}
                      isDeduction
                    />

                    {breakdown.additionalMedicareCents > 0 && (
                      <LineItem
                        label="Additional Medicare (0.9%)"
                        amount={breakdown.additionalMedicareCents}
                        isDeduction
                      />
                    )}

                    {breakdown.stateWithholdingCents > 0 && (
                      <LineItem
                        label={`State Tax (${breakdown.stateInfo.code})`}
                        amount={breakdown.stateWithholdingCents}
                        isDeduction
                      />
                    )}

                    {!breakdown.stateInfo.hasIncomeTax && (
                      <LineItem
                        label={`State Tax (${breakdown.stateInfo.code})`}
                        amount={0}
                        isMuted
                      />
                    )}
                  </>
                )}

                {/* POST-TAX DEDUCTIONS Section */}
                {breakdown && breakdown.posttaxDeductionsCents > 0 && (
                  <>
                    <SectionHeader title="Post-Tax Deductions" section="DEDUCTIONS" onExplain={handleExplain} />
                    {breakdown.posttaxDeductions.map((d, i) => (
                      <LineItem
                        key={i}
                        label={d.name}
                        amount={d.amountCents}
                        isDeduction
                      />
                    ))}
                  </>
                )}

                {/* Extra Withholding */}
                {breakdown && breakdown.extraWithholdingCents > 0 && (
                  <LineItem
                    label="Additional Withholding"
                    amount={breakdown.extraWithholdingCents}
                    isDeduction
                  />
                )}

                {/* NET PAY */}
                {breakdown && (
                  <NetPayBox
                    netPayCents={breakdown.netPayCents}
                    onExplain={() => handleExplain('NET_PAY')}
                  />
                )}

                {/* Per Diem (informational) */}
                {(dashboard as any)?.totalPdiemCents > 0 && (
                  <>
                    <SectionHeader title="Reimbursements (Non-Taxable)" section="REIMBURSEMENTS" onExplain={handleExplain} />
                    <LineItem
                      label="Per Diem"
                      amount={(dashboard as any).totalPdiemCents}
                      isMuted
                    />
                    <View className="px-4 py-2">
                      <Text className="text-slate-500 text-xs">
                        Per diem is informational and not included in taxable
                        wages.
                      </Text>
                    </View>
                  </>
                )}

                {/* Disclaimer Footer */}
                <View className="px-4 py-3 bg-slate-800/30 border-t border-slate-700/50">
                  <View className="flex-row items-start">
                    <AlertCircle size={14} color="#64748b" />
                    <Text className="text-slate-500 text-xs ml-2 flex-1">
                      This is an estimated projection based on your pay data and
                      tax settings. It is not an official payroll statement.
                      Actual amounts may vary.
                    </Text>
                  </View>
                </View>
              </View>

              {/* Configure Settings Link */}
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push('/tax-settings');
                }}
                className="mt-4 flex-row items-center justify-center py-3 active:opacity-70"
              >
                <Info size={16} color="#64748b" />
                <Text className="text-slate-400 text-sm ml-2">
                  Configure tax settings
                </Text>
              </Pressable>
            </Animated.View>
          )}

          {/* No Data State */}
          {!isLoading && !dashboard && (
            <Animated.View
              entering={FadeIn.duration(600).delay(200)}
              className="mx-5 mt-8"
            >
              <View className="bg-slate-800/60 rounded-2xl p-6 items-center border border-slate-700/50">
                <FileText size={40} color="#64748b" />
                <Text className="text-white text-lg font-semibold mt-4">
                  No Pay Data Available
                </Text>
                <Text className="text-slate-400 text-center mt-2">
                  Log some flights or trips to generate a projected pay
                  statement.
                </Text>
              </View>
            </Animated.View>
          )}
        </ScrollView>
      </LinearGradient>

      {/* AI Explanation Modal */}
      <PayExplanationModal
        visible={explanationModalVisible}
        onClose={() => setExplanationModalVisible(false)}
        section={selectedSection}
        request={explanationRequest}
      />
    </View>
  );
}
