/**
 * Pay Codes Library Hooks
 *
 * React Query hooks for managing pay codes and contract references.
 * Aggregates data from airline terminology packs and user-uploaded contracts.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSession } from "./useSession";
import { useProfile } from "./state/profile-store";
import { useContracts } from "./useContracts";
import {
  getAliasPack,
  CANONICAL_RULES,
  RULE_CATEGORIES,
  type CanonicalRuleId,
  type RuleCategory,
  type AirlineAliasPack,
} from "./data/airline-alias-packs";
import type {
  UserPayCode,
  PayCodeCategory,
  PayCodeReference,
  DocumentChecklistItem,
} from "@/lib/contracts";

// ============================================
// CATEGORY MAPPING
// ============================================

const RULE_CATEGORY_TO_PAY_CODE_CATEGORY: Record<RuleCategory, PayCodeCategory> = {
  DAILY_GUARANTEES: "GUARANTEE",
  PREMIUM_PAY: "PREMIUM",
  DUTY_LIMITS: "LIMITS",
  PAY_PROTECTION: "PROTECTION",
  REASSIGNMENT: "REASSIGNMENT",
  RESERVE: "RESERVE",
  DEADHEAD: "DEADHEAD",
  PER_DIEM: "PER_DIEM",
};

// ============================================
// CHECKLIST TEMPLATES BY CODE TYPE
// ============================================

const DEFAULT_CHECKLIST: DocumentChecklistItem[] = [
  { id: "screenshot", label: "Screenshot of schedule/notification", isRequired: false },
  { id: "time", label: "Date and time of occurrence", isRequired: true },
  { id: "rep", label: "Crew scheduling rep name (if contacted)", isRequired: false },
  { id: "notes", label: "Personal notes about what happened", isRequired: false },
];

const CHECKLIST_BY_CATEGORY: Record<PayCodeCategory, DocumentChecklistItem[]> = {
  REASSIGNMENT: [
    { id: "schedule_before", label: "Screenshot of original schedule", isRequired: true },
    { id: "schedule_after", label: "Screenshot of new schedule", isRequired: true },
    { id: "notification", label: "Notification time from company", isRequired: true },
    { id: "rep_name", label: "Crew scheduling rep name", isRequired: false },
    { id: "rep_time", label: "Time of contact with scheduling", isRequired: false },
    { id: "trip_board", label: "Trip Board snapshot", isRequired: false },
    { id: "notes", label: "Personal notes about circumstances", isRequired: false },
  ],
  PREMIUM: [
    { id: "acars", label: "ACARS screenshot with block times", isRequired: true },
    { id: "schedule", label: "Schedule showing premium trigger", isRequired: true },
    { id: "trip_board", label: "Trip Board snapshot", isRequired: false },
    { id: "notes", label: "Notes about premium circumstance", isRequired: false },
  ],
  PROTECTION: [
    { id: "original_schedule", label: "Original schedule screenshot", isRequired: true },
    { id: "notification", label: "Company notification of change", isRequired: true },
    { id: "rep_contact", label: "Scheduling contact details", isRequired: false },
    { id: "email", label: "Any relevant email communication", isRequired: false },
    { id: "notes", label: "Personal notes", isRequired: false },
  ],
  GUARANTEE: [
    { id: "schedule", label: "Schedule showing duty day", isRequired: true },
    { id: "acars", label: "ACARS with actual times", isRequired: false },
    { id: "notes", label: "Notes if guarantee applies", isRequired: false },
  ],
  RESERVE: [
    { id: "reserve_notification", label: "Reserve assignment notification", isRequired: true },
    { id: "callout_time", label: "Callout time from scheduling", isRequired: true },
    { id: "report_time", label: "Report time", isRequired: false },
    { id: "notes", label: "Personal notes", isRequired: false },
  ],
  TRAINING: [
    { id: "training_schedule", label: "Training schedule/assignment", isRequired: true },
    { id: "completion", label: "Training completion record", isRequired: false },
    { id: "notes", label: "Notes about training event", isRequired: false },
  ],
  DEADHEAD: [
    { id: "itinerary", label: "Deadhead flight itinerary", isRequired: true },
    { id: "boarding_pass", label: "Boarding pass (if applicable)", isRequired: false },
    { id: "notes", label: "Notes about deadhead", isRequired: false },
  ],
  LIMITS: [
    { id: "schedule", label: "Schedule showing limit reached", isRequired: true },
    { id: "calculation", label: "Screenshot of limit calculation", isRequired: false },
    { id: "notes", label: "Notes", isRequired: false },
  ],
  PER_DIEM: [
    { id: "itinerary", label: "Trip itinerary with layover times", isRequired: true },
    { id: "receipts", label: "Receipts (if applicable)", isRequired: false },
    { id: "notes", label: "Notes", isRequired: false },
  ],
  OTHER: DEFAULT_CHECKLIST,
};

// ============================================
// BUILD PAY CODES FROM AIRLINE PACK
// ============================================

function buildPayCodesFromAliasPack(
  aliasPack: AirlineAliasPack,
  userId: string,
  contractReferences: Map<string, PayCodeReference[]>
): UserPayCode[] {
  const codes: UserPayCode[] = [];
  const now = new Date().toISOString();

  for (const [canonicalId, alias] of Object.entries(aliasPack.rules)) {
    if (!alias) continue;

    const category = RULE_CATEGORY_TO_PAY_CODE_CATEGORY[alias.category] ?? "OTHER";
    const refs = contractReferences.get(canonicalId) ?? [];

    codes.push({
      id: `${aliasPack.airlineId}-${canonicalId}`,
      userId,
      airlineId: aliasPack.airlineId,
      codeKey: canonicalId,
      displayName: alias.displayName,
      shortCode: alias.shortCode ?? null,
      category,
      summary: alias.description,
      description: alias.description,
      isFromTerminologyPack: true,
      hasContractReferences: refs.length > 0,
      userNotes: null,
      createdAt: now,
      updatedAt: now,
      references: refs.length > 0 ? refs : undefined,
    });
  }

  return codes;
}

// ============================================
// QUERY KEYS
// ============================================

export const payCodeKeys = {
  all: ["pay-codes"] as const,
  list: (airlineId: string) => [...payCodeKeys.all, "list", airlineId] as const,
  detail: (codeId: string) => [...payCodeKeys.all, "detail", codeId] as const,
};

// ============================================
// HOOKS
// ============================================

export interface UsePayCodesOptions {
  category?: PayCodeCategory;
  search?: string;
  hasReferences?: boolean;
}

/**
 * Hook to get all pay codes for user's airline
 */
export function usePayCodes(options: UsePayCodesOptions = {}) {
  const { data: session } = useSession();
  const profile = useProfile();
  const { data: contractsData } = useContracts();

  const userId = session?.user?.id ?? "anonymous";
  const airlineId = profile?.airline ?? "Other";
  const hasActiveDocuments = contractsData?.hasActiveDocuments ?? false;

  return useQuery({
    queryKey: [...payCodeKeys.list(airlineId), options, userId, hasActiveDocuments],
    queryFn: async () => {
      const aliasPack = getAliasPack(airlineId);

      // Build a map of contract references by code key
      // In a real implementation, this would come from the backend
      // For now, we check if there are any active contracts
      const contractReferences = new Map<string, PayCodeReference[]>();
      const hasContracts = hasActiveDocuments;

      // Build codes from terminology pack
      let codes = buildPayCodesFromAliasPack(aliasPack, userId, contractReferences);

      // Apply filters
      if (options.category) {
        codes = codes.filter((c) => c.category === options.category);
      }

      if (options.search) {
        const searchLower = options.search.toLowerCase();
        codes = codes.filter(
          (c) =>
            c.displayName.toLowerCase().includes(searchLower) ||
            c.shortCode?.toLowerCase().includes(searchLower) ||
            c.codeKey.toLowerCase().includes(searchLower) ||
            c.summary?.toLowerCase().includes(searchLower)
        );
      }

      if (options.hasReferences !== undefined) {
        codes = codes.filter((c) => c.hasContractReferences === options.hasReferences);
      }

      // Sort: codes with references first, then alphabetically
      codes.sort((a, b) => {
        if (a.hasContractReferences !== b.hasContractReferences) {
          return a.hasContractReferences ? -1 : 1;
        }
        return a.displayName.localeCompare(b.displayName);
      });

      return {
        codes,
        totalCount: codes.length,
        hasContracts,
      };
    },
    enabled: true, // Always enabled, works for anonymous too
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

/**
 * Hook to get a single pay code with full details
 */
export function usePayCode(codeId: string | null) {
  const { data: session } = useSession();
  const profile = useProfile();
  const { data: contractsData } = useContracts();

  const userId = session?.user?.id ?? "anonymous";
  const airlineId = profile?.airline ?? "Other";
  const hasActiveDocuments = contractsData?.hasActiveDocuments ?? false;

  return useQuery({
    queryKey: [...payCodeKeys.detail(codeId ?? ""), airlineId, userId, hasActiveDocuments],
    queryFn: async () => {
      if (!codeId) throw new Error("No code ID");

      const aliasPack = getAliasPack(airlineId);
      const contractReferences = new Map<string, PayCodeReference[]>();

      const codes = buildPayCodesFromAliasPack(aliasPack, userId, contractReferences);
      const code = codes.find((c) => c.id === codeId || c.codeKey === codeId);

      if (!code) {
        throw new Error(`Pay code not found: ${codeId}`);
      }

      // Get checklist for this category
      const checklist = CHECKLIST_BY_CATEGORY[code.category] ?? DEFAULT_CHECKLIST;

      // Find related codes (same category, excluding self)
      const relatedCodes = codes
        .filter((c) => c.category === code.category && c.id !== code.id)
        .slice(0, 5);

      return {
        code,
        checklist,
        relatedCodes,
        hasContracts: hasActiveDocuments,
      };
    },
    enabled: !!codeId,
    staleTime: 1000 * 60 * 5,
  });
}

/**
 * Hook to get pay codes summary (counts by category)
 */
export function usePayCodesSummary() {
  const { data: codesData, isLoading } = usePayCodes();

  const summary = {
    totalCount: codesData?.totalCount ?? 0,
    withReferences: 0,
    byCategory: {} as Record<PayCodeCategory, number>,
    hasContracts: codesData?.hasContracts ?? false,
  };

  if (codesData?.codes) {
    for (const code of codesData.codes) {
      summary.byCategory[code.category] = (summary.byCategory[code.category] ?? 0) + 1;
      if (code.hasContractReferences) {
        summary.withReferences++;
      }
    }
  }

  return { summary, isLoading };
}

// ============================================
// CATEGORY DISPLAY HELPERS
// ============================================

export const PAY_CODE_CATEGORY_DISPLAY: Record<
  PayCodeCategory,
  { label: string; icon: string; color: string; bgColor: string }
> = {
  PREMIUM: {
    label: "Premiums",
    icon: "Star",
    color: "#f59e0b",
    bgColor: "bg-amber-500/20",
  },
  GUARANTEE: {
    label: "Guarantees",
    icon: "Shield",
    color: "#22c55e",
    bgColor: "bg-green-500/20",
  },
  PROTECTION: {
    label: "Protections",
    icon: "ShieldCheck",
    color: "#3b82f6",
    bgColor: "bg-blue-500/20",
  },
  REASSIGNMENT: {
    label: "Reassignments",
    icon: "RefreshCw",
    color: "#8b5cf6",
    bgColor: "bg-purple-500/20",
  },
  RESERVE: {
    label: "Reserve",
    icon: "Clock",
    color: "#06b6d4",
    bgColor: "bg-cyan-500/20",
  },
  TRAINING: {
    label: "Training",
    icon: "GraduationCap",
    color: "#ec4899",
    bgColor: "bg-pink-500/20",
  },
  DEADHEAD: {
    label: "Deadhead",
    icon: "Plane",
    color: "#64748b",
    bgColor: "bg-slate-500/20",
  },
  LIMITS: {
    label: "Limits",
    icon: "AlertTriangle",
    color: "#ef4444",
    bgColor: "bg-red-500/20",
  },
  PER_DIEM: {
    label: "Per Diem",
    icon: "DollarSign",
    color: "#10b981",
    bgColor: "bg-emerald-500/20",
  },
  OTHER: {
    label: "Other",
    icon: "HelpCircle",
    color: "#94a3b8",
    bgColor: "bg-slate-400/20",
  },
};

export function getCategoryDisplay(category: PayCodeCategory) {
  return PAY_CODE_CATEGORY_DISPLAY[category] ?? PAY_CODE_CATEGORY_DISPLAY.OTHER;
}

// ============================================
// FILTER CHIPS
// ============================================

export const PAY_CODE_FILTER_CHIPS: { label: string; category: PayCodeCategory | "ALL" }[] = [
  { label: "All", category: "ALL" },
  { label: "Premiums", category: "PREMIUM" },
  { label: "Guarantees", category: "GUARANTEE" },
  { label: "Protections", category: "PROTECTION" },
  { label: "Reassignments", category: "REASSIGNMENT" },
  { label: "Reserve", category: "RESERVE" },
  { label: "Training", category: "TRAINING" },
  { label: "Deadhead", category: "DEADHEAD" },
  { label: "Other", category: "OTHER" },
];
