/**
 * Contract Documents Hooks
 *
 * React Query hooks for managing CBA, pay manual, and contract document uploads.
 * These documents are used as reference-only context for AI features.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as FileSystem from "expo-file-system";
import { api, BACKEND_URL } from "./api";
import { getAuthCookieHeader } from "./authClient";
import { useSession } from "./useSession";
import { offlineCache } from "./offlineStorage";
import { useIsOnline } from "./useNetworkStatus";
import NetInfo from "@react-native-community/netinfo";
import type {
  GetContractsResponse,
  GetContractResponse,
  UploadContractResponse,
  UpdateContractResponse,
  DeleteContractResponse,
  ReparseContractResponse,
  FindRelevantSectionsResponse,
  ContractDocument,
  ContractDocumentType,
  // Phase 2-4 types
  GetContractSectionResponse,
  GetContractViewHistoryResponse,
  LogContractViewRequest,
  LogContractViewResponse,
  GetContractTriggersResponse,
  CreateContractTriggerRequest,
  CreateContractTriggerResponse,
  DeleteContractTriggerResponse,
  CheckContractTriggersRequest,
  CheckContractTriggersResponse,
  GetContractPatternsResponse,
  AcknowledgePatternResponse,
  ContractViewSource,
  ContractRelatedEntityType,
} from "@/lib/contracts";

// Query keys
export const contractKeys = {
  all: ["contracts"] as const,
  list: () => [...contractKeys.all, "list"] as const,
  detail: (id: string) => [...contractKeys.all, "detail", id] as const,
  section: (docId: string, sectionId: string) =>
    [...contractKeys.all, "section", docId, sectionId] as const,
  references: (params?: { triggerType?: string; triggerEntityId?: string }) =>
    [...contractKeys.all, "references", params] as const,
  relevant: (context: string) =>
    [...contractKeys.all, "relevant", context] as const,
  viewHistory: () => [...contractKeys.all, "viewHistory"] as const,
  triggers: () => [...contractKeys.all, "triggers"] as const,
  patterns: () => [...contractKeys.all, "patterns"] as const,
};

// ============================================
// LIST CONTRACTS
// ============================================

export function useContracts() {
  const { data: session } = useSession();
  const isAuthenticated = !!session?.user;
  const isOnline = useIsOnline();

  return useQuery({
    queryKey: [...contractKeys.list()],
    queryFn: async () => {
      const netState = await NetInfo.fetch();
      const currentlyOnline = (netState.isConnected ?? true) && netState.isInternetReachable !== false;
      if (!currentlyOnline) {
        const cached = await offlineCache.getContracts<GetContractsResponse>();
        if (cached) {
          console.log("[useContracts] Using cached data (offline)");
          return cached;
        }
        throw new Error("No cached contracts available offline");
      }
      const response = await api.get<GetContractsResponse>("/api/contracts");
      await offlineCache.saveContracts(response);
      return response;
    },
    enabled: isAuthenticated,
    retry: isOnline ? 3 : 0,
    placeholderData: (previousData) => previousData,
  });
}

// ============================================
// GET SINGLE CONTRACT
// ============================================

export function useContract(id: string | undefined) {
  const { data: session } = useSession();
  const isAuthenticated = !!session?.user;

  return useQuery({
    queryKey: contractKeys.detail(id ?? ""),
    queryFn: () => api.get<GetContractResponse>(`/api/contracts/${id}`),
    enabled: isAuthenticated && !!id,
  });
}

// ============================================
// UPLOAD CONTRACT
// ============================================

interface UploadContractParams {
  file: {
    uri: string;
    name: string;
    type: string;
  };
  title: string;
  documentType: ContractDocumentType;
  versionLabel?: string; // Phase 1: e.g., "Contract 16"
  disclaimerAccepted: boolean;
}

export function useUploadContract() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: UploadContractParams) => {
      // Get Better Auth cookie for file upload
      const cookie = await getAuthCookieHeader();

      // Use FileSystem.uploadAsync for reliable file uploads in React Native
      const uploadResult = await FileSystem.uploadAsync(
        `${BACKEND_URL}/api/contracts/upload`,
        params.file.uri,
        {
          httpMethod: "POST",
          uploadType: FileSystem.FileSystemUploadType.MULTIPART,
          fieldName: "file",
          parameters: {
            title: params.title,
            documentType: params.documentType,
            disclaimerAccepted: String(params.disclaimerAccepted),
            ...(params.versionLabel ? { versionLabel: params.versionLabel } : {}),
          },
          headers: {
            ...(cookie ? { Cookie: cookie } : {}),
          },
        }
      );

      if (uploadResult.status !== 200) {
        const errorData = JSON.parse(uploadResult.body || "{}");
        throw new Error(errorData.error || `Upload failed: ${uploadResult.status}`);
      }

      return JSON.parse(uploadResult.body) as UploadContractResponse;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: contractKeys.all });
    },
  });
}

// ============================================
// UPDATE CONTRACT
// ============================================

interface UpdateContractParams {
  id: string;
  title?: string;
  documentType?: ContractDocumentType;
  isActive?: boolean;
}

export function useUpdateContract() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...data }: UpdateContractParams) => {
      return api.put<UpdateContractResponse>(`/api/contracts/${id}`, data);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: contractKeys.all });
      queryClient.invalidateQueries({
        queryKey: contractKeys.detail(variables.id),
      });
    },
  });
}

// ============================================
// DELETE CONTRACT
// ============================================

export function useDeleteContract() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      return api.delete<DeleteContractResponse>(`/api/contracts/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: contractKeys.all });
    },
  });
}

// ============================================
// REPARSE CONTRACT
// ============================================

export function useReparseContract() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      return api.post<ReparseContractResponse>(`/api/contracts/${id}/reparse`, {});
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: contractKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: contractKeys.list() });
    },
  });
}

// ============================================
// FIND RELEVANT SECTIONS
// ============================================

interface FindRelevantParams {
  triggerType: "SCHEDULE_CHANGE" | "PAY_EVENT" | "PAY_REVIEW" | "USER_QUERY";
  triggerEntityId?: string;
  context: string;
  saveReference?: boolean;
}

export function useFindRelevantSections() {
  return useMutation({
    mutationFn: async (params: FindRelevantParams) => {
      return api.post<FindRelevantSectionsResponse>(
        "/api/contracts/find-relevant",
        params
      );
    },
  });
}

// Hook for querying relevant sections (cached)
export function useRelevantSections(
  triggerType: FindRelevantParams["triggerType"],
  context: string,
  options?: { enabled?: boolean }
) {
  const { data: session } = useSession();
  const isAuthenticated = !!session?.user;

  return useQuery({
    queryKey: [...contractKeys.relevant(context), triggerType],
    queryFn: () =>
      api.post<FindRelevantSectionsResponse>("/api/contracts/find-relevant", {
        triggerType,
        context,
        saveReference: false,
      }),
    enabled: isAuthenticated && !!context && (options?.enabled ?? true),
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });
}

// ============================================
// HELPERS
// ============================================

// Format document type for display
export function formatDocumentType(type: ContractDocumentType): string {
  const labels: Record<ContractDocumentType, string> = {
    CBA: "Collective Bargaining Agreement",
    PAY_MANUAL: "Pay Manual",
    LOA: "Letter of Agreement",
    COMPANY_POLICY: "Company Policy",
    OTHER: "Other Document",
  };
  return labels[type] ?? type;
}

// Format parse status for display
export function formatParseStatus(
  status: string
): { label: string; color: string } {
  const statuses: Record<string, { label: string; color: string }> = {
    pending: { label: "Processing Queued", color: "#64748b" },
    processing: { label: "Processing...", color: "#f59e0b" },
    success: { label: "Ready", color: "#22c55e" },
    failed: { label: "Processing Failed", color: "#ef4444" },
  };
  return statuses[status] ?? { label: status, color: "#64748b" };
}

// Format file size
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Check if user has active contracts
export function useHasActiveContracts(): boolean {
  const { data } = useContracts();
  return data?.hasActiveDocuments ?? false;
}

// ============================================
// PHASE 2: CONTRACT SECTION DEEP LINKING
// ============================================

export function useContractSection(documentId: string | undefined, sectionId: string | undefined) {
  const { data: session } = useSession();
  const isAuthenticated = !!session?.user;

  return useQuery({
    queryKey: contractKeys.section(documentId ?? "", sectionId ?? ""),
    queryFn: () =>
      api.get<GetContractSectionResponse>(
        `/api/contracts/${documentId}/section/${sectionId}`
      ),
    enabled: isAuthenticated && !!documentId && !!sectionId,
  });
}

// ============================================
// PHASE 3: CONTEXTUAL REFERENCE TRIGGERS
// ============================================

export function useContractTriggers() {
  const { data: session } = useSession();
  const isAuthenticated = !!session?.user;

  return useQuery({
    queryKey: contractKeys.triggers(),
    queryFn: () => api.get<GetContractTriggersResponse>("/api/contracts/triggers"),
    enabled: isAuthenticated,
  });
}

export function useCreateContractTrigger() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: Omit<CreateContractTriggerRequest, "userId">) => {
      return api.post<CreateContractTriggerResponse>("/api/contracts/triggers", params);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: contractKeys.triggers() });
    },
  });
}

export function useDeleteContractTrigger() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      return api.delete<DeleteContractTriggerResponse>(`/api/contracts/triggers/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: contractKeys.triggers() });
    },
  });
}

// Check triggers for a given entity - used to show "Contract Reference Available" indicators
export function useCheckContractTriggers() {
  return useMutation({
    mutationFn: async (params: CheckContractTriggersRequest) => {
      return api.post<CheckContractTriggersResponse>("/api/contracts/check-triggers", params);
    },
  });
}

// ============================================
// PHASE 4: REFERENCE VIEW AUDIT TRAIL
// ============================================

export function useContractViewHistory(limit = 50, offset = 0) {
  const { data: session } = useSession();
  const isAuthenticated = !!session?.user;

  return useQuery({
    queryKey: [...contractKeys.viewHistory(), limit, offset],
    queryFn: () =>
      api.get<GetContractViewHistoryResponse>(
        `/api/contracts/view-history?limit=${limit}&offset=${offset}`
      ),
    enabled: isAuthenticated,
  });
}

export function useLogContractView() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: LogContractViewRequest) => {
      return api.post<LogContractViewResponse>("/api/contracts/log-view", params);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: contractKeys.viewHistory() });
    },
  });
}

// ============================================
// PHASE 5: PATTERN AWARENESS
// ============================================

export function useContractPatterns() {
  const { data: session } = useSession();
  const isAuthenticated = !!session?.user;

  return useQuery({
    queryKey: contractKeys.patterns(),
    queryFn: () => api.get<GetContractPatternsResponse>("/api/contracts/patterns"),
    enabled: isAuthenticated,
  });
}

export function useAcknowledgePattern() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (patternId: string) => {
      return api.post<AcknowledgePatternResponse>(
        `/api/contracts/patterns/${patternId}/acknowledge`,
        {}
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: contractKeys.patterns() });
    },
  });
}

// ============================================
// PATTERN DESCRIPTION HELPERS (SAFE LANGUAGE)
// ============================================

// Get human-readable pattern description (non-advisory language only)
export function getPatternDescription(
  patternType: string,
  count: number,
  windowMonths: number
): string {
  const patterns: Record<string, string> = {
    RESERVE_EXTENSION: `You have recorded ${count} reserve availability extension${count === 1 ? "" : "s"} in the past ${windowMonths} months.`,
    SCHEDULE_CHANGE: `You have recorded ${count} schedule change${count === 1 ? "" : "s"} in the past ${windowMonths} months.`,
    DUTY_EXTENSION: `You have recorded ${count} duty extension${count === 1 ? "" : "s"} in the past ${windowMonths} months.`,
    CREDIT_PROTECTED_RESERVE: `You have recorded ${count} credit-protected reserve schedule${count === 1 ? "" : "s"} in the past ${windowMonths} months.`,
    JUNIOR_ASSIGNMENT: `You have recorded ${count} junior assignment${count === 1 ? "" : "s"} in the past ${windowMonths} months.`,
    REASSIGNMENT: `You have recorded ${count} reassignment${count === 1 ? "" : "s"} in the past ${windowMonths} months.`,
    DEADHEAD: `You have recorded ${count} deadhead segment${count === 1 ? "" : "s"} in the past ${windowMonths} months.`,
    TRAINING: `You have recorded ${count} training assignment${count === 1 ? "" : "s"} in the past ${windowMonths} months.`,
  };
  return patterns[patternType] ?? `Pattern detected: ${count} occurrence${count === 1 ? "" : "s"}.`;
}

// Get trigger reason text (non-advisory language only)
export function getTriggerReasonText(triggerPattern: string): string {
  const reasons: Record<string, string> = {
    RESERVE_EXTENSION:
      "This section is linked because this schedule was recorded as a reserve extension.",
    SCHEDULE_CHANGE:
      "This section is linked because a schedule change was recorded.",
    DUTY_EXTENSION:
      "This section is linked because this schedule includes a duty extension.",
    CREDIT_PROTECTED_RESERVE:
      "This section is linked because this reserve schedule has credit protection.",
    JUNIOR_ASSIGNMENT:
      "This section is linked because this was recorded as a junior assignment.",
    REASSIGNMENT:
      "This section is linked because this was recorded as a reassignment.",
    DEADHEAD:
      "This section is linked because this includes a deadhead segment.",
    TRAINING:
      "This section is linked because this was recorded as a training assignment.",
  };
  return reasons[triggerPattern] ?? "This section may be relevant to the recorded schedule.";
}

// ============================================
// PHASE 6: EXPORT FOOTER
// ============================================

export interface ContractExportFooter {
  references: Array<{
    code: string;
    title: string;
    documentTitle: string;
    page: number | null;
  }>;
  footerText: string;
  disclaimer: string;
}

export function useContractExportFooter(options?: {
  startDate?: string;
  endDate?: string;
  limit?: number;
  enabled?: boolean;
}) {
  const { data: session } = useSession();
  const isAuthenticated = !!session?.user;

  const params = new URLSearchParams();
  if (options?.startDate) params.append("startDate", options.startDate);
  if (options?.endDate) params.append("endDate", options.endDate);
  if (options?.limit) params.append("limit", options.limit.toString());

  const queryString = params.toString();

  return useQuery({
    queryKey: [...contractKeys.all, "exportFooter", queryString],
    queryFn: () => api.get<{ success: boolean } & ContractExportFooter>(
      `/api/contracts/export-footer${queryString ? `?${queryString}` : ""}`
    ),
    enabled: isAuthenticated && (options?.enabled ?? true),
  });
}

// Format footer for plain text exports
export function formatContractExportFooterText(footer: ContractExportFooter): string {
  if (!footer.references.length) {
    return `\n\n---\n${footer.disclaimer}`;
  }

  return `

---
${footer.footerText}

${footer.disclaimer}
---`;
}
