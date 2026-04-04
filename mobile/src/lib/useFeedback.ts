/**
 * AI Feedback Hooks
 *
 * React Query hooks for collecting user feedback to improve AI accuracy.
 * This feedback is used to train and improve parsing, suggestions, and explanations.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";

// ============================================
// Types
// ============================================

export type EntityType = "trip" | "leg" | "duty_day" | "hotel" | "transport";
export type SourceType = "ocr" | "ai_vision" | "manual";
export type SuggestionType = "premium_event" | "contract_reference" | "hotel" | "pay_rule";
export type SuggestionAction = "accepted" | "dismissed" | "modified" | "ignored";
export type DismissReason = "already_claimed" | "incorrect" | "not_applicable" | "timing_issue" | "other";
export type ExplanationType = "pay_statement" | "contract_reference" | "roster_change" | "pay_rule";

export interface ParsingFeedback {
  entityType: EntityType;
  entityId: string;
  fieldName: string;
  originalValue?: string;
  correctedValue?: string;
  aiConfidence?: number;
  sourceType?: SourceType;
  imageHash?: string;
}

export interface SuggestionOutcome {
  suggestionType: SuggestionType;
  suggestionId: string;
  action: SuggestionAction;
  dismissReason?: DismissReason;
  dismissNotes?: string;
  aiConfidence?: number;
  userConfidence?: number; // 1-5
}

export interface SuggestionValidation {
  outcomeId: string;
  wasAccurate: boolean;
  outcomeNotes?: string;
}

export interface ExplanationFeedback {
  explanationType: ExplanationType;
  entityId: string;
  wasHelpful: boolean;
  clarityRating?: number; // 1-5
  feedbackText?: string;
  confusingParts?: string[];
}

export interface FeedbackMetrics {
  summary: {
    totalCorrections: number;
    totalSuggestions: number;
    totalExplanations: number;
  };
  parsing: {
    topCorrectedFields: Array<{
      field: string;
      corrections: number;
      avgConfidence: number | null;
    }>;
    totalFields: number;
  };
  suggestions: {
    acceptanceByType: Record<string, {
      accepted: number;
      dismissed: number;
      rate: number;
    }>;
  };
  explanations: {
    helpfulnessStats: Record<string, {
      helpful: number;
      notHelpful: number;
      rate: number;
    }>;
  };
}

// ============================================
// API Functions
// ============================================

async function submitParsingFeedback(feedback: ParsingFeedback) {
  return api.post<{ success: boolean; feedbackId: string; message: string }>(
    "/api/feedback/parsing",
    feedback
  );
}

async function submitSuggestionOutcome(outcome: SuggestionOutcome) {
  return api.post<{ success: boolean; outcomeId: string }>(
    "/api/feedback/suggestion",
    outcome
  );
}

async function validateSuggestion(validation: SuggestionValidation) {
  return api.post<{ success: boolean; message: string }>(
    "/api/feedback/suggestion/validate",
    validation
  );
}

async function submitExplanationFeedback(feedback: ExplanationFeedback) {
  return api.post<{ success: boolean; feedbackId: string; message: string }>(
    "/api/feedback/explanation",
    feedback
  );
}

async function getFeedbackMetrics() {
  return api.get<FeedbackMetrics>("/api/feedback/metrics");
}

async function computeInsights() {
  return api.post<{
    success: boolean;
    message: string;
    period: { start: string; end: string };
    feedbackCount: number;
    topIssues: Array<{ issue: string; count: number; lowConfidenceRate: number }>;
  }>("/api/feedback/compute-insights", {});
}

// ============================================
// Hooks
// ============================================

/**
 * Submit parsing correction feedback
 * Call this when a user corrects AI-parsed data
 */
export function useParsingFeedback() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: submitParsingFeedback,
    onSuccess: () => {
      // Invalidate metrics cache
      queryClient.invalidateQueries({ queryKey: ["feedback-metrics"] });
    },
    onError: (error) => {
      console.error("[Feedback] Failed to submit parsing feedback:", error);
    },
  });
}

/**
 * Submit suggestion outcome (accept/dismiss/modify)
 * Call this when a user takes action on a suggestion
 */
export function useSuggestionOutcome() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: submitSuggestionOutcome,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["feedback-metrics"] });
    },
    onError: (error) => {
      console.error("[Feedback] Failed to submit suggestion outcome:", error);
    },
  });
}

/**
 * Validate a previous suggestion
 * Call this to confirm if a suggestion was actually accurate
 */
export function useValidateSuggestion() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: validateSuggestion,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["feedback-metrics"] });
    },
    onError: (error) => {
      console.error("[Feedback] Failed to validate suggestion:", error);
    },
  });
}

/**
 * Submit explanation feedback
 * Call this when a user rates an AI explanation
 */
export function useExplanationFeedback() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: submitExplanationFeedback,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["feedback-metrics"] });
    },
    onError: (error) => {
      console.error("[Feedback] Failed to submit explanation feedback:", error);
    },
  });
}

/**
 * Get feedback metrics
 * Shows aggregated learning data
 */
export function useFeedbackMetrics() {
  return useQuery({
    queryKey: ["feedback-metrics"],
    queryFn: getFeedbackMetrics,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Compute AI learning insights
 * Triggers analysis of collected feedback
 */
export function useComputeInsights() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: computeInsights,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["feedback-metrics"] });
    },
    onError: (error) => {
      console.error("[Feedback] Failed to compute insights:", error);
    },
  });
}

// ============================================
// Helper: Track field corrections automatically
// ============================================

/**
 * Helper to track when a user edits a field
 * Use this in edit forms to automatically collect feedback
 */
export function createFieldCorrectionTracker(
  entityType: EntityType,
  entityId: string,
  sourceType?: SourceType
) {
  const corrections: Map<string, { original: string | undefined; aiConfidence?: number }> = new Map();

  return {
    /**
     * Register the original value before editing
     */
    registerOriginal(fieldName: string, value: string | undefined, aiConfidence?: number) {
      corrections.set(fieldName, { original: value, aiConfidence });
    },

    /**
     * Get corrections that need to be submitted
     */
    getCorrections(currentValues: Record<string, string | undefined>): ParsingFeedback[] {
      const feedbackList: ParsingFeedback[] = [];

      for (const [fieldName, originalData] of corrections.entries()) {
        const currentValue = currentValues[fieldName];
        if (currentValue !== originalData.original) {
          feedbackList.push({
            entityType,
            entityId,
            fieldName,
            originalValue: originalData.original,
            correctedValue: currentValue,
            aiConfidence: originalData.aiConfidence,
            sourceType,
          });
        }
      }

      return feedbackList;
    },

    /**
     * Clear tracked corrections
     */
    clear() {
      corrections.clear();
    },
  };
}
