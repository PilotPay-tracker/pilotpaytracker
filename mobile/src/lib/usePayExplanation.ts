/**
 * Pay Explanation Hooks
 * React Query hooks for AI-powered pay statement explanations
 */

import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { useSession } from "./useSession";
import type {
  PayExplanationRequest,
  PayExplanationResponse,
  PayExplanationSection,
} from "@/lib/contracts";

// ============================================
// TYPES
// ============================================

export type { PayExplanationSection, PayExplanationRequest, PayExplanationResponse };

interface AIStatusResponse {
  openai: boolean;
  anthropic: boolean;
  grok: boolean;
  google: boolean;
  elevenlabs: boolean;
}

// ============================================
// HOOKS
// ============================================

/**
 * Check if AI services are available
 */
export function useAIStatus() {
  const { data: session } = useSession();
  const isAuthenticated = !!session?.user;

  return useQuery({
    queryKey: ["ai-status"],
    queryFn: () => api.get<AIStatusResponse>("/api/ai/status"),
    enabled: isAuthenticated,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Request an AI explanation for a pay statement section
 */
export function usePayExplanation() {
  return useMutation({
    mutationFn: async (request: PayExplanationRequest) => {
      const response = await api.post<PayExplanationResponse>(
        "/api/ai/pay-explanation",
        request
      );
      return response;
    },
  });
}

// ============================================
// HELPERS
// ============================================

/**
 * Get display label for explanation section
 */
export function getSectionLabel(section: PayExplanationSection): string {
  const labels: Record<PayExplanationSection, string> = {
    FULL_STATEMENT: "Full Statement",
    EARNINGS: "Earnings",
    TAXES: "Taxes",
    DEDUCTIONS: "Deductions",
    REIMBURSEMENTS: "Reimbursements",
    NET_PAY: "Net Pay",
    DIFFERENCE: "Projected vs Actual",
  };
  return labels[section];
}

/**
 * Get verification status color
 */
export function getVerificationColor(
  status: PayExplanationResponse["verificationStatus"]
): { bg: string; text: string; border: string } {
  const colors = {
    VERIFIED: {
      bg: "bg-green-500/10",
      text: "text-green-400",
      border: "border-green-500/50",
    },
    ESTIMATED: {
      bg: "bg-amber-500/10",
      text: "text-amber-400",
      border: "border-amber-500/50",
    },
    MISMATCH: {
      bg: "bg-red-500/10",
      text: "text-red-400",
      border: "border-red-500/50",
    },
    REVIEW_RECOMMENDED: {
      bg: "bg-orange-500/10",
      text: "text-orange-400",
      border: "border-orange-500/50",
    },
  };
  return colors[status];
}

/**
 * Get verification status label
 */
export function getVerificationLabel(
  status: PayExplanationResponse["verificationStatus"]
): string {
  const labels = {
    VERIFIED: "Verified",
    ESTIMATED: "Estimated",
    MISMATCH: "Mismatch Found",
    REVIEW_RECOMMENDED: "Review Recommended",
  };
  return labels[status];
}
