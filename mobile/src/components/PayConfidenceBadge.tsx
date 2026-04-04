/**
 * PayConfidenceBadge Component
 *
 * Displays a badge indicating pay confidence status.
 * Shows "Verified" (green) for verified pay airlines or
 * "Estimated" (amber) for AI-guided pay airlines.
 *
 * IMPORTANT: Never uses "tier" language - only "Verified" or "Estimated"
 */

import React from "react";
import { View, Text, Pressable } from "react-native";
import { ShieldCheck, TrendingUp } from "lucide-react-native";
import { usePayConfidence } from "@/lib/state/pay-confidence-context";
import { cn } from "@/lib/cn";

interface PayConfidenceBadgeProps {
  /** Additional class names */
  className?: string;
  /** Size variant */
  size?: "sm" | "md" | "lg";
  /** Show icon */
  showIcon?: boolean;
  /** Show full label or just indicator */
  variant?: "full" | "compact" | "dot";
  /** Callback when pressed */
  onPress?: () => void;
}

export function PayConfidenceBadge({
  className = "",
  size = "sm",
  showIcon = true,
  variant = "full",
  onPress,
}: PayConfidenceBadgeProps) {
  const { isVerified, confidenceLabel, getPayBadgeColor } = usePayConfidence();
  const colors = getPayBadgeColor();

  const sizeClasses = {
    sm: "px-2 py-0.5 text-xs",
    md: "px-3 py-1 text-sm",
    lg: "px-4 py-1.5 text-base",
  };

  const iconSizes = {
    sm: 12,
    md: 14,
    lg: 16,
  };

  // Dot variant - just a small colored indicator
  if (variant === "dot") {
    return (
      <View
        className={cn(
          "w-2 h-2 rounded-full",
          isVerified ? "bg-emerald-500" : "bg-amber-500",
          className
        )}
      />
    );
  }

  // Compact variant - just icon
  if (variant === "compact") {
    const Icon = isVerified ? ShieldCheck : TrendingUp;
    return (
      <View
        className={cn(
          "rounded-full p-1",
          colors.bg,
          className
        )}
      >
        <Icon
          size={iconSizes[size]}
          color={isVerified ? "#34d399" : "#fbbf24"}
        />
      </View>
    );
  }

  // Full variant - badge with label
  const Icon = isVerified ? ShieldCheck : TrendingUp;
  const content = (
    <View
      className={cn(
        "flex-row items-center rounded-full border",
        sizeClasses[size],
        colors.bg,
        colors.border,
        className
      )}
    >
      {showIcon && (
        <Icon
          size={iconSizes[size]}
          color={isVerified ? "#34d399" : "#fbbf24"}
          style={{ marginRight: 4 }}
        />
      )}
      <Text className={cn("font-medium", colors.text)}>
        {confidenceLabel}
      </Text>
    </View>
  );

  if (onPress) {
    return (
      <Pressable onPress={onPress} className="active:opacity-70">
        {content}
      </Pressable>
    );
  }

  return content;
}

/**
 * PayAmountDisplay Component
 *
 * Displays a pay amount with appropriate confidence styling.
 * Verified: Shows exact amount with green indicator
 * AI-Guided: Shows amount with "~" prefix and amber indicator
 */
interface PayAmountDisplayProps {
  /** Amount in cents */
  cents: number;
  /** Additional class names for the amount text */
  className?: string;
  /** Size variant */
  size?: "sm" | "md" | "lg" | "xl";
  /** Show confidence badge inline */
  showBadge?: boolean;
  /** Use compact formatting */
  compact?: boolean;
}

export function PayAmountDisplay({
  cents,
  className = "",
  size = "md",
  showBadge = false,
  compact = false,
}: PayAmountDisplayProps) {
  const { isVerified, formatPayAmount, getPayBadgeColor } = usePayConfidence();
  const colors = getPayBadgeColor();

  const sizeClasses = {
    sm: "text-sm",
    md: "text-base",
    lg: "text-xl",
    xl: "text-3xl",
  };

  const formattedAmount = formatPayAmount(cents, { compact });

  return (
    <View className="flex-row items-center">
      <Text
        className={cn(
          "font-bold",
          sizeClasses[size],
          isVerified ? "text-white" : "text-amber-100",
          className
        )}
      >
        {formattedAmount}
      </Text>
      {showBadge && (
        <View className="ml-2">
          <PayConfidenceBadge size="sm" variant="compact" />
        </View>
      )}
    </View>
  );
}

/**
 * PayRangeDisplay Component
 *
 * Displays a pay range for AI-guided airlines or exact amount for verified.
 */
interface PayRangeDisplayProps {
  /** Amount in cents */
  cents: number;
  /** Variance percentage for range calculation */
  variancePercent?: number;
  /** Additional class names */
  className?: string;
  /** Size variant */
  size?: "sm" | "md" | "lg";
}

export function PayRangeDisplay({
  cents,
  variancePercent = 5,
  className = "",
  size = "md",
}: PayRangeDisplayProps) {
  const { isVerified, formatPayRange } = usePayConfidence();

  const sizeClasses = {
    sm: "text-sm",
    md: "text-base",
    lg: "text-xl",
  };

  const formattedAmount = formatPayRange(cents, variancePercent);

  return (
    <Text
      className={cn(
        "font-semibold",
        sizeClasses[size],
        isVerified ? "text-white" : "text-amber-200",
        className
      )}
    >
      {formattedAmount}
    </Text>
  );
}

/**
 * PayConfidenceInfoCard Component
 *
 * Card explaining the user's pay confidence mode
 */
interface PayConfidenceInfoCardProps {
  /** Additional class names */
  className?: string;
  /** Callback to dismiss */
  onDismiss?: () => void;
}

export function PayConfidenceInfoCard({
  className = "",
  onDismiss,
}: PayConfidenceInfoCardProps) {
  const { isVerified, confidenceLabel, confidenceDescription, getPayBadgeColor } =
    usePayConfidence();
  const colors = getPayBadgeColor();

  return (
    <View
      className={cn(
        "rounded-xl p-4 border",
        colors.bg,
        colors.border,
        className
      )}
    >
      <View className="flex-row items-center mb-2">
        {isVerified ? (
          <ShieldCheck size={20} color="#34d399" />
        ) : (
          <TrendingUp size={20} color="#fbbf24" />
        )}
        <Text className={cn("ml-2 font-semibold text-base", colors.text)}>
          {confidenceLabel} Pay Mode
        </Text>
      </View>
      <Text className="text-slate-300 text-sm leading-relaxed">
        {confidenceDescription}
      </Text>
      {!isVerified && (
        <Text className="text-slate-400 text-xs mt-2 italic">
          Full tracking and AI explanations available. Amounts shown as estimates.
        </Text>
      )}
    </View>
  );
}
