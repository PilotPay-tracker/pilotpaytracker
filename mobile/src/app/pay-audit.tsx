/**
 * Pay Audit Screen (v3)
 *
 * Flight Register as truth source + manual paycheck entry.
 * Reuses the app's existing pay engine, tax settings, and UI patterns.
 *
 * Flow:
 * 1. Upload Flight Register screenshots
 * 2. App parses FR and calculates expected gross via existing pay logic
 * 3. User enters Settlement + Advance check amounts
 * 4. User chooses Gross or Net comparison mode
 * 5. App compares and returns a clean audit result
 */

import { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Image,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import {
  ArrowLeft,
  FileText,
  DollarSign,
  X,
  Camera,
  ImageIcon,
  CheckCircle,
  AlertTriangle,
  AlertCircle,
  ShieldAlert,
  ChevronDown,
  ChevronUp,
  Search,
  RefreshCw,
  Info,
  TrendingUp,
  Calendar,
} from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import Animated, {
  FadeIn,
  FadeInDown,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';

import { api } from '@/lib/api';
import type { PayAuditResult } from '@/lib/contracts';

type Step = 'upload' | 'processing' | 'analyzing' | 'result';
type ComparisonMode = 'gross' | 'net';

interface SelectedImage {
  uri: string;
  base64: string | null;
}

interface FRProcessResult {
  flightRegister: {
    payPeriodStart: string | null;
    payPeriodEnd: string | null;
    beginningPayCredit: string | null;
    endingPayCredit: string | null;
    dutyDays: number | null;
    jaHours: string | null;
    ja2Hours: string | null;
    blockHoursPaid: string | null;
    tdyPerDiem: number | null;
  };
  matchedSettlementPeriod: string | null;
  matchedAdvancePeriod: string | null;
  matchedSettlementPayDate: string | null;
  matchedAdvancePayDate: string | null;
}

// ============================================
// Helpers
// ============================================
function formatCurrency(val: number | null | undefined): string {
  if (val == null) return '—';
  const sign = val < 0 ? '-' : '';
  return `${sign}$${Math.abs(val / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatCurrencyInput(val: number | null | undefined): string {
  if (val == null || val === 0) return '';
  return (Math.abs(val) / 100).toFixed(2);
}

function parseCurrencyInput(str: string): number {
  const clean = str.replace(/[^0-9.]/g, '');
  const parsed = parseFloat(clean);
  return isNaN(parsed) ? 0 : Math.round(parsed * 100);
}

function getAuditStatusConfig(status: PayAuditResult['auditStatus'] | null) {
  switch (status) {
    case 'paid_correctly':
      return { label: 'Exact Match', color: '#22c55e', bg: 'rgba(34,197,94,0.12)', Icon: CheckCircle };
    case 'minor_variance':
      return { label: 'Minor Variance', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', Icon: AlertTriangle };
    case 'review_recommended':
      return { label: 'Review Recommended', color: '#f97316', bg: 'rgba(249,115,22,0.12)', Icon: AlertCircle };
    case 'possible_discrepancy':
      return { label: 'Possible Discrepancy', color: '#ef4444', bg: 'rgba(239,68,68,0.12)', Icon: ShieldAlert };
    case 'likely_issue':
      return { label: 'Likely Pay Issue', color: '#ef4444', bg: 'rgba(239,68,68,0.12)', Icon: ShieldAlert };
    default:
      return { label: 'Unknown', color: '#64748b', bg: 'rgba(100,116,139,0.12)', Icon: AlertCircle };
  }
}

// ============================================
// Stub match helpers
// ============================================
type StubMatchStatus = 'exact' | 'expected' | 'off' | 'unknown';

function computeStubMatchStatus(entered: string, recommended: string | null | undefined): StubMatchStatus {
  if (!recommended) return 'unknown';
  const e = entered.trim().toLowerCase();
  if (!e) return 'unknown';
  const r = recommended.trim().toLowerCase();
  if (e === r) return 'exact';
  // Normalize slashes/dashes and check if either contains the other
  const normalize = (s: string) => s.replace(/[-/]/g, '').replace(/\s+/g, ' ');
  if (normalize(e) === normalize(r)) return 'exact';
  if (e.includes(r) || r.includes(e)) return 'expected';
  return 'off';
}

function getStubMatchStatusConfig(status: StubMatchStatus) {
  switch (status) {
    case 'exact':
      return { label: 'Exact Match', color: '#22c55e', bg: 'rgba(34,197,94,0.12)' };
    case 'expected':
      return { label: 'Expected Match', color: '#0ea5e9', bg: 'rgba(14,165,233,0.12)' };
    case 'off':
      return { label: 'Off / Review', color: '#f97316', bg: 'rgba(249,115,22,0.12)' };
    default:
      return { label: 'Not Entered', color: '#64748b', bg: 'rgba(100,116,139,0.10)' };
  }
}

// ============================================
// Sub-components
// ============================================
function SectionCard({
  title,
  children,
  accentColor = '#14b8a6',
}: {
  title: string;
  children: React.ReactNode;
  accentColor?: string;
}) {
  return (
    <View
      style={{
        backgroundColor: '#131f30',
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#1e2f45',
        marginBottom: 12,
        overflow: 'hidden',
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 16,
          paddingTop: 14,
          paddingBottom: 10,
          borderBottomWidth: 1,
          borderBottomColor: '#1e2f45',
        }}
      >
        <View
          style={{
            width: 3,
            height: 14,
            borderRadius: 2,
            backgroundColor: accentColor,
            marginRight: 10,
          }}
        />
        <Text style={{ color: '#f1f5f9', fontSize: 14, fontWeight: '600', letterSpacing: -0.2 }}>
          {title}
        </Text>
      </View>
      <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>{children}</View>
    </View>
  );
}

function DataRow({
  label,
  value,
  highlight = false,
  warn = false,
  positive = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  warn?: boolean;
  positive?: boolean;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 6,
      }}
    >
      <Text style={{ color: '#64748b', fontSize: 13, flex: 1 }}>{label}</Text>
      <Text
        style={{
          color: warn ? '#f97316' : positive ? '#22c55e' : highlight ? '#f1f5f9' : '#94a3b8',
          fontSize: 13,
          fontWeight: highlight ? '600' : '400',
          textAlign: 'right',
        }}
      >
        {value}
      </Text>
    </View>
  );
}

// ============================================
// Image Upload Section
// ============================================
function ImageUploadSection({
  images,
  onAdd,
  onRemove,
  disabled,
}: {
  images: SelectedImage[];
  onAdd: (fromCamera: boolean) => void;
  onRemove: (index: number) => void;
  disabled: boolean;
}) {
  return (
    <View
      style={{
        backgroundColor: '#131f30',
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#1e2f45',
        padding: 16,
        marginBottom: 12,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 11,
            backgroundColor: 'rgba(20,184,166,0.12)',
            alignItems: 'center',
            justifyContent: 'center',
            marginRight: 12,
          }}
        >
          <FileText size={18} color="#14b8a6" strokeWidth={2} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: '#f1f5f9', fontSize: 15, fontWeight: '600', letterSpacing: -0.2 }}>
            Flight Register
          </Text>
          <Text style={{ color: '#475569', fontSize: 12, marginTop: 1 }}>
            UPS pay register — totals section required
          </Text>
        </View>
        {images.length > 0 && (
          <View
            style={{
              backgroundColor: 'rgba(20,184,166,0.12)',
              borderRadius: 10,
              paddingHorizontal: 8,
              paddingVertical: 3,
            }}
          >
            <Text style={{ color: '#14b8a6', fontSize: 12, fontWeight: '600' }}>
              {images.length} page{images.length !== 1 ? 's' : ''}
            </Text>
          </View>
        )}
      </View>

      {images.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 12, gap: 8 }}>
          {images.map((img, idx) => (
            <View key={idx} style={{ position: 'relative', width: 72, height: 72 }}>
              <Image
                source={{ uri: img.uri }}
                style={{ width: 72, height: 72, borderRadius: 10, backgroundColor: '#0f172a' }}
                resizeMode="cover"
              />
              <Pressable
                onPress={() => onRemove(idx)}
                style={{
                  position: 'absolute',
                  top: -5,
                  right: -5,
                  width: 20,
                  height: 20,
                  borderRadius: 10,
                  backgroundColor: '#ef4444',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <X size={11} color="#fff" strokeWidth={2.5} />
              </Pressable>
            </View>
          ))}
        </View>
      )}

      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Pressable
          onPress={() => onAdd(false)}
          disabled={disabled}
          style={({ pressed }) => ({
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: pressed ? '#1e3a5a' : '#0f2137',
            borderRadius: 11,
            borderWidth: 1,
            borderColor: '#1e2f45',
            paddingVertical: 10,
            opacity: disabled ? 0.5 : 1,
          })}
        >
          <ImageIcon size={15} color="#14b8a6" strokeWidth={2} />
          <Text style={{ color: '#14b8a6', fontSize: 13, fontWeight: '500', marginLeft: 6 }}>
            Library
          </Text>
        </Pressable>
        <Pressable
          onPress={() => onAdd(true)}
          disabled={disabled}
          style={({ pressed }) => ({
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: pressed ? '#1e3a5a' : '#0f2137',
            borderRadius: 11,
            borderWidth: 1,
            borderColor: '#1e2f45',
            paddingVertical: 10,
            opacity: disabled ? 0.5 : 1,
          })}
        >
          <Camera size={15} color="#14b8a6" strokeWidth={2} />
          <Text style={{ color: '#14b8a6', fontSize: 13, fontWeight: '500', marginLeft: 6 }}>
            Camera
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

// ============================================
// Paycheck Input Section
// ============================================
function PaycheckInputSection({
  settlementCents,
  advanceCents,
  onSettlementChange,
  onAdvanceChange,
  settlementDateInput = '',
  advanceDateInput = '',
  onSettlementDateChange,
  onAdvanceDateChange,
}: {
  settlementCents: number;
  advanceCents: number;
  onSettlementChange: (cents: number) => void;
  onAdvanceChange: (cents: number) => void;
  settlementDateInput?: string;
  advanceDateInput?: string;
  onSettlementDateChange?: (text: string) => void;
  onAdvanceDateChange?: (text: string) => void;
}) {
  const [settlementText, setSettlementText] = useState(formatCurrencyInput(settlementCents) || '');
  const [advanceText, setAdvanceText] = useState(formatCurrencyInput(advanceCents) || '');
  const [settleFocused, setSettleFocused] = useState(false);
  const [advanceFocused, setAdvanceFocused] = useState(false);
  const advanceRef = useRef<TextInput>(null);

  const combinedTotal = settlementCents + advanceCents;

  return (
    <View style={{ marginBottom: 12 }}>
      {/* Section header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12, paddingHorizontal: 2 }}>
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            backgroundColor: 'rgba(245,158,11,0.15)',
            alignItems: 'center',
            justifyContent: 'center',
            marginRight: 10,
          }}
        >
          <DollarSign size={17} color="#f59e0b" strokeWidth={2.5} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: '#f1f5f9', fontSize: 16, fontWeight: '700', letterSpacing: -0.3 }}>
            Enter Your Paychecks
          </Text>
          <Text style={{ color: '#475569', fontSize: 12, marginTop: 1 }}>
            Settlement + Advance for this FR period
          </Text>
        </View>
      </View>

      {/* Settlement Card */}
      <View
        style={{
          borderRadius: 18,
          borderWidth: 1.5,
          borderColor: settleFocused ? 'rgba(20,184,166,0.6)' : 'rgba(20,184,166,0.2)',
          backgroundColor: '#0c1e32',
          marginBottom: 10,
          overflow: 'hidden',
        }}
      >
        {/* Card header band */}
        <LinearGradient
          colors={['rgba(20,184,166,0.18)', 'rgba(20,184,166,0.06)']}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 16,
            paddingVertical: 11,
            borderBottomWidth: 1,
            borderBottomColor: 'rgba(20,184,166,0.12)',
          }}
        >
          <View
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              backgroundColor: 'rgba(20,184,166,0.2)',
              alignItems: 'center',
              justifyContent: 'center',
              marginRight: 10,
            }}
          >
            <TrendingUp size={14} color="#14b8a6" strokeWidth={2.5} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: '#14b8a6', fontSize: 13, fontWeight: '800', letterSpacing: 0.2 }}>
              SETTLEMENT CHECK
            </Text>
            <Text style={{ color: '#2dd4bf', fontSize: 11, opacity: 0.7 }}>
              Larger — premiums, JA, over-guarantee
            </Text>
          </View>
        </LinearGradient>

        {/* Dollar input */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 16,
            paddingVertical: 14,
          }}
        >
          <Text style={{ color: settlementText ? '#14b8a6' : '#2d4a5e', fontSize: 28, fontWeight: '300', marginRight: 2, marginTop: 2 }}>
            $
          </Text>
          <TextInput
            value={settlementText}
            onChangeText={(text) => {
              setSettlementText(text);
              onSettlementChange(parseCurrencyInput(text));
            }}
            onFocus={() => setSettleFocused(true)}
            onBlur={() => setSettleFocused(false)}
            placeholder="0.00"
            placeholderTextColor="#1e3d57"
            keyboardType="decimal-pad"
            returnKeyType="next"
            onSubmitEditing={() => advanceRef.current?.focus()}
            style={{
              flex: 1,
              color: '#f1f5f9',
              fontSize: 32,
              fontWeight: '700',
              letterSpacing: -1,
            }}
          />
          {settlementText.length > 0 && (
            <Pressable
              onPress={() => { setSettlementText(''); onSettlementChange(0); }}
              style={{
                width: 24,
                height: 24,
                borderRadius: 12,
                backgroundColor: '#1e3349',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <X size={12} color="#64748b" strokeWidth={2.5} />
            </Pressable>
          )}
        </View>

        {/* Stub period input */}
        {onSettlementDateChange && (
          <View
            style={{
              borderTopWidth: 1,
              borderTopColor: 'rgba(20,184,166,0.08)',
              paddingHorizontal: 16,
              paddingVertical: 10,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Calendar size={12} color="#2d5a6e" strokeWidth={2} style={{ marginRight: 8, flexShrink: 0 }} />
              <TextInput
                value={settlementDateInput}
                onChangeText={onSettlementDateChange}
                placeholder="Stub period — e.g. 11/17/2025 – 11/30/2025"
                placeholderTextColor="#1e3d57"
                returnKeyType="next"
                onSubmitEditing={() => advanceRef.current?.focus()}
                style={{ flex: 1, color: '#94a3b8', fontSize: 12 }}
              />
            </View>
          </View>
        )}
      </View>

      {/* Advance Card */}
      <View
        style={{
          borderRadius: 18,
          borderWidth: 1.5,
          borderColor: advanceFocused ? 'rgba(245,158,11,0.6)' : 'rgba(245,158,11,0.2)',
          backgroundColor: '#0d1d2c',
          marginBottom: 10,
          overflow: 'hidden',
        }}
      >
        {/* Card header band */}
        <LinearGradient
          colors={['rgba(245,158,11,0.16)', 'rgba(245,158,11,0.05)']}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 16,
            paddingVertical: 11,
            borderBottomWidth: 1,
            borderBottomColor: 'rgba(245,158,11,0.1)',
          }}
        >
          <View
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              backgroundColor: 'rgba(245,158,11,0.18)',
              alignItems: 'center',
              justifyContent: 'center',
              marginRight: 10,
            }}
          >
            <DollarSign size={14} color="#f59e0b" strokeWidth={2.5} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: '#f59e0b', fontSize: 13, fontWeight: '800', letterSpacing: 0.2 }}>
              ADVANCE CHECK
            </Text>
            <Text style={{ color: '#fbbf24', fontSize: 11, opacity: 0.7 }}>
              Simpler 37.5-hour advance
            </Text>
          </View>
        </LinearGradient>

        {/* Dollar input */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 16,
            paddingVertical: 14,
          }}
        >
          <Text style={{ color: advanceText ? '#f59e0b' : '#2d3a1e', fontSize: 28, fontWeight: '300', marginRight: 2, marginTop: 2 }}>
            $
          </Text>
          <TextInput
            ref={advanceRef}
            value={advanceText}
            onChangeText={(text) => {
              setAdvanceText(text);
              onAdvanceChange(parseCurrencyInput(text));
            }}
            onFocus={() => setAdvanceFocused(true)}
            onBlur={() => setAdvanceFocused(false)}
            placeholder="0.00"
            placeholderTextColor="#2a3820"
            keyboardType="decimal-pad"
            returnKeyType="done"
            style={{
              flex: 1,
              color: '#f1f5f9',
              fontSize: 32,
              fontWeight: '700',
              letterSpacing: -1,
            }}
          />
          {advanceText.length > 0 && (
            <Pressable
              onPress={() => { setAdvanceText(''); onAdvanceChange(0); }}
              style={{
                width: 24,
                height: 24,
                borderRadius: 12,
                backgroundColor: '#1e2d18',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <X size={12} color="#64748b" strokeWidth={2.5} />
            </Pressable>
          )}
        </View>

        {/* Stub period input */}
        {onAdvanceDateChange && (
          <View
            style={{
              borderTopWidth: 1,
              borderTopColor: 'rgba(245,158,11,0.08)',
              paddingHorizontal: 16,
              paddingVertical: 10,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Calendar size={12} color="#4a3a1a" strokeWidth={2} style={{ marginRight: 8, flexShrink: 0 }} />
              <TextInput
                value={advanceDateInput}
                onChangeText={onAdvanceDateChange}
                placeholder="Stub period — e.g. 10/20/2025 – 11/02/2025"
                placeholderTextColor="#2a3820"
                returnKeyType="done"
                style={{ flex: 1, color: '#94a3b8', fontSize: 12 }}
              />
            </View>
          </View>
        )}
      </View>

      {/* Combined total */}
      {combinedTotal > 0 && (
        <LinearGradient
          colors={['#0f2137', '#0c1929']}
          style={{
            borderRadius: 14,
            borderWidth: 1,
            borderColor: '#1e3555',
            paddingHorizontal: 18,
            paddingVertical: 14,
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <Text style={{ color: '#64748b', fontSize: 13, fontWeight: '600', letterSpacing: 0.3, textTransform: 'uppercase' }}>
            Combined Total
          </Text>
          <Text style={{ color: '#f1f5f9', fontSize: 20, fontWeight: '800', letterSpacing: -0.5 }}>
            ${(combinedTotal / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </Text>
        </LinearGradient>
      )}

      {/* Gross mode helper */}
      <View
        style={{
          backgroundColor: 'rgba(20,184,166,0.06)',
          borderRadius: 10,
          borderWidth: 1,
          borderColor: 'rgba(20,184,166,0.14)',
          paddingHorizontal: 12,
          paddingVertical: 9,
          marginTop: 10,
          flexDirection: 'row',
          alignItems: 'flex-start',
        }}
      >
        <Info size={12} color="#14b8a6" strokeWidth={2} style={{ marginTop: 1, marginRight: 7, flexShrink: 0 }} />
        <Text style={{ color: '#4db8b0', fontSize: 12, lineHeight: 17, flex: 1 }}>
          For Gross Audit, enter the top Earnings amount from each Dayforce check.
        </Text>
      </View>
    </View>
  );
}

// ============================================
// Comparison Mode Selector
// ============================================
function ComparisonModeSelector({
  mode,
  onChange,
}: {
  mode: ComparisonMode;
  onChange: (m: ComparisonMode) => void;
}) {
  return (
    <View
      style={{
        backgroundColor: '#131f30',
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#1e2f45',
        padding: 16,
        marginBottom: 12,
      }}
    >
      <Text style={{ color: '#94a3b8', fontSize: 12, fontWeight: '600', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 12 }}>
        Comparison Mode
      </Text>

      <View style={{ flexDirection: 'row', gap: 8 }}>
        {(['gross', 'net'] as const).map((m) => (
          <Pressable
            key={m}
            onPress={() => { Haptics.selectionAsync(); onChange(m); }}
            style={({ pressed }) => ({
              flex: 1,
              borderRadius: 11,
              borderWidth: 1.5,
              borderColor: mode === m ? '#14b8a6' : '#1e2f45',
              backgroundColor: mode === m ? 'rgba(20,184,166,0.1)' : pressed ? '#1e2f45' : '#0f2137',
              paddingVertical: 12,
              alignItems: 'center',
            })}
          >
            <Text
              style={{
                color: mode === m ? '#14b8a6' : '#64748b',
                fontSize: 14,
                fontWeight: mode === m ? '700' : '500',
                textTransform: 'capitalize',
              }}
            >
              {m === 'gross' ? 'Gross' : 'Net'}
            </Text>
            {m === 'gross' && (
              <Text style={{ color: mode === m ? '#0d9488' : '#334155', fontSize: 10, marginTop: 2 }}>
                Recommended
              </Text>
            )}
            {m === 'net' && (
              <Text style={{ color: mode === m ? '#0d9488' : '#334155', fontSize: 10, marginTop: 2 }}>
                Uses saved settings
              </Text>
            )}
          </Pressable>
        ))}
      </View>

      {mode === 'net' && (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-start',
            backgroundColor: 'rgba(20,184,166,0.06)',
            borderRadius: 10,
            padding: 10,
            marginTop: 10,
          }}
        >
          <Info size={13} color="#14b8a6" strokeWidth={2} style={{ marginTop: 1, marginRight: 7, flexShrink: 0 }} />
          <Text style={{ color: '#4db8b0', fontSize: 12, lineHeight: 17, flex: 1 }}>
            Net comparison uses your saved tax and deduction settings from Pay Summary. Actual payroll withholding may vary slightly.
          </Text>
        </View>
      )}
    </View>
  );
}

// ============================================
// Dayforce Period Guidance Card (v5 — with match status)
// ============================================
function DayforcePeriodGuidanceCard({
  result,
  settlementDateInput = '',
  advanceDateInput = '',
}: {
  result: PayAuditResult;
  settlementDateInput?: string;
  advanceDateInput?: string;
}) {
  const frBeginDate = result.flightRegister.payPeriodStart;
  const settlement = result.matchedSettlementPeriod;
  const advance = result.matchedAdvancePeriod;

  if (!settlement && !advance) return null;

  const settlementStatus = computeStubMatchStatus(settlementDateInput, settlement);
  const advanceStatus = computeStubMatchStatus(advanceDateInput, advance);
  const settlCfg = getStubMatchStatusConfig(settlementStatus);
  const advCfg = getStubMatchStatusConfig(advanceStatus);

  return (
    <Animated.View entering={FadeInDown.duration(400).delay(30).springify()}>
      <View
        style={{
          backgroundColor: '#0c1929',
          borderRadius: 16,
          borderWidth: 1.5,
          borderColor: 'rgba(20,184,166,0.35)',
          marginBottom: 12,
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 16,
            paddingTop: 13,
            paddingBottom: 10,
            borderBottomWidth: 1,
            borderBottomColor: 'rgba(20,184,166,0.14)',
            backgroundColor: 'rgba(20,184,166,0.05)',
          }}
        >
          <View style={{ width: 3, height: 14, borderRadius: 2, backgroundColor: '#14b8a6', marginRight: 10 }} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: '#f1f5f9', fontSize: 14, fontWeight: '700', letterSpacing: -0.2 }}>
              Matched Dayforce Checks
            </Text>
            {frBeginDate && (
              <Text style={{ color: '#475569', fontSize: 11, marginTop: 1 }}>
                FR Begin:{' '}
                <Text style={{ color: '#64748b', fontWeight: '600' }}>{frBeginDate}</Text>
              </Text>
            )}
          </View>
          <View style={{ backgroundColor: 'rgba(20,184,166,0.15)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
            <Text style={{ color: '#14b8a6', fontSize: 11, fontWeight: '700' }}>USE THESE</Text>
          </View>
        </View>

        <View style={{ paddingHorizontal: 16, paddingTop: 11, paddingBottom: 14 }}>
          <Text style={{ color: '#475569', fontSize: 12, lineHeight: 17, marginBottom: 11 }}>
            For Gross Audit, enter the top Earnings amount from these two Dayforce checks.
          </Text>

          {/* Settlement stub */}
          {settlement && (
            <View
              style={{
                backgroundColor: 'rgba(20,184,166,0.07)',
                borderRadius: 11,
                borderWidth: 1,
                borderColor: 'rgba(20,184,166,0.15)',
                padding: 12,
                marginBottom: 8,
              }}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                <Text style={{ color: '#475569', fontSize: 11, fontWeight: '600', letterSpacing: 0.4, textTransform: 'uppercase' }}>
                  Settlement Check
                </Text>
                <View style={{ backgroundColor: settlCfg.bg, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 }}>
                  <Text style={{ color: settlCfg.color, fontSize: 10, fontWeight: '700' }}>{settlCfg.label}</Text>
                </View>
              </View>
              <Text style={{ color: '#14b8a6', fontSize: 15, fontWeight: '700' }}>{settlement}</Text>
              {result.matchedSettlementPayDate && (
                <Text style={{ color: '#475569', fontSize: 12, marginTop: 3 }}>
                  Pay date: {result.matchedSettlementPayDate}
                </Text>
              )}
            </View>
          )}

          {/* Advance stub */}
          {advance && (
            <View
              style={{
                backgroundColor: 'rgba(245,158,11,0.06)',
                borderRadius: 11,
                borderWidth: 1,
                borderColor: 'rgba(245,158,11,0.14)',
                padding: 12,
              }}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                <Text style={{ color: '#475569', fontSize: 11, fontWeight: '600', letterSpacing: 0.4, textTransform: 'uppercase' }}>
                  Advance Check
                </Text>
                <View style={{ backgroundColor: advCfg.bg, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 }}>
                  <Text style={{ color: advCfg.color, fontSize: 10, fontWeight: '700' }}>{advCfg.label}</Text>
                </View>
              </View>
              <Text style={{ color: '#f59e0b', fontSize: 15, fontWeight: '700' }}>{advance}</Text>
              {result.matchedAdvancePayDate && (
                <Text style={{ color: '#475569', fontSize: 12, marginTop: 3 }}>
                  Pay date: {result.matchedAdvancePayDate}
                </Text>
              )}
            </View>
          )}
        </View>
      </View>
    </Animated.View>
  );
}

// ============================================
// Processing View (FR parse step)
// ============================================
function ProcessingView() {
  return (
    <Animated.View
      entering={FadeIn.duration(250)}
      style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 }}
    >
      <View
        style={{
          width: 60,
          height: 60,
          borderRadius: 16,
          backgroundColor: 'rgba(20,184,166,0.12)',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 20,
        }}
      >
        <FileText size={26} color="#14b8a6" strokeWidth={1.5} />
      </View>
      <Text style={{ color: '#f1f5f9', fontSize: 18, fontWeight: '700', letterSpacing: -0.4, textAlign: 'center', marginBottom: 6 }}>
        Processing Flight Register
      </Text>
      <Text style={{ color: '#475569', fontSize: 13, textAlign: 'center', lineHeight: 19, marginBottom: 28 }}>
        Parsing totals and matching Dayforce check dates
      </Text>
      <ActivityIndicator color="#14b8a6" size="large" />
    </Animated.View>
  );
}

// ============================================
// FR Matched Dates Preview (shown after processing, before audit)
// ============================================
function FRMatchedDatesPreview({ frResult }: { frResult: FRProcessResult }) {
  const { flightRegister, matchedSettlementPeriod, matchedAdvancePeriod, matchedSettlementPayDate, matchedAdvancePayDate } = frResult;

  return (
    <Animated.View entering={FadeInDown.duration(350).springify()}>
      <View
        style={{
          backgroundColor: '#0c1929',
          borderRadius: 16,
          borderWidth: 1.5,
          borderColor: 'rgba(20,184,166,0.35)',
          marginBottom: 12,
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 16,
            paddingTop: 12,
            paddingBottom: 10,
            borderBottomWidth: 1,
            borderBottomColor: 'rgba(20,184,166,0.14)',
            backgroundColor: 'rgba(20,184,166,0.05)',
          }}
        >
          <CheckCircle size={14} color="#14b8a6" strokeWidth={2.5} style={{ marginRight: 8 }} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: '#f1f5f9', fontSize: 14, fontWeight: '700', letterSpacing: -0.2 }}>
              Matched Dayforce Checks
            </Text>
            {flightRegister.payPeriodStart && (
              <Text style={{ color: '#475569', fontSize: 11, marginTop: 1 }}>
                FR Begin:{' '}
                <Text style={{ color: '#64748b', fontWeight: '600' }}>{flightRegister.payPeriodStart}</Text>
              </Text>
            )}
          </View>
          <View style={{ backgroundColor: 'rgba(20,184,166,0.15)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
            <Text style={{ color: '#14b8a6', fontSize: 11, fontWeight: '700' }}>USE THESE</Text>
          </View>
        </View>

        <View style={{ paddingHorizontal: 16, paddingTop: 11, paddingBottom: 14 }}>
          <Text style={{ color: '#475569', fontSize: 12, lineHeight: 17, marginBottom: 11 }}>
            Enter the top Earnings amount from each of these two Dayforce checks below.
          </Text>

          {matchedSettlementPeriod && (
            <View
              style={{
                backgroundColor: 'rgba(20,184,166,0.07)',
                borderRadius: 11,
                borderWidth: 1,
                borderColor: 'rgba(20,184,166,0.15)',
                padding: 12,
                marginBottom: 8,
              }}
            >
              <Text style={{ color: '#475569', fontSize: 11, fontWeight: '600', letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 4 }}>
                Settlement Check
              </Text>
              <Text style={{ color: '#14b8a6', fontSize: 15, fontWeight: '700' }}>{matchedSettlementPeriod}</Text>
              {matchedSettlementPayDate && (
                <Text style={{ color: '#475569', fontSize: 12, marginTop: 3 }}>Pay date: {matchedSettlementPayDate}</Text>
              )}
            </View>
          )}

          {matchedAdvancePeriod && (
            <View
              style={{
                backgroundColor: 'rgba(245,158,11,0.06)',
                borderRadius: 11,
                borderWidth: 1,
                borderColor: 'rgba(245,158,11,0.14)',
                padding: 12,
              }}
            >
              <Text style={{ color: '#475569', fontSize: 11, fontWeight: '600', letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 4 }}>
                Advance Check
              </Text>
              <Text style={{ color: '#f59e0b', fontSize: 15, fontWeight: '700' }}>{matchedAdvancePeriod}</Text>
              {matchedAdvancePayDate && (
                <Text style={{ color: '#475569', fontSize: 12, marginTop: 3 }}>Pay date: {matchedAdvancePayDate}</Text>
              )}
            </View>
          )}

          {!matchedSettlementPeriod && !matchedAdvancePeriod && (
            <Text style={{ color: '#475569', fontSize: 13, lineHeight: 18 }}>
              Could not compute Dayforce check dates from this FR. Enter your paycheck amounts below manually.
            </Text>
          )}
        </View>
      </View>
    </Animated.View>
  );
}

// ============================================
// Analyzing Screen
// ============================================
function AnalyzingView() {
  return (
    <Animated.View
      entering={FadeIn.duration(300)}
      style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 }}
    >
      <View
        style={{
          width: 72,
          height: 72,
          borderRadius: 20,
          backgroundColor: 'rgba(20,184,166,0.12)',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 24,
        }}
      >
        <Search size={32} color="#14b8a6" strokeWidth={1.5} />
      </View>

      <Text style={{ color: '#f1f5f9', fontSize: 20, fontWeight: '700', letterSpacing: -0.4, textAlign: 'center', marginBottom: 8 }}>
        Analyzing Flight Register
      </Text>
      <Text style={{ color: '#475569', fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 32 }}>
        Parsing totals and calculating expected pay using your current pay settings
      </Text>

      <ActivityIndicator color="#14b8a6" size="large" style={{ marginBottom: 28 }} />

      {['Parsing Flight Register totals...', 'Calculating expected gross pay...', 'Estimating net pay from your settings...', 'Building audit result...'].map((step, i) => (
        <View
          key={i}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: 'rgba(20,184,166,0.06)',
            borderRadius: 10,
            paddingHorizontal: 14,
            paddingVertical: 10,
            marginBottom: 6,
            width: '100%',
          }}
        >
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#14b8a6', marginRight: 10, opacity: 0.7 }} />
          <Text style={{ color: '#64748b', fontSize: 13 }}>{step}</Text>
        </View>
      ))}
    </Animated.View>
  );
}

// ============================================
// Result Card
// ============================================
function ResultCard({ result }: { result: PayAuditResult }) {
  const statusConfig = getAuditStatusConfig(result.auditStatus ?? null);
  const StatusIcon = statusConfig.Icon;
  const diffCents = result.auditDifferenceCents ?? 0;
  const absDiff = Math.abs(diffCents);
  const isOverpaid = diffCents < 0;
  const mode = result.comparisonMode ?? 'gross';

  return (
    <Animated.View entering={FadeInDown.duration(400).springify()}>
      <LinearGradient
        colors={['#0d1f35', '#0f172a']}
        style={{
          borderRadius: 20,
          borderWidth: 1,
          borderColor: '#1e2f45',
          padding: 20,
          marginBottom: 12,
        }}
      >
        <Text style={{ color: '#475569', fontSize: 11, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 16, textAlign: 'center' }}>
          Pay Audit Result
        </Text>

        {/* Status badge */}
        <View style={{ alignItems: 'center', marginBottom: 16 }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: statusConfig.bg,
              borderRadius: 20,
              paddingHorizontal: 16,
              paddingVertical: 9,
            }}
          >
            <StatusIcon size={16} color={statusConfig.color} strokeWidth={2} />
            <Text style={{ color: statusConfig.color, fontSize: 15, fontWeight: '700', marginLeft: 7 }}>
              {statusConfig.label}
            </Text>
          </View>
        </View>

        {/* Key numbers */}
        <View
          style={{
            backgroundColor: 'rgba(255,255,255,0.03)',
            borderRadius: 14,
            padding: 14,
            marginBottom: 14,
          }}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#475569', fontSize: 11, marginBottom: 3 }}>Expected Gross</Text>
              <Text style={{ color: '#f1f5f9', fontSize: 16, fontWeight: '700' }}>
                {formatCurrency(result.expectedGrossCents)}
              </Text>
            </View>
            <View style={{ flex: 1, alignItems: 'flex-end' }}>
              <Text style={{ color: '#475569', fontSize: 11, marginBottom: 3 }}>Estimated Net</Text>
              <Text style={{ color: '#94a3b8', fontSize: 16, fontWeight: '600' }}>
                {formatCurrency(result.estimatedNetCents)}
              </Text>
            </View>
          </View>

          <View style={{ height: 1, backgroundColor: '#1e2f45', marginBottom: 10 }} />

          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#475569', fontSize: 11, marginBottom: 3 }}>Settlement</Text>
              <Text style={{ color: '#f1f5f9', fontSize: 15, fontWeight: '600' }}>
                {formatCurrency(result.enteredSettlementCents)}
              </Text>
            </View>
            <View style={{ flex: 1, alignItems: 'flex-end' }}>
              <Text style={{ color: '#475569', fontSize: 11, marginBottom: 3 }}>Advance</Text>
              <Text style={{ color: '#f1f5f9', fontSize: 15, fontWeight: '600' }}>
                {formatCurrency(result.enteredAdvanceCents)}
              </Text>
            </View>
          </View>

          <View style={{ height: 1, backgroundColor: '#1e2f45', marginBottom: 10 }} />

          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View>
              <Text style={{ color: '#475569', fontSize: 11, marginBottom: 3 }}>
                Entered Total ({mode === 'net' ? 'vs Est. Net' : 'vs Exp. Gross'})
              </Text>
              <Text style={{ color: '#f1f5f9', fontSize: 15, fontWeight: '600' }}>
                {formatCurrency((result.enteredSettlementCents ?? 0) + (result.enteredAdvanceCents ?? 0))}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ color: '#475569', fontSize: 11, marginBottom: 3 }}>Difference</Text>
              <Text
                style={{
                  fontSize: 17,
                  fontWeight: '800',
                  color: absDiff <= 500 ? '#22c55e' : isOverpaid ? '#64748b' : '#f97316',
                }}
              >
                {diffCents >= 0 ? '+' : '-'}{formatCurrency(Math.abs(diffCents))}
              </Text>
            </View>
          </View>
        </View>

        {/* Summary */}
        <Text style={{ color: '#64748b', fontSize: 13, textAlign: 'center', lineHeight: 19, paddingHorizontal: 4 }}>
          {result.auditSummary ?? result.summary}
        </Text>

        {/* Source tags */}
        <View style={{ flexDirection: 'row', marginTop: 14, gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
          {['Flight Register', 'App Pay Engine', mode === 'net' ? 'Tax Settings' : 'Gross Mode'].map((src) => (
            <View key={src} style={{ backgroundColor: '#1e2f45', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }}>
              <Text style={{ color: '#64748b', fontSize: 11 }}>{src}</Text>
            </View>
          ))}
        </View>
      </LinearGradient>
    </Animated.View>
  );
}

// ============================================
// Key Findings
// ============================================
function FindingsSection({ findings }: { findings: string[] }) {
  if (!findings.length) return null;

  return (
    <Animated.View entering={FadeInDown.duration(400).delay(100).springify()}>
      <SectionCard title="Key Findings" accentColor="#f59e0b">
        {findings.map((finding, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 5 }}>
            <View
              style={{
                width: 5,
                height: 5,
                borderRadius: 2.5,
                backgroundColor: '#f59e0b',
                marginTop: 5,
                marginRight: 10,
                flexShrink: 0,
              }}
            />
            <Text style={{ color: '#94a3b8', fontSize: 13, flex: 1, lineHeight: 19 }}>{finding}</Text>
          </View>
        ))}
      </SectionCard>
    </Animated.View>
  );
}

// ============================================
// Pay Period Match Summary (inside details)
// ============================================
function PayPeriodMatchSummary({
  result,
  settlementDateInput = '',
  advanceDateInput = '',
}: {
  result: PayAuditResult;
  settlementDateInput?: string;
  advanceDateInput?: string;
}) {
  const frBeginDate = result.flightRegister.payPeriodStart;
  const settlement = result.matchedSettlementPeriod;
  const advance = result.matchedAdvancePeriod;

  const settlStatus = computeStubMatchStatus(settlementDateInput, settlement);
  const advStatus = computeStubMatchStatus(advanceDateInput, advance);
  const settlCfg = getStubMatchStatusConfig(settlStatus);
  const advCfg = getStubMatchStatusConfig(advStatus);

  return (
    <SectionCard title="Pay Period Match Summary" accentColor="#0ea5e9">
      {frBeginDate && <DataRow label="FR Begin Date" value={frBeginDate} highlight />}
      <View style={{ height: 1, backgroundColor: '#1e2f45', marginVertical: 8 }} />

      {/* Settlement row */}
      <Text style={{ color: '#475569', fontSize: 11, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 6 }}>
        Settlement Stub
      </Text>
      <DataRow label="Recommended" value={settlement ?? '—'} />
      <DataRow label="You Entered" value={settlementDateInput.trim() || '—'} />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 5 }}>
        <Text style={{ color: '#64748b', fontSize: 13, flex: 1 }}>Match Status</Text>
        <View style={{ backgroundColor: settlCfg.bg, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 3 }}>
          <Text style={{ color: settlCfg.color, fontSize: 12, fontWeight: '700' }}>{settlCfg.label}</Text>
        </View>
      </View>

      <View style={{ height: 1, backgroundColor: '#1e2f45', marginVertical: 8 }} />

      {/* Advance row */}
      <Text style={{ color: '#475569', fontSize: 11, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 6 }}>
        Advance Stub
      </Text>
      <DataRow label="Recommended" value={advance ?? '—'} />
      <DataRow label="You Entered" value={advanceDateInput.trim() || '—'} />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 5 }}>
        <Text style={{ color: '#64748b', fontSize: 13, flex: 1 }}>Match Status</Text>
        <View style={{ backgroundColor: advCfg.bg, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 3 }}>
          <Text style={{ color: advCfg.color, fontSize: 12, fontWeight: '700' }}>{advCfg.label}</Text>
        </View>
      </View>
    </SectionCard>
  );
}

// ============================================
// Detail Sections
// ============================================
function DetailSections({
  result,
  settlementDateInput = '',
  advanceDateInput = '',
}: {
  result: PayAuditResult;
  settlementDateInput?: string;
  advanceDateInput?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const fr = result.flightRegister;
  const jaHours = fr.jaHours || fr.ja2Hours;

  return (
    <Animated.View entering={FadeInDown.duration(400).delay(200).springify()}>
      <Pressable
        onPress={() => { Haptics.selectionAsync(); setExpanded((v) => !v); }}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: pressed ? '#1e2f45' : '#131f30',
          borderRadius: 12,
          borderWidth: 1,
          borderColor: '#1e2f45',
          paddingVertical: 13,
          marginBottom: 12,
        })}
      >
        <Text style={{ color: '#64748b', fontSize: 14, fontWeight: '500', marginRight: 6 }}>
          {expanded ? 'Hide Details' : 'View Details'}
        </Text>
        {expanded ? <ChevronUp size={15} color="#64748b" strokeWidth={2} /> : <ChevronDown size={15} color="#64748b" strokeWidth={2} />}
      </Pressable>

      {expanded && (
        <>
          {/* Flight Register Summary */}
          <SectionCard title="Flight Register Summary" accentColor="#14b8a6">
            <DataRow
              label="Pay Period"
              value={fr.payPeriodStart && fr.payPeriodEnd ? `${fr.payPeriodStart} – ${fr.payPeriodEnd}` : fr.payPeriodStart ?? '—'}
            />
            <DataRow label="Beginning Pay Credit" value={fr.beginningPayCredit ?? '—'} />
            <DataRow label="Ending Pay Credit" value={fr.endingPayCredit ?? '—'} highlight />
            <DataRow label="Duty Days" value={fr.dutyDays != null ? `${fr.dutyDays} days` : '—'} />
            {jaHours && <DataRow label="JA Hours" value={jaHours} highlight positive />}
            {fr.ja2Hours && <DataRow label="JA2 Hours" value={fr.ja2Hours} />}
            <DataRow label="Block Hours Paid" value={fr.blockHoursPaid ?? '—'} />
          </SectionCard>

          {/* Expected Pay Breakdown */}
          <SectionCard title="Expected Pay Breakdown" accentColor="#818cf8">
            <DataRow label="Pay Rate on File" value={`$${result.appData.payRate.toFixed(2)}/hr`} highlight />
            {result.appData.position && <DataRow label="Position" value={result.appData.position} />}
            {result.appData.base && <DataRow label="Base / Domicile" value={result.appData.base} />}
            {result.expectedGrossBreakdown ? (
              <>
                <View style={{ height: 1, backgroundColor: '#1e2f45', marginVertical: 8 }} />
                <DataRow
                  label="Guarantee / Base (2 × 37.5 hrs)"
                  value={formatCurrency(result.expectedGrossBreakdown.guaranteeCents)}
                  highlight
                />
                <DataRow
                  label="JA at 150%"
                  value={formatCurrency(result.expectedGrossBreakdown.jaCents)}
                  positive={result.expectedGrossBreakdown.jaCents > 0}
                />
                {result.expectedGrossBreakdown.premiumPayCents > 0 && (
                  <DataRow
                    label="Premium Pay"
                    value={formatCurrency(result.expectedGrossBreakdown.premiumPayCents)}
                    positive
                  />
                )}
                {result.expectedGrossBreakdown.overUnderCents !== 0 && (
                  <DataRow
                    label="Over / Under Guarantee"
                    value={formatCurrency(result.expectedGrossBreakdown.overUnderCents)}
                    warn={result.expectedGrossBreakdown.overUnderCents < 0}
                    positive={result.expectedGrossBreakdown.overUnderCents > 0}
                  />
                )}
                {result.expectedGrossBreakdown.taxablePdmCents > 0 && (
                  <DataRow
                    label="Taxable PDM in Earnings"
                    value={formatCurrency(result.expectedGrossBreakdown.taxablePdmCents)}
                  />
                )}
                <View style={{ height: 1, backgroundColor: '#1e2f45', marginVertical: 8 }} />
              </>
            ) : (
              <>
                <DataRow label="Guarantee Baseline" value="75:00" />
                <DataRow label="Ending Pay Credit" value={fr.endingPayCredit ?? '—'} />
                {jaHours && <DataRow label="JA at 150%" value={jaHours} positive />}
                <View style={{ height: 1, backgroundColor: '#1e2f45', marginVertical: 8 }} />
              </>
            )}
            <DataRow label="Expected Gross" value={formatCurrency(result.expectedGrossCents)} highlight />
            {result.estimatedNetCents != null && (
              <DataRow label="Estimated Net" value={formatCurrency(result.estimatedNetCents)} />
            )}
          </SectionCard>

          {/* Entered Paychecks */}
          <SectionCard title="Entered Paychecks" accentColor="#f59e0b">
            <DataRow label="Settlement Check" value={formatCurrency(result.enteredSettlementCents)} highlight />
            <DataRow label="Advance Check" value={formatCurrency(result.enteredAdvanceCents)} />
            <DataRow
              label="Combined Total"
              value={formatCurrency((result.enteredSettlementCents ?? 0) + (result.enteredAdvanceCents ?? 0))}
              highlight
            />
            <DataRow label="Comparison Mode" value={result.comparisonMode === 'net' ? 'Net Pay' : 'Gross Pay'} />
          </SectionCard>

          {/* Pay Period Match Summary */}
          <PayPeriodMatchSummary
            result={result}
            settlementDateInput={settlementDateInput}
            advanceDateInput={advanceDateInput}
          />

          {/* Difference Analysis */}
          <SectionCard title="Difference Analysis" accentColor={Math.abs(result.auditDifferenceCents ?? 0) > 5000 ? '#ef4444' : '#22c55e'}>
            <DataRow
              label={result.comparisonMode === 'net' ? 'Expected (Est. Net)' : 'Expected (Gross)'}
              value={formatCurrency(result.comparisonMode === 'net' ? result.estimatedNetCents : result.expectedGrossCents)}
              highlight
            />
            <DataRow label="Entered Total" value={formatCurrency((result.enteredSettlementCents ?? 0) + (result.enteredAdvanceCents ?? 0))} />
            <DataRow
              label="Difference"
              value={`${(result.auditDifferenceCents ?? 0) >= 0 ? '+' : ''}${formatCurrency(result.auditDifferenceCents)}`}
              highlight
              warn={Math.abs(result.auditDifferenceCents ?? 0) > 5000}
              positive={Math.abs(result.auditDifferenceCents ?? 0) <= 500}
            />
            <View
              style={{
                backgroundColor: 'rgba(100,116,139,0.06)',
                borderRadius: 10,
                padding: 10,
                marginTop: 6,
              }}
            >
              <Text style={{ color: '#64748b', fontSize: 12, lineHeight: 17 }}>
                {result.comparisonMode === 'net'
                  ? 'Net comparison is an estimate based on your saved Pay Summary tax and deduction settings. Actual payroll withholding may vary slightly.'
                  : 'Gross comparison reflects the expected taxable earnings before deductions based on your Flight Register totals.'}
              </Text>
            </View>
          </SectionCard>
        </>
      )}
    </Animated.View>
  );
}

// ============================================
// Main Screen
// ============================================
export default function PayAuditScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [step, setStep] = useState<Step>('upload');
  const [frImages, setFrImages] = useState<SelectedImage[]>([]);
  const [settlementCents, setSettlementCents] = useState<number>(0);
  const [advanceCents, setAdvanceCents] = useState<number>(0);
  const [settlementDateInput, setSettlementDateInput] = useState<string>('');
  const [advanceDateInput, setAdvanceDateInput] = useState<string>('');
  const [comparisonMode, setComparisonMode] = useState<ComparisonMode>('gross');
  const [result, setResult] = useState<PayAuditResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [frProcessResult, setFrProcessResult] = useState<FRProcessResult | null>(null);
  const [frProcessError, setFrProcessError] = useState<string | null>(null);

  const frProcessed = frProcessResult !== null;
  const canRun = frProcessed && frImages.length > 0;

  // ---- Image picking ----
  const addImages = useCallback(async (fromCamera: boolean) => {
    Haptics.selectionAsync();
    try {
      let picked: ImagePicker.ImagePickerResult;

      if (fromCamera) {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          Alert.alert('Camera Access', 'Camera permission is required.');
          return;
        }
        picked = await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          quality: 0.8,
          base64: true,
        });
      } else {
        picked = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsMultipleSelection: true,
          quality: 0.8,
          base64: true,
          selectionLimit: 6,
        });
      }

      if (picked.canceled || !picked.assets?.length) return;

      const newImages: SelectedImage[] = picked.assets
        .filter((a) => a.base64)
        .map((a) => ({ uri: a.uri, base64: a.base64 ?? null }));

      setFrImages((prev) => [...prev, ...newImages].slice(0, 6));
      setFrProcessResult(null);
      setFrProcessError(null);
    } catch (e) {
      console.error('[PayAudit] Image pick error:', e);
    }
  }, []);

  const removeImage = useCallback((idx: number) => {
    setFrImages((prev) => prev.filter((_, i) => i !== idx));
    setFrProcessResult(null);
    setFrProcessError(null);
  }, []);

  // ---- Process Flight Register (step 1) ----
  const processFR = useCallback(async () => {
    if (frImages.length === 0) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setStep('processing');
    setFrProcessResult(null);
    setFrProcessError(null);
    setError(null);

    try {
      const body = {
        flightRegisterImages: frImages
          .filter((img) => img.base64)
          .map((img) => img.base64 as string),
        mimeType: 'image/jpeg',
      };
      const res = await api.post<FRProcessResult>('/api/pay-audit/process-fr', body, 45000);
      setFrProcessResult(res);
      setStep('upload');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      const raw = e instanceof Error ? e.message : '';
      const isVague = !raw || raw.toLowerCase() === 'not found' || raw.toLowerCase() === 'service temporarily unavailable. please try again in a moment.';
      const msg = isVague || (e as any)?.status === 404
        ? 'Could not reach the server. Please check your connection and try again.'
        : raw || 'Failed to process Flight Register. Please try again.';
      setFrProcessError(msg);
      setStep('upload');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }, [frImages]);

  // ---- Run audit (step 2) ----
  const runAudit = useCallback(async () => {
    if (!canRun) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setStep('analyzing');
    setError(null);

    try {
      const body = {
        flightRegisterImages: frImages
          .filter((img) => img.base64)
          .map((img) => img.base64 as string),
        mimeType: 'image/jpeg',
        settlementAmountCents: settlementCents,
        advanceAmountCents: advanceCents,
        comparisonMode,
      };

      const res = await api.post<PayAuditResult>('/api/pay-audit/analyze', body, 90000);
      setResult(res);
      setStep('result');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      const raw = e instanceof Error ? e.message : '';
      const isVague = !raw || raw.toLowerCase() === 'not found' || raw.toLowerCase() === 'service temporarily unavailable. please try again in a moment.';
      const msg = isVague || (e as any)?.status === 404
        ? 'Could not reach the server. Please check your connection and try again.'
        : raw || 'Analysis failed. Please try again.';
      setError(msg);
      setStep('upload');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }, [canRun, frImages, settlementCents, advanceCents, comparisonMode]);

  // ---- Reset ----
  const reset = useCallback(() => {
    setStep('upload');
    setFrImages([]);
    setSettlementCents(0);
    setAdvanceCents(0);
    setSettlementDateInput('');
    setAdvanceDateInput('');
    setComparisonMode('gross');
    setResult(null);
    setError(null);
    setFrProcessResult(null);
    setFrProcessError(null);
  }, []);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: '#070e1a' }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View
        style={{
          paddingTop: insets.top,
          backgroundColor: '#070e1a',
          borderBottomWidth: step === 'analyzing' || step === 'processing' ? 0 : 1,
          borderBottomColor: '#1e2f45',
        }}
      >
        {step !== 'analyzing' && step !== 'processing' && (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: 20,
              paddingVertical: 14,
            }}
          >
            <Pressable
              onPress={() => { if (step === 'result') { reset(); } else { router.back(); } }}
              style={({ pressed }) => ({
                width: 38,
                height: 38,
                borderRadius: 19,
                backgroundColor: pressed ? '#1e293b' : '#0f1c2e',
                borderWidth: 1,
                borderColor: '#1e3555',
                alignItems: 'center',
                justifyContent: 'center',
                marginRight: 14,
              })}
            >
              {step === 'result' ? (
                <RefreshCw size={16} color="#94a3b8" strokeWidth={2} />
              ) : (
                <ArrowLeft size={16} color="#94a3b8" strokeWidth={2} />
              )}
            </Pressable>

            <View style={{ flex: 1 }}>
              <Text style={{ color: '#f8fafc', fontSize: 20, fontWeight: '800', letterSpacing: -0.6 }}>
                Pay Audit
              </Text>
              <Text style={{ color: '#334155', fontSize: 12, marginTop: 1 }}>
                {step === 'upload' ? 'Flight Register + paycheck verification' : 'Audit Result'}
              </Text>
            </View>

            <View
              style={{
                backgroundColor: step === 'upload' && frProcessed ? 'rgba(20,184,166,0.12)' : '#0f1c2e',
                borderRadius: 10,
                paddingHorizontal: 11,
                paddingVertical: 5,
                borderWidth: 1,
                borderColor: step === 'upload' && frProcessed ? 'rgba(20,184,166,0.3)' : '#1e3555',
              }}
            >
              <Text style={{
                color: step === 'upload' && frProcessed ? '#14b8a6' : '#475569',
                fontSize: 11,
                fontWeight: '700',
                letterSpacing: 0.3,
              }}>
                {step === 'upload' && !frProcessed ? 'STEP 1 OF 2' : step === 'upload' && frProcessed ? 'STEP 2 OF 2' : 'RESULT'}
              </Text>
            </View>
          </View>
        )}
      </View>

      {/* Processing (FR parse) */}
      {step === 'processing' && (
        <View style={{ flex: 1, backgroundColor: '#070e1a' }}>
          <ProcessingView />
        </View>
      )}

      {/* Analyzing */}
      {step === 'analyzing' && (
        <View style={{ flex: 1, backgroundColor: '#070e1a' }}>
          <AnalyzingView />
        </View>
      )}

      {/* Upload step */}
      {step === 'upload' && (
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingTop: 16,
            paddingBottom: insets.bottom + 110,
          }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Info banner */}
          <Animated.View entering={FadeInDown.duration(300).springify()}>
            <LinearGradient
              colors={['rgba(20,184,166,0.12)', 'rgba(20,184,166,0.05)']}
              style={{
                borderRadius: 16,
                borderWidth: 1,
                borderColor: 'rgba(20,184,166,0.25)',
                padding: 16,
                marginBottom: 16,
                flexDirection: 'row',
                alignItems: 'flex-start',
              }}
            >
              <View
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 9,
                  backgroundColor: 'rgba(20,184,166,0.18)',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginRight: 12,
                  flexShrink: 0,
                  marginTop: 1,
                }}
              >
                <TrendingUp size={16} color="#14b8a6" strokeWidth={2.5} />
              </View>
              <Text style={{ color: '#5eead4', fontSize: 13, lineHeight: 19, flex: 1, fontWeight: '500' }}>
                {frProcessed
                  ? 'Flight Register processed. Enter your Settlement and Advance earnings below, then run the audit.'
                  : 'Upload your Flight Register pages, then tap Process to parse the register and match your Dayforce check dates.'}
              </Text>
            </LinearGradient>
          </Animated.View>

          {/* FR process error */}
          {frProcessError && (
            <Animated.View entering={FadeIn.duration(200)}>
              <View
                style={{
                  backgroundColor: 'rgba(239,68,68,0.08)',
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: 'rgba(239,68,68,0.2)',
                  padding: 12,
                  marginBottom: 14,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                  <AlertTriangle size={15} color="#ef4444" strokeWidth={2} style={{ marginTop: 1, marginRight: 8, flexShrink: 0 }} />
                  <Text style={{ color: '#fca5a5', fontSize: 13, flex: 1, lineHeight: 18 }}>{frProcessError}</Text>
                </View>
                {frImages.length > 0 && (
                  <Pressable
                    onPress={processFR}
                    style={({ pressed }) => ({
                      marginTop: 10,
                      alignSelf: 'flex-start',
                      paddingHorizontal: 12,
                      paddingVertical: 6,
                      borderRadius: 8,
                      backgroundColor: pressed ? 'rgba(239,68,68,0.2)' : 'rgba(239,68,68,0.12)',
                      borderWidth: 1,
                      borderColor: 'rgba(239,68,68,0.3)',
                    })}
                  >
                    <Text style={{ color: '#fca5a5', fontSize: 12, fontWeight: '600' }}>Tap to Retry</Text>
                  </Pressable>
                )}
              </View>
            </Animated.View>
          )}

          {/* Analyze error */}
          {error && (
            <Animated.View entering={FadeIn.duration(200)}>
              <View
                style={{
                  backgroundColor: 'rgba(239,68,68,0.08)',
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: 'rgba(239,68,68,0.2)',
                  padding: 12,
                  marginBottom: 14,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                  <AlertTriangle size={15} color="#ef4444" strokeWidth={2} style={{ marginTop: 1, marginRight: 8, flexShrink: 0 }} />
                  <Text style={{ color: '#fca5a5', fontSize: 13, flex: 1, lineHeight: 18 }}>{error}</Text>
                </View>
                <Pressable
                  onPress={runAudit}
                  style={({ pressed }) => ({
                    marginTop: 10,
                    alignSelf: 'flex-start',
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    borderRadius: 8,
                    backgroundColor: pressed ? 'rgba(239,68,68,0.2)' : 'rgba(239,68,68,0.12)',
                    borderWidth: 1,
                    borderColor: 'rgba(239,68,68,0.3)',
                  })}
                >
                  <Text style={{ color: '#fca5a5', fontSize: 12, fontWeight: '600' }}>Tap to Retry</Text>
                </Pressable>
              </View>
            </Animated.View>
          )}

          {/* Flight Register upload */}
          <Animated.View entering={FadeInDown.duration(350).delay(50).springify()}>
            <ImageUploadSection
              images={frImages}
              onAdd={addImages}
              onRemove={removeImage}
              disabled={false}
            />
          </Animated.View>

          {/* Pre-process: upload guidance */}
          {!frProcessed && frImages.length < 2 && (
            <Animated.View entering={FadeIn.duration(200)}>
              <View
                style={{
                  backgroundColor: '#0f1c2e',
                  borderRadius: 11,
                  borderWidth: 1,
                  borderColor: '#1e2f45',
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  marginBottom: 12,
                  flexDirection: 'row',
                  alignItems: 'flex-start',
                }}
              >
                <Info size={13} color="#475569" strokeWidth={2} style={{ marginTop: 1, marginRight: 8, flexShrink: 0 }} />
                <Text style={{ color: '#475569', fontSize: 12, lineHeight: 17, flex: 1 }}>
                  {frImages.length === 0
                    ? 'Upload the register page and totals page to continue.'
                    : 'For best results, also include the totals page.'}
                </Text>
              </View>
            </Animated.View>
          )}

          {/* Post-process: matched Dayforce dates */}
          {frProcessed && frProcessResult && (
            <FRMatchedDatesPreview frResult={frProcessResult} />
          )}

          {/* Post-process: earnings inputs */}
          {frProcessed && (
            <>
              <Animated.View entering={FadeInDown.duration(350).delay(50).springify()}>
                <PaycheckInputSection
                  settlementCents={settlementCents}
                  advanceCents={advanceCents}
                  onSettlementChange={setSettlementCents}
                  onAdvanceChange={setAdvanceCents}
                  settlementDateInput={settlementDateInput}
                  advanceDateInput={advanceDateInput}
                  onSettlementDateChange={setSettlementDateInput}
                  onAdvanceDateChange={setAdvanceDateInput}
                />
              </Animated.View>

              <Animated.View entering={FadeInDown.duration(350).delay(100).springify()}>
                <ComparisonModeSelector mode={comparisonMode} onChange={setComparisonMode} />
              </Animated.View>
            </>
          )}

          {/* Tips (only before processing) */}
          {!frProcessed && (
            <View
              style={{
                backgroundColor: '#131f30',
                borderRadius: 14,
                borderWidth: 1,
                borderColor: '#1e2f45',
                padding: 14,
                marginBottom: 16,
              }}
            >
              <Text style={{ color: '#475569', fontSize: 12, fontWeight: '600', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 8 }}>
                Tips for best results
              </Text>
              {[
                'Include the full TOTALS section of the Flight Register',
                'Include any Over/Under Guarantee, Premium Pay, and PDM line items in the FR photo',
                'For Gross mode, enter the top Earnings amount from each Dayforce check',
                'After the audit runs, the app shows exactly which Dayforce stub dates to use',
                'Net mode uses your saved Pay Summary tax and deduction settings',
              ].map((tip, i) => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 6 }}>
                  <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: '#1e2f45', marginTop: 5, marginRight: 8, flexShrink: 0 }} />
                  <Text style={{ color: '#475569', fontSize: 12, flex: 1, lineHeight: 17 }}>{tip}</Text>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      )}

      {/* Result step */}
      {step === 'result' && result && (
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingTop: 16,
            paddingBottom: insets.bottom + 40,
          }}
          showsVerticalScrollIndicator={false}
        >
          <DayforcePeriodGuidanceCard
            result={result}
            settlementDateInput={settlementDateInput}
            advanceDateInput={advanceDateInput}
          />
          <ResultCard result={result} />
          <FindingsSection findings={result.findings} />
          <DetailSections
            result={result}
            settlementDateInput={settlementDateInput}
            advanceDateInput={advanceDateInput}
          />
        </ScrollView>
      )}

      {/* Bottom action */}
      {step === 'upload' && (
        <View
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            paddingHorizontal: 16,
            paddingBottom: insets.bottom + 12,
            paddingTop: 12,
            backgroundColor: '#070e1a',
            borderTopWidth: 1,
            borderTopColor: '#1e2f45',
          }}
        >
          {frProcessed ? (
            <>
              <Pressable
                onPress={runAudit}
                disabled={!canRun}
                style={({ pressed }) => ({
                  borderRadius: 14,
                  overflow: 'hidden',
                  opacity: !canRun ? 0.4 : pressed ? 0.9 : 1,
                  marginBottom: 8,
                })}
              >
                <LinearGradient
                  colors={['#14b8a6', '#0d9488']}
                  style={{ paddingVertical: 16, alignItems: 'center', justifyContent: 'center', flexDirection: 'row' }}
                >
                  <Search size={18} color="#fff" strokeWidth={2} />
                  <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700', marginLeft: 8, letterSpacing: -0.3 }}>
                    Calculate Audit
                  </Text>
                </LinearGradient>
              </Pressable>
              <Pressable
                onPress={processFR}
                style={({ pressed }) => ({
                  borderRadius: 12,
                  paddingVertical: 10,
                  alignItems: 'center',
                  backgroundColor: pressed ? '#1e2f45' : 'transparent',
                })}
              >
                <Text style={{ color: '#475569', fontSize: 13, fontWeight: '500' }}>
                  Reprocess Register
                </Text>
              </Pressable>
            </>
          ) : (
            <>
              <Pressable
                onPress={processFR}
                disabled={frImages.length === 0}
                style={({ pressed }) => ({
                  borderRadius: 14,
                  overflow: 'hidden',
                  opacity: frImages.length === 0 ? 0.4 : pressed ? 0.9 : 1,
                })}
              >
                <LinearGradient
                  colors={frImages.length > 0 ? ['#14b8a6', '#0d9488'] : ['#1e2f45', '#1e2f45']}
                  style={{ paddingVertical: 16, alignItems: 'center', justifyContent: 'center', flexDirection: 'row' }}
                >
                  <FileText size={18} color={frImages.length > 0 ? '#fff' : '#64748b'} strokeWidth={2} />
                  <Text style={{ color: frImages.length > 0 ? '#fff' : '#64748b', fontSize: 16, fontWeight: '700', marginLeft: 8, letterSpacing: -0.3 }}>
                    Process Flight Register
                  </Text>
                </LinearGradient>
              </Pressable>
              {frImages.length === 0 && (
                <Text style={{ color: '#334155', fontSize: 12, textAlign: 'center', marginTop: 8 }}>
                  Upload at least one Flight Register page to continue
                </Text>
              )}
            </>
          )}
        </View>
      )}
    </KeyboardAvoidingView>
  );
}
