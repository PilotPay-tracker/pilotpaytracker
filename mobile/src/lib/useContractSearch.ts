/**
 * Contract Search Hooks
 *
 * React Query hooks for advanced contract search, AI keyword suggestions,
 * and saved references management.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { useSession } from "./useSession";
import type {
  AdvancedContractSearchRequest,
  AdvancedContractSearchResponse,
  AiSuggestKeywordsRequest,
  AiSuggestKeywordsResponse,
  GetSavedReferencesResponse,
  SaveContractReferenceRequest,
  SaveContractReferenceResponse,
  DeleteSavedReferenceResponse,
  ContractSearchResult,
  SearchCategory,
  SearchMatchType,
  ContractDocumentType,
} from "@/lib/contracts";

// Query keys
export const contractSearchKeys = {
  all: ["contractSearch"] as const,
  search: (params: AdvancedContractSearchRequest) =>
    [...contractSearchKeys.all, "search", params] as const,
  suggestions: (query: string, context?: string) =>
    [...contractSearchKeys.all, "suggestions", query, context] as const,
  savedReferences: () => [...contractSearchKeys.all, "savedReferences"] as const,
};

// ============================================
// ADVANCED SEARCH
// ============================================

interface UseContractSearchOptions {
  query: string;
  documentIds?: string[];
  documentTypes?: ContractDocumentType[];
  categories?: SearchCategory[];
  matchType?: SearchMatchType;
  limit?: number;
  offset?: number;
  enabled?: boolean;
}

export function useContractSearch(options: UseContractSearchOptions) {
  const { data: session } = useSession();
  const isAuthenticated = !!session?.user;

  const { enabled = true, ...searchParams } = options;

  return useQuery({
    queryKey: contractSearchKeys.search(searchParams),
    queryFn: () =>
      api.post<AdvancedContractSearchResponse>(
        "/api/contracts/advanced-search",
        searchParams
      ),
    enabled: isAuthenticated && enabled && searchParams.query.length >= 2,
    staleTime: 30 * 1000, // 30 seconds
  });
}

// Mutation version for on-demand search
export function useContractSearchMutation() {
  return useMutation({
    mutationFn: async (params: AdvancedContractSearchRequest) => {
      return api.post<AdvancedContractSearchResponse>(
        "/api/contracts/advanced-search",
        params
      );
    },
  });
}

// ============================================
// AI KEYWORD SUGGESTIONS
// ============================================

interface UseAiSuggestKeywordsOptions {
  query: string;
  context?: string;
  enabled?: boolean;
}

export function useAiSuggestKeywords(options: UseAiSuggestKeywordsOptions) {
  const { data: session } = useSession();
  const isAuthenticated = !!session?.user;

  const { query, context, enabled = true } = options;

  return useQuery({
    queryKey: contractSearchKeys.suggestions(query, context),
    queryFn: () =>
      api.post<AiSuggestKeywordsResponse>("/api/contracts/ai-suggest-keywords", {
        query,
        context,
      }),
    enabled: isAuthenticated && enabled && query.length >= 2,
    staleTime: 60 * 1000, // 1 minute
  });
}

export function useAiSuggestKeywordsMutation() {
  return useMutation({
    mutationFn: async (params: AiSuggestKeywordsRequest) => {
      return api.post<AiSuggestKeywordsResponse>(
        "/api/contracts/ai-suggest-keywords",
        params
      );
    },
  });
}

// ============================================
// SAVED REFERENCES
// ============================================

export function useSavedContractReferences() {
  const { data: session } = useSession();
  const isAuthenticated = !!session?.user;

  return useQuery({
    queryKey: contractSearchKeys.savedReferences(),
    queryFn: () =>
      api.get<GetSavedReferencesResponse>("/api/contracts/saved-references"),
    enabled: isAuthenticated,
  });
}

export function useSaveContractReference() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: SaveContractReferenceRequest) => {
      return api.post<SaveContractReferenceResponse>(
        "/api/contracts/saved-references",
        params
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: contractSearchKeys.savedReferences(),
      });
    },
  });
}

export function useDeleteSavedReference() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      return api.delete<DeleteSavedReferenceResponse>(
        `/api/contracts/saved-references/${id}`
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: contractSearchKeys.savedReferences(),
      });
    },
  });
}

// ============================================
// HELPERS
// ============================================

// Format confidence level for display
export function formatConfidence(
  confidence: "high" | "medium" | "low"
): { label: string; color: string; bgColor: string } {
  const configs = {
    high: { label: "High", color: "#22c55e", bgColor: "bg-green-500/20" },
    medium: { label: "Med", color: "#f59e0b", bgColor: "bg-amber-500/20" },
    low: { label: "Low", color: "#64748b", bgColor: "bg-slate-500/20" },
  };
  return configs[confidence];
}

// Format category for display
export function formatSearchCategory(
  category: SearchCategory
): { label: string; icon: string; color: string } {
  const configs: Record<
    SearchCategory,
    { label: string; icon: string; color: string }
  > = {
    pay: { label: "Pay", icon: "dollar-sign", color: "#22c55e" },
    scheduling: { label: "Scheduling", icon: "calendar", color: "#3b82f6" },
    reserve: { label: "Reserve", icon: "clock", color: "#8b5cf6" },
    training: { label: "Training", icon: "graduation-cap", color: "#ec4899" },
    deadhead: { label: "Deadhead", icon: "plane", color: "#64748b" },
    other: { label: "Other", icon: "help-circle", color: "#94a3b8" },
  };
  return configs[category];
}

// Check if a section is saved
export function useIsSectionSaved(sectionId: string): boolean {
  const { data } = useSavedContractReferences();
  return data?.references.some((ref) => ref.sectionId === sectionId) ?? false;
}
