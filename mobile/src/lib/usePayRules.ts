/**
 * Pay Rules Hooks
 * React Query hooks for pay rules management
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { useSession } from "./useSession";
import { offlineCache } from "./offlineStorage";
import { useIsOnline } from "./useNetworkStatus";
import NetInfo from "@react-native-community/netinfo";
import type {
  GetPayRulesResponse,
  GetPayRuleCategoriesResponse,
  CreatePayRuleRequest,
  CreatePayRuleResponse,
  UpdatePayRuleRequest,
  UpdatePayRuleResponse,
  DeletePayRuleResponse,
  CreatePayRuleCategoryRequest,
  CreatePayRuleCategoryResponse,
  InitDefaultRulesResponse,
  GetPayRuleApplicationsResponse,
  PayRule,
  PayRuleCategory,
  RuleType,
  RuleScope,
} from "@/lib/contracts";

// ============================================
// PAY RULE CATEGORIES
// ============================================

export function usePayRuleCategories() {
  const { data: session } = useSession();
  const isAuthenticated = !!session?.user;
  const isOnline = useIsOnline();

  return useQuery({
    queryKey: ["pay-rule-categories"],
    queryFn: async () => {
      const netState = await NetInfo.fetch();
      const currentlyOnline = (netState.isConnected ?? true) && netState.isInternetReachable !== false;
      if (!currentlyOnline) {
        const cached = await offlineCache.getPayRuleCategories<GetPayRuleCategoriesResponse>();
        if (cached) {
          console.log("[usePayRuleCategories] Using cached data (offline)");
          return cached;
        }
        throw new Error("No cached pay rule categories available offline");
      }
      const response = await api.get<GetPayRuleCategoriesResponse>("/api/pay-rules/categories");
      await offlineCache.savePayRuleCategories(response);
      return response;
    },
    enabled: isAuthenticated,
    staleTime: 1000 * 60 * 5, // 5 minutes
    retry: isOnline ? 3 : 0,
    placeholderData: (previousData) => previousData,
  });
}

export function useCreatePayRuleCategory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreatePayRuleCategoryRequest) => {
      const response = await api.post<CreatePayRuleCategoryResponse>("/api/pay-rules/categories", data);
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pay-rule-categories"] });
      queryClient.invalidateQueries({ queryKey: ["pay-rules"] });
    },
  });
}

export function useDeletePayRuleCategory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (categoryId: string) => {
      const response = await api.delete<{ success: boolean }>(`/api/pay-rules/categories/${categoryId}`);
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pay-rule-categories"] });
      queryClient.invalidateQueries({ queryKey: ["pay-rules"] });
    },
  });
}

// ============================================
// PAY RULES
// ============================================

export function usePayRules(options?: {
  categoryId?: string;
  ruleType?: RuleType;
  scope?: RuleScope;
  activeOnly?: boolean;
}) {
  const { data: session } = useSession();
  const isAuthenticated = !!session?.user;
  const isOnline = useIsOnline();

  return useQuery({
    queryKey: ["pay-rules", options],
    queryFn: async () => {
      const netState = await NetInfo.fetch();
      const currentlyOnline = (netState.isConnected ?? true) && netState.isInternetReachable !== false;
      if (!currentlyOnline) {
        const cached = await offlineCache.getPayRules<GetPayRulesResponse>();
        if (cached) {
          console.log("[usePayRules] Using cached data (offline)");
          return cached;
        }
        throw new Error("No cached pay rules available offline");
      }
      const params = new URLSearchParams();
      if (options?.categoryId) params.set("categoryId", options.categoryId);
      if (options?.ruleType) params.set("ruleType", options.ruleType);
      if (options?.scope) params.set("scope", options.scope);
      if (options?.activeOnly) params.set("activeOnly", "true");
      const queryString = params.toString();
      const url = queryString ? `/api/pay-rules?${queryString}` : "/api/pay-rules";
      const response = await api.get<GetPayRulesResponse>(url);
      // Only cache the unfiltered list
      if (!options?.categoryId && !options?.ruleType && !options?.scope) {
        await offlineCache.savePayRules(response);
      }
      return response;
    },
    enabled: isAuthenticated,
    staleTime: 1000 * 60 * 5, // 5 minutes
    retry: isOnline ? 3 : 0,
    placeholderData: (previousData) => previousData,
  });
}

export function usePayRule(ruleId: string | undefined) {
  const { data: session } = useSession();
  const isAuthenticated = !!session?.user;

  return useQuery({
    queryKey: ["pay-rule", ruleId],
    queryFn: async () => {
      if (!ruleId) throw new Error("Rule ID is required");
      const response = await api.get<{ rule: PayRule }>(`/api/pay-rules/${ruleId}`);
      return response.rule;
    },
    enabled: isAuthenticated && !!ruleId,
  });
}

export function useCreatePayRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreatePayRuleRequest) => {
      const response = await api.post<CreatePayRuleResponse>("/api/pay-rules", data);
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pay-rules"] });
    },
  });
}

export function useUpdatePayRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ ruleId, data }: { ruleId: string; data: UpdatePayRuleRequest }) => {
      const response = await api.put<UpdatePayRuleResponse>(`/api/pay-rules/${ruleId}`, data);
      return response;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["pay-rules"] });
      queryClient.invalidateQueries({ queryKey: ["pay-rule", variables.ruleId] });
    },
  });
}

export function useDeletePayRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (ruleId: string) => {
      const response = await api.delete<DeletePayRuleResponse>(`/api/pay-rules/${ruleId}`);
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pay-rules"] });
    },
  });
}

export function useTogglePayRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ ruleId, isActive }: { ruleId: string; isActive: boolean }) => {
      const response = await api.put<UpdatePayRuleResponse>(`/api/pay-rules/${ruleId}`, { isActive });
      return response;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["pay-rules"] });
      queryClient.invalidateQueries({ queryKey: ["pay-rule", variables.ruleId] });
    },
  });
}

// ============================================
// INITIALIZE DEFAULTS
// ============================================

export function useInitDefaultRules() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (airline?: string) => {
      const response = await api.post<InitDefaultRulesResponse>("/api/pay-rules/init-defaults", { airline });
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pay-rules"] });
      queryClient.invalidateQueries({ queryKey: ["pay-rule-categories"] });
    },
  });
}

// ============================================
// RULE APPLICATIONS
// ============================================

export function usePayRuleApplications(options?: {
  tripId?: string;
  dutyDayId?: string;
  payPeriodStart?: string;
  startDate?: string;
  endDate?: string;
}) {
  const { data: session } = useSession();
  const isAuthenticated = !!session?.user;

  return useQuery({
    queryKey: ["pay-rule-applications", options],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (options?.tripId) params.set("tripId", options.tripId);
      if (options?.dutyDayId) params.set("dutyDayId", options.dutyDayId);
      if (options?.payPeriodStart) params.set("payPeriodStart", options.payPeriodStart);
      if (options?.startDate) params.set("startDate", options.startDate);
      if (options?.endDate) params.set("endDate", options.endDate);
      const queryString = params.toString();
      const url = queryString ? `/api/pay-rules/applications?${queryString}` : "/api/pay-rules/applications";
      const response = await api.get<GetPayRuleApplicationsResponse>(url);
      return response;
    },
    enabled: isAuthenticated,
    staleTime: 1000 * 60, // 1 minute
  });
}

// ============================================
// HELPERS
// ============================================

/**
 * Parse the valueConfig JSON string into a typed object
 */
export function parseValueConfig<T = Record<string, unknown>>(valueConfig: string): T {
  try {
    return JSON.parse(valueConfig) as T;
  } catch {
    return {} as T;
  }
}

/**
 * Parse the conditions JSON string into an array
 */
export function parseConditions(conditions: string | null): Array<{
  field: string;
  operator: string;
  value: string | number | string[];
}> {
  if (!conditions) return [];
  try {
    return JSON.parse(conditions);
  } catch {
    return [];
  }
}

/**
 * Parse the airlineLabels JSON string into a record
 */
export function parseAirlineLabels(airlineLabels: string | null): Record<string, string> {
  if (!airlineLabels) return {};
  try {
    return JSON.parse(airlineLabels);
  } catch {
    return {};
  }
}

/**
 * Get display name for a rule, using airline-specific label if available
 */
export function getRuleDisplayName(rule: PayRule, airline?: string): string {
  if (airline) {
    const labels = parseAirlineLabels(rule.airlineLabels);
    if (labels[airline]) {
      return `${labels[airline]} (${rule.name})`;
    }
  }
  return rule.code ? `${rule.code} - ${rule.name}` : rule.name;
}

/**
 * Format rule type for display
 */
export function formatRuleType(ruleType: RuleType): string {
  const labels: Record<RuleType, string> = {
    GUARANTEE: "Guarantee",
    PREMIUM_ADD: "Add Hours/Pay",
    PREMIUM_MULTIPLY: "Multiplier",
    THRESHOLD: "Threshold",
    LIMIT: "Limit",
    CUSTOM: "Custom",
  };
  return labels[ruleType] || ruleType;
}

/**
 * Format rule scope for display
 */
export function formatRuleScope(scope: RuleScope): string {
  const labels: Record<RuleScope, string> = {
    DAILY: "Per Day",
    TRIP: "Per Trip",
    PAY_PERIOD: "Per Pay Period",
    MONTHLY: "Per Month",
    YEARLY: "Per Year",
    ROLLING: "Rolling Window",
  };
  return labels[scope] || scope;
}
