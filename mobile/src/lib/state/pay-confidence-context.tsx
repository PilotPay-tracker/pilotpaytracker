/**
 * Pay Confidence Context
 *
 * Provides pay confidence mode functionality throughout the app.
 * This is internal logic that controls how pay calculations are displayed
 * and labeled, using "Verified" or "Estimated" language (never "tier").
 *
 * ## Pay Confidence Modes
 *
 * - VERIFIED: High-confidence automated pay calculations with verified dollar amounts.
 *   Airlines have full contract rule implementation.
 *
 * - AI_GUIDED: Full tracking with AI explanations, but pay shown as estimates/ranges.
 *   Complete platform access, just with confidence-appropriate labeling.
 *
 * ## Key Principle
 * "All pilots get the same tracking platform. Pay calculations are labeled
 * by confidence to protect accuracy and trust."
 *
 * Usage:
 *   const { isVerified, confidenceLabel, formatPayAmount } = usePayConfidence();
 *   <Text>{formatPayAmount(12500)}</Text>
 *   // Verified airline: "$125.00 Verified"
 *   // AI-Guided airline: "~$125.00 Estimated"
 */

import React, { createContext, useContext, useMemo, useCallback } from "react";
import { useProfile } from "./profile-store";
import {
  getPayConfidenceMode,
  isVerifiedPayAirline,
  getPayConfidenceLabel,
  getPayConfidenceDescription,
  type PayConfidenceMode,
} from "../data/airline-alias-packs";

// ============================================
// CONTEXT TYPE
// ============================================

interface PayConfidenceContextValue {
  /** Current airline ID */
  airlineId: string;
  /** Current pay confidence mode */
  mode: PayConfidenceMode;
  /** Whether airline has verified pay mode */
  isVerified: boolean;
  /** "Verified" or "Estimated" */
  confidenceLabel: string;
  /** Description of current mode */
  confidenceDescription: string;
  /**
   * Format a pay amount with appropriate prefix/suffix based on confidence
   * Verified: "$125.00"
   * AI-Guided: "~$125.00" (with tilde prefix for estimate)
   */
  formatPayAmount: (cents: number, options?: PayFormatOptions) => string;
  /**
   * Format pay with range for AI-guided mode
   * Verified: "$125.00"
   * AI-Guided: "$120 - $130"
   */
  formatPayRange: (cents: number, variancePercent?: number) => string;
  /**
   * Get badge text for pay displays
   * Verified: "Verified Amount"
   * AI-Guided: "Estimated Range"
   */
  getPayBadgeText: () => string;
  /**
   * Get badge color for pay displays
   */
  getPayBadgeColor: () => { bg: string; text: string; border: string };
  /**
   * Check if grievance PDFs with dollar assertions can be generated
   */
  canGenerateGrievancePdf: boolean;
}

interface PayFormatOptions {
  /** Include confidence label after amount */
  includeLabel?: boolean;
  /** Use compact format ($125 vs $125.00) */
  compact?: boolean;
  /** Show as range for AI-guided mode */
  showRange?: boolean;
}

// ============================================
// FORMATTING UTILITIES
// ============================================

function formatCentsToUSD(cents: number, compact = false): string {
  const dollars = cents / 100;
  if (compact) {
    if (dollars >= 1000) {
      return `$${(dollars / 1000).toFixed(1)}k`;
    }
    return `$${Math.round(dollars)}`;
  }
  return dollars.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatRange(cents: number, variancePercent: number): string {
  const dollars = cents / 100;
  const variance = dollars * (variancePercent / 100);
  const low = Math.max(0, dollars - variance);
  const high = dollars + variance;
  return `$${Math.round(low)} - $${Math.round(high)}`;
}

// ============================================
// CONTEXT
// ============================================

const PayConfidenceContext = createContext<PayConfidenceContextValue | null>(
  null
);

// ============================================
// PROVIDER
// ============================================

export function PayConfidenceProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = useProfile();
  const airlineId = profile?.airline ?? "UPS";

  const mode = useMemo(() => getPayConfidenceMode(airlineId), [airlineId]);
  const isVerified = useMemo(() => mode === "verified", [mode]);
  const confidenceLabel = useMemo(
    () => getPayConfidenceLabel(airlineId),
    [airlineId]
  );
  const confidenceDescription = useMemo(
    () => getPayConfidenceDescription(airlineId),
    [airlineId]
  );

  const formatPayAmount = useCallback(
    (cents: number, options: PayFormatOptions = {}): string => {
      const { includeLabel = false, compact = false, showRange = false } = options;

      if (!isVerified && showRange) {
        return formatRange(cents, 5); // 5% variance for estimates
      }

      const amount = formatCentsToUSD(cents, compact);

      // For AI-guided mode, add tilde prefix to indicate estimate
      const prefix = isVerified ? "" : "~";
      const suffix = includeLabel ? ` ${confidenceLabel}` : "";

      return `${prefix}${amount}${suffix}`;
    },
    [isVerified, confidenceLabel]
  );

  const formatPayRange = useCallback(
    (cents: number, variancePercent = 5): string => {
      if (isVerified) {
        return formatCentsToUSD(cents);
      }
      return formatRange(cents, variancePercent);
    },
    [isVerified]
  );

  const getPayBadgeText = useCallback((): string => {
    return isVerified ? "Verified Amount" : "Estimated Range";
  }, [isVerified]);

  const getPayBadgeColor = useCallback((): {
    bg: string;
    text: string;
    border: string;
  } => {
    if (isVerified) {
      return {
        bg: "bg-emerald-500/20",
        text: "text-emerald-400",
        border: "border-emerald-500/30",
      };
    }
    return {
      bg: "bg-amber-500/20",
      text: "text-amber-400",
      border: "border-amber-500/30",
    };
  }, [isVerified]);

  const value = useMemo<PayConfidenceContextValue>(
    () => ({
      airlineId,
      mode,
      isVerified,
      confidenceLabel,
      confidenceDescription,
      formatPayAmount,
      formatPayRange,
      getPayBadgeText,
      getPayBadgeColor,
      canGenerateGrievancePdf: isVerified,
    }),
    [
      airlineId,
      mode,
      isVerified,
      confidenceLabel,
      confidenceDescription,
      formatPayAmount,
      formatPayRange,
      getPayBadgeText,
      getPayBadgeColor,
    ]
  );

  return (
    <PayConfidenceContext.Provider value={value}>
      {children}
    </PayConfidenceContext.Provider>
  );
}

// ============================================
// HOOKS
// ============================================

/**
 * Hook to access pay confidence context
 */
export function usePayConfidence(): PayConfidenceContextValue {
  const context = useContext(PayConfidenceContext);
  if (!context) {
    // Return default values if not in provider (shouldn't happen in prod)
    const isVerified = true;
    const confidenceLabel = "Verified";
    return {
      airlineId: "UPS",
      mode: "verified",
      isVerified,
      confidenceLabel,
      confidenceDescription: getPayConfidenceDescription("UPS"),
      formatPayAmount: (cents: number) => formatCentsToUSD(cents),
      formatPayRange: (cents: number) => formatCentsToUSD(cents),
      getPayBadgeText: () => "Verified Amount",
      getPayBadgeColor: () => ({
        bg: "bg-emerald-500/20",
        text: "text-emerald-400",
        border: "border-emerald-500/30",
      }),
      canGenerateGrievancePdf: true,
    };
  }
  return context;
}

/**
 * Hook to check if current airline has verified pay mode
 */
export function useIsVerifiedPay(): boolean {
  const { isVerified } = usePayConfidence();
  return isVerified;
}

/**
 * Hook to get pay confidence label
 */
export function usePayConfidenceLabel(): string {
  const { confidenceLabel } = usePayConfidence();
  return confidenceLabel;
}

/**
 * Hook to get pay formatting functions
 */
export function usePayFormatter(): {
  format: (cents: number, options?: PayFormatOptions) => string;
  formatRange: (cents: number, variance?: number) => string;
} {
  const { formatPayAmount, formatPayRange } = usePayConfidence();
  return {
    format: formatPayAmount,
    formatRange: formatPayRange,
  };
}

/**
 * Hook to check if grievance PDFs can be generated
 */
export function useCanGenerateGrievance(): boolean {
  const { canGenerateGrievancePdf } = usePayConfidence();
  return canGenerateGrievancePdf;
}

// ============================================
// COMPONENT: PayConfidenceBadge
// ============================================

interface PayConfidenceBadgeProps {
  className?: string;
  size?: "sm" | "md";
}

/**
 * Badge component showing pay confidence status
 * Shows "Verified" (green) or "Estimated" (amber)
 */
export function PayConfidenceBadge({
  className = "",
  size = "sm",
}: PayConfidenceBadgeProps) {
  const { confidenceLabel, getPayBadgeColor } = usePayConfidence();
  const colors = getPayBadgeColor();

  const sizeClasses = size === "sm" ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-sm";

  // Return null so we can import from React in the component
  // The actual rendering is done via className composition
  return null; // Actual JSX rendering should be in component files
}

// ============================================
// UTILITY FUNCTIONS (Non-hook, for use outside React)
// ============================================

/**
 * Check pay confidence mode for an airline (non-hook)
 */
export { getPayConfidenceMode, isVerifiedPayAirline, getPayConfidenceLabel };

/**
 * Format pay with confidence-appropriate styling (non-hook)
 */
export function formatPayWithConfidence(
  airlineId: string,
  cents: number,
  options: { compact?: boolean; includeLabel?: boolean } = {}
): string {
  const isVerified = isVerifiedPayAirline(airlineId);
  const { compact = false, includeLabel = false } = options;

  const amount = formatCentsToUSD(cents, compact);
  const prefix = isVerified ? "" : "~";
  const suffix = includeLabel ? ` ${getPayConfidenceLabel(airlineId)}` : "";

  return `${prefix}${amount}${suffix}`;
}
