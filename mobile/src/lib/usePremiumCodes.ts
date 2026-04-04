/**
 * UPS Premium Codes Hooks (Phase 1 - Single Source of Truth)
 *
 * React Query hooks for fetching UPS premium codes from the backend.
 * These codes are READ-ONLY and come from the seeded PremiumCodes table.
 */

import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { offlineCache } from "./offlineStorage";
import { useIsOnline } from "./useNetworkStatus";
import type {
  PremiumCode,
  PremiumCodeCategory,
  PremiumCodeType,
  PremiumVariant,
  PremiumSuggestion,
} from "@/lib/contracts";

// ============================================
// QUERY KEYS
// ============================================

export const premiumCodeKeys = {
  all: ["premium-codes"] as const,
  list: (filters?: { category?: string; type?: string; search?: string; fixedCreditOnly?: boolean }) =>
    [...premiumCodeKeys.all, "list", filters] as const,
  detail: (code: string) => [...premiumCodeKeys.all, "detail", code] as const,
  suggest: (changeType: string, context?: { tripId?: string; hourlyRateCents?: number }) =>
    [...premiumCodeKeys.all, "suggest", changeType, context] as const,
};

// ============================================
// CATEGORY DISPLAY CONFIG
// ============================================

export const PREMIUM_CATEGORY_CONFIG: Record<
  PremiumCodeCategory,
  {
    label: string;
    shortLabel: string;
    color: string;
    bgColor: string;
    borderColor: string;
  }
> = {
  reassignment: {
    label: "Reassignment (AP)",
    shortLabel: "Reassignment",
    color: "#8b5cf6",
    bgColor: "bg-purple-500/20",
    borderColor: "border-purple-500/30",
  },
  reserve: {
    label: "Reserve",
    shortLabel: "Reserve",
    color: "#06b6d4",
    bgColor: "bg-cyan-500/20",
    borderColor: "border-cyan-500/30",
  },
  schedule_revision: {
    label: "Schedule Revision",
    shortLabel: "Revision",
    color: "#3b82f6",
    bgColor: "bg-blue-500/20",
    borderColor: "border-blue-500/30",
  },
  grievance: {
    label: "Grievance",
    shortLabel: "Grievance",
    color: "#f59e0b",
    bgColor: "bg-amber-500/20",
    borderColor: "border-amber-500/30",
  },
  soft_max: {
    label: "Soft Max",
    shortLabel: "Soft Max",
    color: "#ef4444",
    bgColor: "bg-red-500/20",
    borderColor: "border-red-500/30",
  },
  late_arrival: {
    label: "Late Arrival",
    shortLabel: "Late Arrival",
    color: "#10b981",
    bgColor: "bg-emerald-500/20",
    borderColor: "border-emerald-500/30",
  },
  other: {
    label: "Other",
    shortLabel: "Other",
    color: "#64748b",
    bgColor: "bg-slate-500/20",
    borderColor: "border-slate-500/30",
  },
};

export const PREMIUM_CATEGORY_ORDER: PremiumCodeCategory[] = [
  "reassignment",
  "reserve",
  "schedule_revision",
  "grievance",
  "soft_max",
  "late_arrival",
  "other",
];

// Filter chips for the UI
export const PREMIUM_FILTER_CHIPS: {
  label: string;
  category: PremiumCodeCategory | "ALL";
}[] = [
  { label: "All", category: "ALL" },
  { label: "Reassignment", category: "reassignment" },
  { label: "Reserve", category: "reserve" },
  { label: "Schedule Rev", category: "schedule_revision" },
  { label: "Grievance", category: "grievance" },
  { label: "Late Arrival", category: "late_arrival" },
  { label: "Soft Max", category: "soft_max" },
  { label: "Other", category: "other" },
];

// Most used codes for quick access
export const MOST_USED_CODES = [
  "AP0",
  "AP1",
  "AP3",
  "AP4",
  "LRP",
  "SVT",
  "PRM",
  "GT1",
];

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Format premium result for display
 */
export function formatPremiumResult(code: {
  premiumType: string;
  premiumMinutes?: number | null;
  premiumMultiplier?: number | null;
}): string {
  if (code.premiumType === "minutes" && code.premiumMinutes) {
    const hours = Math.floor(code.premiumMinutes / 60);
    const mins = code.premiumMinutes % 60;
    return `+${hours}:${mins.toString().padStart(2, "0")}`;
  }
  if (code.premiumType === "multiplier" && code.premiumMultiplier) {
    return `${Math.round(code.premiumMultiplier * 100)}%`;
  }
  return "Manual";
}

/**
 * Parse variants from JSON string
 */
export function parseVariants(variantsJson: string | null): PremiumVariant[] {
  if (!variantsJson) return [];
  try {
    return JSON.parse(variantsJson) as PremiumVariant[];
  } catch {
    return [];
  }
}

/**
 * Parse required inputs from JSON string
 */
export function parseRequiredInputs(
  requiresInputsJson: string | null
): string[] {
  if (!requiresInputsJson) return [];
  try {
    return JSON.parse(requiresInputsJson) as string[];
  } catch {
    return [];
  }
}

/**
 * Get category display config
 */
export function getCategoryConfig(category: PremiumCodeCategory) {
  return PREMIUM_CATEGORY_CONFIG[category] ?? PREMIUM_CATEGORY_CONFIG.other;
}

// ============================================
// HOOKS
// ============================================

export interface UsePremiumCodesOptions {
  category?: PremiumCodeCategory;
  type?: PremiumCodeType;
  search?: string;
  fixedCreditOnly?: boolean;
}

/**
 * Fetch all premium codes
 */
export function usePremiumCodes(options: UsePremiumCodesOptions = {}) {
  const isOnline = useIsOnline();

  return useQuery({
    queryKey: [...premiumCodeKeys.list({
      category: options.category,
      type: options.type,
      search: options.search,
      fixedCreditOnly: options.fixedCreditOnly,
    }), isOnline],
    queryFn: async () => {
      // For offline: only serve base (unfiltered) cache, then apply client-side filters
      if (!isOnline) {
        const cached = await offlineCache.getPremiumCodes<{ premiumCodes: PremiumCode[] }>();
        if (cached) {
          console.log("[usePremiumCodes] Using cached data (offline)");
          let codes = cached.premiumCodes ?? [];
          if (options.category) codes = codes.filter((c) => c.category === options.category);
          if (options.search) {
            const s = options.search.toLowerCase();
            codes = codes.filter(
              (c) =>
                c.code.toLowerCase().includes(s) ||
                c.title.toLowerCase().includes(s) ||
                c.description?.toLowerCase().includes(s) ||
                c.eligibility?.toLowerCase().includes(s) ||
                c.contractRef?.toLowerCase().includes(s)
            );
          }
          if (options.fixedCreditOnly) codes = codes.filter((c) => c.premiumType === "minutes");
          return { codes, totalCount: codes.length };
        }
        throw new Error("No cached premium codes available offline");
      }

      const params = new URLSearchParams();
      if (options.type) params.set("type", options.type);

      const response = await api.get<{ premiumCodes: PremiumCode[] }>(
        `/api/premium-codes${params.toString() ? `?${params}` : ""}`
      );

      // Cache the raw full list for offline use
      if (!options.type) {
        await offlineCache.savePremiumCodes(response);
      }

      let codes = response.premiumCodes ?? [];

      // Apply client-side filters
      if (options.category) {
        codes = codes.filter((c) => c.category === options.category);
      }

      if (options.search) {
        const searchLower = options.search.toLowerCase();
        codes = codes.filter(
          (c) =>
            c.code.toLowerCase().includes(searchLower) ||
            c.title.toLowerCase().includes(searchLower) ||
            c.description?.toLowerCase().includes(searchLower) ||
            c.eligibility?.toLowerCase().includes(searchLower) ||
            c.contractRef?.toLowerCase().includes(searchLower)
        );
      }

      if (options.fixedCreditOnly) {
        codes = codes.filter((c) => c.premiumType === "minutes");
      }

      return {
        codes,
        totalCount: codes.length,
      };
    },
    staleTime: 1000 * 60 * 10, // 10 minutes - codes rarely change
    retry: isOnline ? 3 : 0,
    placeholderData: (previousData) => previousData,
  });
}

/**
 * Fetch a single premium code by code string
 */
export function usePremiumCode(code: string | null) {
  return useQuery({
    queryKey: premiumCodeKeys.detail(code ?? ""),
    queryFn: async () => {
      if (!code) throw new Error("No code provided");

      const response = await api.get<{ premiumCode: PremiumCode }>(
        `/api/premium-codes/${encodeURIComponent(code)}`
      );

      const premiumCode = response.premiumCode;
      if (!premiumCode) throw new Error(`Premium code not found: ${code}`);

      // Parse JSON fields
      const variants = parseVariants(premiumCode.variantsJson);
      const requiresInputs = parseRequiredInputs(premiumCode.requiresInputsJson);

      return {
        code: premiumCode,
        variants,
        requiresInputs,
        formattedPremium: formatPremiumResult(premiumCode),
      };
    },
    enabled: !!code,
    staleTime: 1000 * 60 * 10,
  });
}

/**
 * Get premium suggestions based on change type
 */
export function usePremiumSuggestions(
  changeType: string | null,
  context?: {
    tripId?: string;
    hourlyRateCents?: number;
  }
) {
  return useQuery({
    queryKey: premiumCodeKeys.suggest(changeType ?? "", context),
    queryFn: async () => {
      if (!changeType) throw new Error("No change type provided");

      const response = await api.post<{
        changeType: string;
        suggestions: PremiumSuggestion[];
        suggestedCount: number;
      }>("/api/premium-codes/suggest", {
        changeType,
        context,
      });

      return response;
    },
    enabled: !!changeType,
    staleTime: 1000 * 60 * 5,
  });
}

/**
 * Get codes grouped by category
 */
export function usePremiumCodesByCategory() {
  const { data, isLoading, error } = usePremiumCodes();

  const grouped = new Map<PremiumCodeCategory, PremiumCode[]>();

  // Initialize all categories
  for (const cat of PREMIUM_CATEGORY_ORDER) {
    grouped.set(cat, []);
  }

  // Group codes
  if (data?.codes) {
    for (const code of data.codes) {
      const category = code.category as PremiumCodeCategory;
      const list = grouped.get(category) ?? [];
      list.push(code);
      grouped.set(category, list);
    }
  }

  return {
    grouped,
    totalCount: data?.totalCount ?? 0,
    isLoading,
    error,
  };
}

/**
 * Get most used codes for quick access
 */
export function useMostUsedCodes() {
  const { data, isLoading } = usePremiumCodes();

  const mostUsed =
    data?.codes.filter((c) => MOST_USED_CODES.includes(c.code)) ?? [];

  // Sort by MOST_USED_CODES order
  mostUsed.sort(
    (a, b) => MOST_USED_CODES.indexOf(a.code) - MOST_USED_CODES.indexOf(b.code)
  );

  return { codes: mostUsed, isLoading };
}
