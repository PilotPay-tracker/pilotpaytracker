import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { PDFParse } from "pdf-parse";
import { type AppType } from "../types";
import { db } from "../db";
import {
  uploadContractRequestSchema,
  updateContractRequestSchema,
  searchContractSectionsRequestSchema,
  findRelevantSectionsRequestSchema,
  referenceFeedbackRequestSchema,
  advancedContractSearchRequestSchema,
  aiSuggestKeywordsRequestSchema,
  saveContractReferenceRequestSchema,
  contractDocumentTypeValues,
  searchCategoryValues,
  // Phase 4: View History
  getContractViewHistoryResponseSchema,
  logContractViewRequestSchema,
  logContractViewResponseSchema,
  // Phase 5: Pattern Awareness
  getContractPatternsResponseSchema,
  acknowledgePatternResponseSchema,
  // Phase 2: Deep Linking
  getContractSectionResponseSchema,
  // Phase 3: Triggers
  getContractTriggersResponseSchema,
  createContractTriggerRequestSchema,
  createContractTriggerResponseSchema,
  deleteContractTriggerResponseSchema,
  checkContractTriggersRequestSchema,
  checkContractTriggersResponseSchema,
  // Phase 7: Disclaimer
  CONTRACT_DISCLAIMER_TEXT,
  type GetContractsResponse,
  type GetContractResponse,
  type UploadContractResponse,
  type UpdateContractResponse,
  type DeleteContractResponse,
  type ReparseContractResponse,
  type GetContractReferencesResponse,
  type SearchContractSectionsResponse,
  type FindRelevantSectionsResponse,
  type ReferenceFeedbackResponse,
  type AdvancedContractSearchResponse,
  type AiSuggestKeywordsResponse,
  type GetSavedReferencesResponse,
  type SaveContractReferenceResponse,
  type DeleteSavedReferenceResponse,
  type ContractSearchResult,
  type SearchConfidence,
  type GetContractViewHistoryResponse,
  type LogContractViewResponse,
  type GetContractPatternsResponse,
  type AcknowledgePatternResponse,
  type GetContractSectionResponse,
  type GetContractTriggersResponse,
  type CreateContractTriggerResponse,
  type DeleteContractTriggerResponse,
  type CheckContractTriggersResponse,
} from "@/shared/contracts";

// ============================================
// Contracts directory setup
// ============================================
const CONTRACTS_DIR = path.join(process.cwd(), "uploads", "contracts");
if (!fs.existsSync(CONTRACTS_DIR)) {
  console.log("📁 [Contracts] Creating contracts directory:", CONTRACTS_DIR);
  fs.mkdirSync(CONTRACTS_DIR, { recursive: true });
}

const contractsRouter = new Hono<AppType>();

// Reference-only disclaimer text
const DISCLAIMER_TEXT = "These documents are used for reference only. The app does not interpret or enforce contract terms.";

// Helper to serialize dates for response
const serializeDocument = (doc: any) => ({
  ...doc,
  createdAt: doc.createdAt.toISOString(),
  updatedAt: doc.updatedAt.toISOString(),
  disclaimerAcceptedAt: doc.disclaimerAcceptedAt?.toISOString() ?? null,
  sections: doc.sections?.map(serializeSection) ?? undefined,
});

const serializeSection = (section: any) => ({
  ...section,
  createdAt: section.createdAt.toISOString(),
  updatedAt: section.updatedAt.toISOString(),
});

const serializeReference = (ref: any) => ({
  ...ref,
  createdAt: ref.createdAt.toISOString(),
  viewedAt: ref.viewedAt?.toISOString() ?? null,
});

const serializeViewLog = (log: any) => ({
  id: log.id,
  userId: log.userId,
  documentId: log.documentId,
  sectionId: log.sectionId ?? null,
  viewSource: log.viewSource,
  relatedEntityType: log.relatedEntityType ?? null,
  relatedEntityId: log.relatedEntityId ?? null,
  referenceCode: log.referenceCode ?? null,
  pageNumber: log.pageNumber ?? null,
  viewedAt: log.viewedAt.toISOString(),
});

const serializeTrigger = (trigger: any) => ({
  id: trigger.id,
  userId: trigger.userId,
  triggerPattern: trigger.triggerPattern,
  documentId: trigger.documentId,
  sectionId: trigger.sectionId,
  sectionNumber: trigger.sectionNumber ?? null,
  displayTitle: trigger.displayTitle ?? null,
  conditions: trigger.conditions ?? null,
  isActive: trigger.isActive,
  isUserCreated: trigger.isUserCreated,
  createdAt: trigger.createdAt.toISOString(),
  updatedAt: trigger.updatedAt.toISOString(),
});

const serializePattern = (pattern: any) => ({
  id: pattern.id,
  userId: pattern.userId,
  patternType: pattern.patternType,
  patternDescription: pattern.patternDescription,
  occurrenceCount: pattern.occurrenceCount,
  firstOccurrence: pattern.firstOccurrence.toISOString(),
  lastOccurrence: pattern.lastOccurrence.toISOString(),
  rollingWindowMonths: pattern.rollingWindowMonths,
  relatedEntityIds: pattern.relatedEntityIds ?? null,
  isAcknowledged: pattern.isAcknowledged,
  acknowledgedAt: pattern.acknowledgedAt?.toISOString() ?? null,
  createdAt: pattern.createdAt.toISOString(),
  updatedAt: pattern.updatedAt.toISOString(),
});

// ============================================
// GET /api/contracts - List user's contract documents
// ============================================
contractsRouter.get("/", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  console.log(`📄 [Contracts] Listing contracts for user: ${user.id}`);

  try {
    const documents = await db.contractDocument.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      include: {
        sections: {
          orderBy: { sortOrder: "asc" },
          take: 5, // Only include first 5 sections in list view
        },
      },
    });

    const activeCount = documents.filter((d) => d.isActive).length;

    return c.json({
      documents: documents.map(serializeDocument),
      hasActiveDocuments: activeCount > 0,
      totalCount: documents.length,
    } satisfies GetContractsResponse);
  } catch (error) {
    console.error("💥 [Contracts] Error listing contracts:", error);
    return c.json({ error: "Failed to list contracts" }, 500);
  }
});

// ============================================
// GET /api/contracts/view-history - Get reference view history
// ============================================
contractsRouter.get("/view-history", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const limitStr = c.req.query("limit");
  const offsetStr = c.req.query("offset");
  const limit = limitStr ? parseInt(limitStr, 10) : 50;
  const offset = offsetStr ? parseInt(offsetStr, 10) : 0;

  console.log(`[Contracts] Getting view history for user: ${user.id}`);

  try {
    const [views, totalCount] = await Promise.all([
      db.contractReferenceViewLog.findMany({
        where: { userId: user.id },
        orderBy: { viewedAt: "desc" },
        take: limit,
        skip: offset,
      }),
      db.contractReferenceViewLog.count({
        where: { userId: user.id },
      }),
    ]);

    return c.json({
      views: views.map(serializeViewLog),
      totalCount,
    } satisfies GetContractViewHistoryResponse);
  } catch (error) {
    console.error("[Contracts] View history error:", error);
    return c.json({ error: "Failed to get view history" }, 500);
  }
});

// ============================================
// POST /api/contracts/log-view - Log a reference view
// ============================================
contractsRouter.post("/log-view", zValidator("json", logContractViewRequestSchema), async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const data = c.req.valid("json");
  console.log(`[Contracts] Logging view for user: ${user.id}, document: ${data.documentId}`);

  try {
    // Verify the document belongs to the user
    const document = await db.contractDocument.findFirst({
      where: { id: data.documentId, userId: user.id },
    });

    if (!document) {
      return c.json({ error: "Document not found" }, 404);
    }

    // If sectionId provided, verify it exists
    if (data.sectionId) {
      const section = await db.contractSection.findFirst({
        where: { id: data.sectionId, documentId: data.documentId },
      });
      if (!section) {
        return c.json({ error: "Section not found" }, 404);
      }
    }

    const viewLog = await db.contractReferenceViewLog.create({
      data: {
        userId: user.id,
        documentId: data.documentId,
        sectionId: data.sectionId ?? null,
        viewSource: data.viewSource,
        relatedEntityType: data.relatedEntityType ?? null,
        relatedEntityId: data.relatedEntityId ?? null,
        referenceCode: data.referenceCode ?? null,
        pageNumber: data.pageNumber ?? null,
      },
    });

    return c.json({
      success: true,
      viewLog: serializeViewLog(viewLog),
    } satisfies LogContractViewResponse);
  } catch (error) {
    console.error("[Contracts] Log view error:", error);
    return c.json({ error: "Failed to log view" }, 500);
  }
});

// ============================================
// GET /api/contracts/patterns - Get detected patterns
// ============================================
contractsRouter.get("/patterns", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  console.log(`[Contracts] Getting patterns for user: ${user.id}`);

  try {
    // Run pattern detection before returning — keeps patterns fresh
    await detectAndUpsertPatterns(user.id);

    const patterns = await db.contractPatternDetection.findMany({
      where: { userId: user.id },
      orderBy: { lastOccurrence: "desc" },
    });

    return c.json({
      patterns: patterns.map(serializePattern),
      totalCount: patterns.length,
    } satisfies GetContractPatternsResponse);
  } catch (error) {
    console.error("[Contracts] Patterns error:", error);
    return c.json({ error: "Failed to get patterns" }, 500);
  }
});

// ============================================
// POST /api/contracts/patterns/:id/acknowledge - Acknowledge a pattern
// ============================================
contractsRouter.post("/patterns/:id/acknowledge", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const { id } = c.req.param();
  console.log(`[Contracts] Acknowledging pattern: ${id}`);

  try {
    // Verify ownership
    const existing = await db.contractPatternDetection.findFirst({
      where: { id, userId: user.id },
    });

    if (!existing) {
      return c.json({ error: "Pattern not found" }, 404);
    }

    const pattern = await db.contractPatternDetection.update({
      where: { id },
      data: {
        isAcknowledged: true,
        acknowledgedAt: new Date(),
      },
    });

    return c.json({
      success: true,
      pattern: serializePattern(pattern),
    } satisfies AcknowledgePatternResponse);
  } catch (error) {
    console.error("[Contracts] Acknowledge pattern error:", error);
    return c.json({ error: "Failed to acknowledge pattern" }, 500);
  }
});

// ============================================
// GET /api/contracts/triggers - List reference triggers
// ============================================
contractsRouter.get("/triggers", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  console.log(`[Contracts] Getting triggers for user: ${user.id}`);

  try {
    const triggers = await db.contractReferenceTrigger.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });

    return c.json({
      triggers: triggers.map(serializeTrigger),
      totalCount: triggers.length,
    } satisfies GetContractTriggersResponse);
  } catch (error) {
    console.error("[Contracts] Triggers error:", error);
    return c.json({ error: "Failed to get triggers" }, 500);
  }
});

// ============================================
// POST /api/contracts/triggers - Create a reference trigger
// ============================================
contractsRouter.post("/triggers", zValidator("json", createContractTriggerRequestSchema), async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const data = c.req.valid("json");
  console.log(`[Contracts] Creating trigger for user: ${user.id}, pattern: ${data.triggerPattern}`);

  try {
    // Verify the document belongs to the user
    const document = await db.contractDocument.findFirst({
      where: { id: data.documentId, userId: user.id },
    });

    if (!document) {
      return c.json({ error: "Document not found" }, 404);
    }

    // Verify the section exists in the document
    const section = await db.contractSection.findFirst({
      where: { id: data.sectionId, documentId: data.documentId },
    });

    if (!section) {
      return c.json({ error: "Section not found" }, 404);
    }

    const trigger = await db.contractReferenceTrigger.create({
      data: {
        userId: user.id,
        triggerPattern: data.triggerPattern,
        documentId: data.documentId,
        sectionId: data.sectionId,
        sectionNumber: data.sectionNumber ?? section.sectionNumber ?? null,
        displayTitle: data.displayTitle ?? section.heading ?? null,
        conditions: data.conditions ?? null,
        isActive: true,
        isUserCreated: true,
      },
    });

    return c.json({
      success: true,
      trigger: serializeTrigger(trigger),
    } satisfies CreateContractTriggerResponse);
  } catch (error) {
    console.error("[Contracts] Create trigger error:", error);
    return c.json({ error: "Failed to create trigger" }, 500);
  }
});

// ============================================
// DELETE /api/contracts/triggers/:id - Delete a reference trigger
// ============================================
contractsRouter.delete("/triggers/:id", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const { id } = c.req.param();
  console.log(`[Contracts] Deleting trigger: ${id}`);

  try {
    // Verify ownership
    const existing = await db.contractReferenceTrigger.findFirst({
      where: { id, userId: user.id },
    });

    if (!existing) {
      return c.json({ error: "Trigger not found" }, 404);
    }

    await db.contractReferenceTrigger.delete({
      where: { id },
    });

    return c.json({
      success: true,
    } satisfies DeleteContractTriggerResponse);
  } catch (error) {
    console.error("[Contracts] Delete trigger error:", error);
    return c.json({ error: "Failed to delete trigger" }, 500);
  }
});

// ============================================
// POST /api/contracts/check-triggers - Check for triggered references
// ============================================
contractsRouter.post(
  "/check-triggers",
  zValidator("json", checkContractTriggersRequestSchema),
  async (c) => {
    const user = c.get("user");
    if (!user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const data = c.req.valid("json");
    console.log(`[Contracts] Checking triggers for entity: ${data.entityType}/${data.entityId}`);

    try {
      // Get all active triggers for the user
      const triggers = await db.contractReferenceTrigger.findMany({
        where: {
          userId: user.id,
          isActive: true,
        },
      });

      if (triggers.length === 0) {
        return c.json({
          hasTriggeredReferences: false,
          triggeredReferences: [],
        } satisfies CheckContractTriggersResponse);
      }

      // Get document titles for the triggered references
      const documentIds = [...new Set(triggers.map((t) => t.documentId))];
      const documents = await db.contractDocument.findMany({
        where: { id: { in: documentIds } },
      });
      const docMap = new Map(documents.map((d) => [d.id, d]));

      // Get sections for page numbers
      const sectionIds = [...new Set(triggers.map((t) => t.sectionId))];
      const sections = await db.contractSection.findMany({
        where: { id: { in: sectionIds } },
      });
      const sectionMap = new Map(sections.map((s) => [s.id, s]));

      // Determine which triggers fire based on context
      const context = data.context ?? {};
      const triggeredReferences: CheckContractTriggersResponse["triggeredReferences"] = [];

      for (const trigger of triggers) {
        let shouldTrigger = false;
        let triggerReason = "";

        // Match trigger pattern with context flags (reference-only, non-advisory language)
        switch (trigger.triggerPattern) {
          case "RESERVE_EXTENSION":
            if (context.isExtension) {
              shouldTrigger = true;
              triggerReason = "This section is linked because this schedule was recorded as a reserve extension.";
            }
            break;
          case "SCHEDULE_CHANGE":
            // Schedule changes are relevant for many contexts
            shouldTrigger = true;
            triggerReason = "This section is linked for reference when reviewing schedule changes.";
            break;
          case "DUTY_EXTENSION":
            if (context.isDutyExtension) {
              shouldTrigger = true;
              triggerReason = "This section is linked because this schedule was recorded as a duty extension.";
            }
            break;
          case "CREDIT_PROTECTED_RESERVE":
            if (context.isCreditProtected) {
              shouldTrigger = true;
              triggerReason = "This section is linked because this schedule was recorded as credit-protected.";
            }
            break;
          case "JUNIOR_ASSIGNMENT":
            if (context.isJuniorAssignment) {
              shouldTrigger = true;
              triggerReason = "This section is linked because this schedule was recorded as a junior assignment.";
            }
            break;
          case "REASSIGNMENT":
            if (context.isReassignment) {
              shouldTrigger = true;
              triggerReason = "This section is linked because this schedule was recorded as a reassignment.";
            }
            break;
          case "DEADHEAD":
            if (context.isDeadhead) {
              shouldTrigger = true;
              triggerReason = "This section is linked because this schedule includes deadhead segments.";
            }
            break;
          case "TRAINING":
            if (context.scheduleType?.toLowerCase().includes("training")) {
              shouldTrigger = true;
              triggerReason = "This section is linked because this is a training assignment.";
            }
            break;
        }

        // Check custom conditions if present
        if (trigger.conditions && !shouldTrigger) {
          try {
            const conditions = JSON.parse(trigger.conditions);
            // Simple condition matching - can be expanded
            if (conditions.scheduleTypes?.includes(context.scheduleType)) {
              shouldTrigger = true;
              triggerReason = `This section is linked based on the schedule type: ${context.scheduleType}.`;
            }
          } catch {
            // Invalid JSON conditions, skip
          }
        }

        if (shouldTrigger) {
          const doc = docMap.get(trigger.documentId);
          const section = sectionMap.get(trigger.sectionId);

          triggeredReferences.push({
            triggerId: trigger.id,
            triggerPattern: trigger.triggerPattern as any,
            sectionId: trigger.sectionId,
            sectionNumber: trigger.sectionNumber ?? null,
            displayTitle: trigger.displayTitle ?? null,
            documentId: trigger.documentId,
            documentTitle: doc?.title ?? "Unknown Document",
            pageNumber: section?.pageNumber ?? null,
            triggerReason,
          });
        }
      }

      return c.json({
        hasTriggeredReferences: triggeredReferences.length > 0,
        triggeredReferences,
      } satisfies CheckContractTriggersResponse);
    } catch (error) {
      console.error("[Contracts] Check triggers error:", error);
      return c.json({ error: "Failed to check triggers" }, 500);
    }
  }
);

// ============================================
// Named-path GET routes — MUST come before /:id wildcard
// ============================================

// GET /api/contracts/references
contractsRouter.get("/references", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const triggerType = c.req.query("triggerType");
  const triggerEntityId = c.req.query("triggerEntityId");
  const limit = parseInt(c.req.query("limit") ?? "20", 10);
  console.log(`📚 [Contracts] Getting references for user: ${user.id}`);
  try {
    const references = await db.contractReference.findMany({
      where: { userId: user.id, ...(triggerType && { triggerType }), ...(triggerEntityId && { triggerEntityId }) },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return c.json({ references: references.map(serializeReference) } satisfies GetContractReferencesResponse);
  } catch (error) {
    console.error("💥 [Contracts] References error:", error);
    return c.json({ error: "Failed to get references" }, 500);
  }
});

// GET /api/contracts/saved-references
contractsRouter.get("/saved-references", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  console.log(`📚 [Contracts] Getting saved references for user: ${user.id}`);
  try {
    const references = await db.savedContractReference.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });
    return c.json({
      references: references.map((ref) => ({
        ...ref,
        category: ref.category as "pay" | "scheduling" | "reserve" | "training" | "deadhead" | "other" | null,
        createdAt: ref.createdAt.toISOString(),
        updatedAt: ref.updatedAt.toISOString(),
      })),
      totalCount: references.length,
    } satisfies GetSavedReferencesResponse);
  } catch (error) {
    console.error("💥 [Contracts] Saved references error:", error);
    return c.json({ error: "Failed to get saved references" }, 500);
  }
});

// GET /api/contracts/export-footer
contractsRouter.get("/export-footer", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const startDate = c.req.query("startDate") ? new Date(c.req.query("startDate")!) : undefined;
  const endDate = c.req.query("endDate") ? new Date(c.req.query("endDate")!) : undefined;
  const limit = parseInt(c.req.query("limit") ?? "10", 10);
  console.log(`📄 [Contracts] Getting export footer for user ${user.id}`);
  try {
    const viewLogs = await db.contractReferenceViewLog.findMany({
      where: { userId: user.id, ...(startDate && endDate && { viewedAt: { gte: startDate, lte: endDate } }) },
      orderBy: { viewedAt: "desc" },
      include: {
        section: { select: { sectionNumber: true, heading: true, displayTitle: true, pageNumber: true } },
        document: { select: { title: true } },
      },
      take: limit * 2,
    });
    const seenSections = new Set<string>();
    const references: Array<{ code: string; title: string; documentTitle: string; page: number | null }> = [];
    for (const log of viewLogs) {
      if (log.sectionId && !seenSections.has(log.sectionId)) {
        seenSections.add(log.sectionId);
        if (log.section && log.document) {
          references.push({
            code: log.section.sectionNumber ?? log.referenceCode ?? "N/A",
            title: log.section.displayTitle ?? log.section.heading,
            documentTitle: log.document.title,
            page: log.section.pageNumber ?? log.pageNumber ?? null,
          });
        }
      }
      if (references.length >= limit) break;
    }
    const footerText = references.length > 0
      ? `Contract References: ${references.map((r) => `${r.code} (${r.documentTitle}${r.page ? `, p.${r.page}` : ""})`).join("; ")}`
      : "";
    return c.json({
      success: true, references, footerText,
      disclaimer: "Contract references are provided for informational purposes only.",
    });
  } catch (error) {
    console.error("💥 [Contracts] Export footer error:", error);
    return c.json({ error: "Failed to get export footer" }, 500);
  }
});

// ============================================
// GET /api/contracts/:id - Get single contract with sections
// ============================================
contractsRouter.get("/:id", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const { id } = c.req.param();
  console.log(`📄 [Contracts] Getting contract: ${id}`);

  try {
    const document = await db.contractDocument.findFirst({
      where: { id, userId: user.id },
      include: {
        sections: {
          orderBy: { sortOrder: "asc" },
        },
      },
    });

    if (!document) {
      return c.json({ error: "Contract not found" }, 404);
    }

    return c.json({
      document: serializeDocument(document),
    } satisfies GetContractResponse);
  } catch (error) {
    console.error("💥 [Contracts] Error getting contract:", error);
    return c.json({ error: "Failed to get contract" }, 500);
  }
});

// ============================================
// GET /api/contracts/:id/section/:sectionId - Get section for deep-link
// ============================================
contractsRouter.get("/:id/section/:sectionId", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const { id, sectionId } = c.req.param();
  console.log(`[Contracts] Getting section: ${sectionId} from document: ${id}`);

  try {
    // Get the document with all sections for navigation context
    const document = await db.contractDocument.findFirst({
      where: { id, userId: user.id },
      include: {
        sections: {
          orderBy: { sortOrder: "asc" },
        },
      },
    });

    if (!document) {
      return c.json({ error: "Contract not found" }, 404);
    }

    // Find the requested section
    const sectionIndex = document.sections.findIndex((s) => s.id === sectionId);
    if (sectionIndex === -1) {
      return c.json({ error: "Section not found" }, 404);
    }

    const section = document.sections[sectionIndex];
    const prevSection = sectionIndex > 0 ? document.sections[sectionIndex - 1] : null;
    const nextSection = sectionIndex < document.sections.length - 1 ? document.sections[sectionIndex + 1] : null;

    return c.json({
      section: serializeSection(section),
      document: serializeDocument({ ...document, sections: undefined }),
      prevSection: prevSection
        ? {
            id: prevSection.id,
            heading: prevSection.heading,
            sectionNumber: prevSection.sectionNumber ?? null,
          }
        : null,
      nextSection: nextSection
        ? {
            id: nextSection.id,
            heading: nextSection.heading,
            sectionNumber: nextSection.sectionNumber ?? null,
          }
        : null,
    } satisfies GetContractSectionResponse);
  } catch (error) {
    console.error("[Contracts] Get section error:", error);
    return c.json({ error: "Failed to get section" }, 500);
  }
});

// ============================================
// POST /api/contracts/upload - Upload a contract document
// ============================================
// Accepts multipart/form-data with "file" field + metadata
contractsRouter.post("/upload", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  console.log("📤 [Contracts] Contract upload request received");

  try {
    const formData = await c.req.formData();
    const file = formData.get("file") as File | null;
    const title = formData.get("title") as string | null;
    const documentType = formData.get("documentType") as string | null;
    const disclaimerAccepted = formData.get("disclaimerAccepted") === "true";
    const versionLabel = formData.get("versionLabel") as string | null;

    // Validate required fields
    if (!file) {
      return c.json({ error: "No file provided" }, 400);
    }
    if (!title) {
      return c.json({ error: "Title is required" }, 400);
    }
    if (!documentType || !contractDocumentTypeValues.includes(documentType as any)) {
      return c.json({ error: "Valid document type is required" }, 400);
    }
    if (!disclaimerAccepted) {
      return c.json({ error: "You must accept the disclaimer to upload documents" }, 400);
    }

    console.log(`📄 [Contracts] File: ${file.name} (${file.type}, ${(file.size / 1024).toFixed(2)} KB)`);

    // Validate file type (PDF, images, DOC/DOCX)
    const allowedTypes = [
      "application/pdf",
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/webp",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];
    if (!allowedTypes.includes(file.type)) {
      return c.json({ error: "Invalid file type. Allowed: PDF, images (JPEG, PNG, WebP), Word documents" }, 400);
    }

    // Validate file size (50MB limit for contracts)
    const maxSize = 50 * 1024 * 1024;
    if (file.size > maxSize) {
      return c.json({ error: "File too large. Maximum size is 50MB" }, 400);
    }

    // ── Duplicate detection ──────────────────────────────────────────────────
    // Prevent uploading the exact same file (matched by original filename) twice
    const existingDuplicate = await db.contractDocument.findFirst({
      where: {
        userId: user.id,
        fileName: file.name,
      },
    });
    if (existingDuplicate) {
      console.log(`⚠️ [Contracts] Duplicate file detected: ${file.name} (existing id: ${existingDuplicate.id})`);
      return c.json(
        { error: `This file has already been uploaded as "${existingDuplicate.title}". Delete the existing document first if you want to replace it.` },
        409
      );
    }
    // ────────────────────────────────────────────────────────────────────────

    // Generate unique filename
    const fileExtension = path.extname(file.name);
    const uniqueFilename = `${randomUUID()}${fileExtension}`;
    const filePath = path.join(CONTRACTS_DIR, uniqueFilename);

    // Save file to disk
    console.log(`💾 [Contracts] Saving file to: ${filePath}`);
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    fs.writeFileSync(filePath, buffer);

    // Create database record - mark as processing immediately
    const fileUrl = `/uploads/contracts/${uniqueFilename}`;
    const document = await db.contractDocument.create({
      data: {
        userId: user.id,
        title,
        documentType,
        fileUrl,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
        parseStatus: "processing",
        disclaimerAcceptedAt: new Date(),
        isActive: true,
        versionLabel: versionLabel ?? null,
      },
    });

    console.log(`✅ [Contracts] Contract record created: ${document.id} — starting parse`);

    // ── Immediate inline parsing ─────────────────────────────────────────────
    // Extract text content and create searchable sections so the document is
    // immediately available for AI search without a separate async job.
    try {
      await parseAndIndexDocument(document.id, filePath, file.type, title, buffer);
      console.log(`✅ [Contracts] Parsing complete for: ${document.id}`);
    } catch (parseError) {
      console.error(`⚠️ [Contracts] Parse failed for ${document.id}:`, parseError);
      // Don't fail the upload — just mark parse as failed
      await db.contractDocument.update({
        where: { id: document.id },
        data: {
          parseStatus: "failed",
          parseError: parseError instanceof Error ? parseError.message : "Unknown parse error",
        },
      });
    }
    // ────────────────────────────────────────────────────────────────────────

    // Return fresh document with updated parse status
    const updatedDocument = await db.contractDocument.findFirst({
      where: { id: document.id },
    });

    return c.json({
      success: true,
      document: serializeDocument(updatedDocument ?? document),
      message: "Contract uploaded and indexed successfully.",
    } satisfies UploadContractResponse);
  } catch (error) {
    console.error("💥 [Contracts] Upload error:", error);
    return c.json({ error: "Failed to upload contract" }, 500);
  }
});

// ============================================
// PUT /api/contracts/:id - Update contract metadata
// ============================================
contractsRouter.put("/:id", zValidator("json", updateContractRequestSchema), async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const { id } = c.req.param();
  const data = c.req.valid("json");
  console.log(`📝 [Contracts] Updating contract: ${id}`);

  try {
    // Verify ownership
    const existing = await db.contractDocument.findFirst({
      where: { id, userId: user.id },
    });

    if (!existing) {
      return c.json({ error: "Contract not found" }, 404);
    }

    const document = await db.contractDocument.update({
      where: { id },
      data: {
        ...(data.title && { title: data.title }),
        ...(data.documentType && { documentType: data.documentType }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
      },
      include: {
        sections: {
          orderBy: { sortOrder: "asc" },
        },
      },
    });

    return c.json({
      success: true,
      document: serializeDocument(document),
    } satisfies UpdateContractResponse);
  } catch (error) {
    console.error("💥 [Contracts] Update error:", error);
    return c.json({ error: "Failed to update contract" }, 500);
  }
});

// ============================================
// DELETE /api/contracts/:id - Delete a contract document
// ============================================
contractsRouter.delete("/:id", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const { id } = c.req.param();
  console.log(`🗑️ [Contracts] Deleting contract: ${id}`);

  try {
    // Verify ownership and get file path
    const document = await db.contractDocument.findFirst({
      where: { id, userId: user.id },
    });

    if (!document) {
      return c.json({ error: "Contract not found" }, 404);
    }

    // Delete file from disk
    const filePath = path.join(process.cwd(), document.fileUrl);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`🗑️ [Contracts] Deleted file: ${filePath}`);
    }

    // Delete from database (cascades to sections and references)
    await db.contractDocument.delete({
      where: { id },
    });

    return c.json({
      success: true,
    } satisfies DeleteContractResponse);
  } catch (error) {
    console.error("💥 [Contracts] Delete error:", error);
    return c.json({ error: "Failed to delete contract" }, 500);
  }
});

// ============================================
// POST /api/contracts/:id/reparse - Trigger re-parsing
// ============================================
contractsRouter.post("/:id/reparse", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const { id } = c.req.param();
  console.log(`🔄 [Contracts] Re-parsing contract: ${id}`);

  try {
    const document = await db.contractDocument.findFirst({
      where: { id, userId: user.id },
    });

    if (!document) {
      return c.json({ error: "Contract not found" }, 404);
    }

    // Reset parse status
    const updated = await db.contractDocument.update({
      where: { id },
      data: {
        parseStatus: "pending",
        parseError: null,
      },
    });

    // TODO: Trigger async parsing job

    return c.json({
      success: true,
      document: serializeDocument(updated),
      message: "Re-parsing has been queued.",
    } satisfies ReparseContractResponse);
  } catch (error) {
    console.error("💥 [Contracts] Reparse error:", error);
    return c.json({ error: "Failed to trigger re-parse" }, 500);
  }
});

// ============================================
// POST /api/contracts/search - Search contract sections
// ============================================
contractsRouter.post("/search", zValidator("json", searchContractSectionsRequestSchema), async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const { query, documentIds, topics, limit = 10 } = c.req.valid("json");
  console.log(`🔍 [Contracts] Searching sections for: "${query}"`);

  try {
    // Get user's active documents
    const documents = await db.contractDocument.findMany({
      where: {
        userId: user.id,
        isActive: true,
        ...(documentIds && documentIds.length > 0 && { id: { in: documentIds } }),
      },
    });

    if (documents.length === 0) {
      return c.json({
        sections: [],
      } satisfies SearchContractSectionsResponse);
    }

    // Search sections - basic text search for now
    // In production, you'd want full-text search or vector similarity
    const sections = await db.contractSection.findMany({
      where: {
        documentId: { in: documents.map((d) => d.id) },
        OR: [
          { heading: { contains: query } },
          { content: { contains: query } },
          ...(topics && topics.length > 0 ? [{ topics: { contains: topics[0] } }] : []),
        ],
      },
      take: limit,
      orderBy: { sortOrder: "asc" },
    });

    // Map sections with document titles and relevance scores
    const docMap = new Map(documents.map((d) => [d.id, d]));
    const results = sections.map((section) => ({
      ...serializeSection(section),
      documentTitle: docMap.get(section.documentId)?.title ?? "Unknown",
      relevanceScore: 0.8, // Placeholder - would be calculated by search algorithm
      highlightedContent: highlightMatches(section.content, query),
    }));

    return c.json({
      sections: results,
    } satisfies SearchContractSectionsResponse);
  } catch (error) {
    console.error("💥 [Contracts] Search error:", error);
    return c.json({ error: "Failed to search contracts" }, 500);
  }
});

// ============================================
// POST /api/contracts/find-relevant - AI finds relevant sections
// ============================================
contractsRouter.post("/find-relevant", zValidator("json", findRelevantSectionsRequestSchema), async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const { triggerType, triggerEntityId, context, saveReference } = c.req.valid("json");
  console.log(`🤖 [Contracts] Finding relevant sections for: ${triggerType}`);

  try {
    // Get user's active documents with sections
    const documents = await db.contractDocument.findMany({
      where: {
        userId: user.id,
        isActive: true,
        parseStatus: "success",
      },
      include: {
        sections: true,
      },
    });

    if (documents.length === 0) {
      return c.json({
        hasRelevantSections: false,
        sections: [],
        disclaimer: DISCLAIMER_TEXT,
      } satisfies FindRelevantSectionsResponse);
    }

    // Get user's profile for airline context
    const profile = await db.profile.findFirst({
      where: { userId: user.id },
    });

    // Build AI context for finding relevant sections
    // This would typically call an LLM to analyze context vs sections
    // For now, we'll do keyword matching as a placeholder

    const keywords = extractKeywords(context, profile?.airline ?? "");
    const relevantSections: Array<{
      sectionId: string;
      documentId: string;
      documentTitle: string;
      sectionHeading: string;
      sectionNumber: string | null;
      snippet: string;
      relevanceScore: number;
      aiExplanation: string;
    }> = [];

    for (const doc of documents) {
      for (const section of doc.sections ?? []) {
        const score = calculateRelevance(section, keywords);
        if (score > 0.3) {
          relevantSections.push({
            sectionId: section.id,
            documentId: doc.id,
            documentTitle: doc.title,
            sectionHeading: section.heading,
            sectionNumber: section.sectionNumber,
            snippet: createSnippet(section.content, keywords),
            relevanceScore: score,
            aiExplanation: generateExplanation(section, keywords, triggerType),
          });
        }
      }
    }

    // Sort by relevance and limit
    relevantSections.sort((a, b) => b.relevanceScore - a.relevanceScore);
    const topSections = relevantSections.slice(0, 3);

    // Optionally save references for history
    if (saveReference && topSections.length > 0) {
      for (const section of topSections) {
        await db.contractReference.create({
          data: {
            userId: user.id,
            triggerType,
            triggerEntityId,
            sectionId: section.sectionId,
            documentId: section.documentId,
            relevanceScore: section.relevanceScore,
            snippet: section.snippet,
            aiExplanation: section.aiExplanation,
          },
        });
      }
    }

    return c.json({
      hasRelevantSections: topSections.length > 0,
      sections: topSections,
      disclaimer: DISCLAIMER_TEXT,
    } satisfies FindRelevantSectionsResponse);
  } catch (error) {
    console.error("💥 [Contracts] Find relevant error:", error);
    return c.json({ error: "Failed to find relevant sections" }, 500);
  }
});

// ============================================
// POST /api/contracts/references/:id/feedback - User feedback
// ============================================
contractsRouter.post(
  "/references/:id/feedback",
  zValidator("json", referenceFeedbackRequestSchema),
  async (c) => {
    const user = c.get("user");
    if (!user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const { id } = c.req.param();
    const { wasHelpful } = c.req.valid("json");

    console.log(`👍 [Contracts] Recording feedback for reference: ${id}`);

    try {
      await db.contractReference.updateMany({
        where: { id, userId: user.id },
        data: {
          wasHelpful,
          wasViewed: true,
          viewedAt: new Date(),
        },
      });

      return c.json({
        success: true,
      } satisfies ReferenceFeedbackResponse);
    } catch (error) {
      console.error("💥 [Contracts] Feedback error:", error);
      return c.json({ error: "Failed to record feedback" }, 500);
    }
  }
);

// ============================================
// POST /api/contracts/references/:id/view - Mark as viewed
// ============================================
contractsRouter.post("/references/:id/view", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const { id } = c.req.param();

  try {
    await db.contractReference.updateMany({
      where: { id, userId: user.id },
      data: {
        wasViewed: true,
        viewedAt: new Date(),
      },
    });

    return c.json({ success: true });
  } catch (error) {
    console.error("💥 [Contracts] View tracking error:", error);
    return c.json({ error: "Failed to track view" }, 500);
  }
});

// ============================================
// Document parsing & indexing
// ============================================

/**
 * Extracts text from the uploaded file and creates ContractSection rows so the
 * document is immediately searchable.  For PDFs we do a best-effort byte-level
 * text extraction (no native dependencies needed). For images we store a
 * placeholder section so the document still appears as "Ready" in the UI.
 */
async function parseAndIndexDocument(
  documentId: string,
  filePath: string,
  mimeType: string,
  title: string,
  buffer: Buffer
): Promise<void> {
  // Delete any existing sections (for re-parse scenarios)
  await db.contractSection.deleteMany({ where: { documentId } });

  let sections: Array<{ heading: string; content: string; sortOrder: number }> = [];

  if (mimeType === "application/pdf") {
    sections = await extractPdfSections(buffer, title);
  } else if (
    mimeType === "application/msword" ||
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    sections = extractWordSections(buffer, title);
  } else {
    // Image or unknown — store a single placeholder section
    sections = [
      {
        heading: title,
        content: `This document (${title}) has been uploaded for reference. Image-based documents cannot be text-searched but are stored for your records.`,
        sortOrder: 0,
      },
    ];
  }

  if (sections.length === 0) {
    sections = [
      {
        heading: title,
        content: `Document uploaded: ${title}. No extractable text content found.`,
        sortOrder: 0,
      },
    ];
  }

  // Persist all sections
  await db.contractSection.createMany({
    data: sections.map((s) => ({
      documentId,
      heading: s.heading,
      content: s.content,
      sortOrder: s.sortOrder,
      sectionNumber: null,
      pageNumber: null,
      topics: null,
    })),
  });

  // Mark document as successfully parsed
  await db.contractDocument.update({
    where: { id: documentId },
    data: { parseStatus: "success", parseError: null },
  });
}

/**
 * PDF text extraction using pdf-parse library.
 * Returns clean, readable sections split by detected headings.
 */
async function extractPdfSections(
  buffer: Buffer,
  title: string
): Promise<Array<{ heading: string; content: string; sortOrder: number }>> {
  try {
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    const fullText = result.text;

    if (!fullText || fullText.trim().length === 0) {
      return [];
    }

    // Split into lines and detect headings heuristically
    const lines = fullText.split(/\n+/);
    const sections: Array<{ heading: string; content: string; sortOrder: number }> = [];
    let currentHeading = title;
    let currentContent: string[] = [];
    let order = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Heading heuristic: short line, ALL CAPS or starts with Article/Section/Chapter/number
      const isHeading =
        trimmed.length < 90 &&
        trimmed.length > 2 &&
        (trimmed === trimmed.toUpperCase() ||
          /^(SECTION|ARTICLE|CHAPTER|PART|APPENDIX|\d+[\.\)]\s)/i.test(trimmed));

      if (isHeading && currentContent.length > 0) {
        sections.push({
          heading: currentHeading,
          content: currentContent.join(" ").trim(),
          sortOrder: order++,
        });
        currentHeading = trimmed;
        currentContent = [];
      } else if (isHeading) {
        currentHeading = trimmed;
      } else {
        currentContent.push(trimmed);
      }
    }

    // Flush last section
    if (currentContent.length > 0) {
      sections.push({
        heading: currentHeading,
        content: currentContent.join(" ").trim(),
        sortOrder: order,
      });
    }

    // Merge tiny sections into previous one
    const merged: typeof sections = [];
    for (const s of sections) {
      const last = merged[merged.length - 1];
      if (s.content.length < 60 && merged.length > 0 && last) {
        last.content += " " + s.content;
      } else {
        merged.push(s);
      }
    }

    console.log(`📑 [Contracts] PDF extracted ${merged.length} sections from "${title}"`);
    return merged;
  } catch (err) {
    console.error("[Contracts] pdf-parse extraction error:", err);
    return [];
  }
}

/**
 * Basic Word document text extraction.  DOCX files are ZIP archives containing
 * word/document.xml.  We look for that XML and strip tags to get plain text.
 */
function extractWordSections(
  buffer: Buffer,
  title: string
): Array<{ heading: string; content: string; sortOrder: number }> {
  try {
    const raw = buffer.toString("binary");

    // Look for the XML content between <w:t> tags (Word text runs)
    // DOCX is a zip so the raw bytes won't be directly readable as XML
    // but we can do a best-effort grep for text content
    const wTextRegex = /<w:t[^>]*>([^<]+)<\/w:t>/g;
    const texts: string[] = [];
    let m: RegExpExecArray | null;

    while ((m = wTextRegex.exec(raw)) !== null) {
      const t = (m[1] ?? "").trim();
      if (t.length > 0) texts.push(t);
    }

    if (texts.length === 0) {
      return [];
    }

    const fullText = texts.join(" ");

    // Simple split into one big section since Word docs vary widely
    return [
      {
        heading: title,
        content: fullText.slice(0, 50000), // cap at 50k chars
        sortOrder: 0,
      },
    ];
  } catch (err) {
    console.error("[Contracts] Word extraction error:", err);
    return [];
  }
}

// ============================================
// Pattern detection engine
// ============================================

/**
 * Analyzes the user's pay events and schedule changes to detect recurring
 * patterns (e.g. repeated junior assignments, reserve extensions, etc.).
 * Upserts rows into ContractPatternDetection so results stay current.
 */
async function detectAndUpsertPatterns(userId: string): Promise<void> {
  const WINDOW_MONTHS = 12;
  const windowStart = new Date();
  windowStart.setMonth(windowStart.getMonth() - WINDOW_MONTHS);

  // ── Pull raw data ────────────────────────────────────────────────────────
  const [payEvents, scheduleChanges] = await Promise.all([
    db.payEvent.findMany({
      where: {
        userId,
        eventDateISO: { gte: windowStart.toISOString().slice(0, 10) },
      },
      select: { id: true, eventType: true, eventDateISO: true, title: true },
    }),
    db.scheduleChange.findMany({
      where: {
        userId,
        createdAt: { gte: windowStart },
      },
      select: { id: true, changeType: true, tripDate: true, tripNumber: true, creditDiffMinutes: true },
    }),
  ]);

  // ── Define pattern detectors ─────────────────────────────────────────────
  type RawPattern = {
    patternType: string;
    description: string;
    ids: string[];
    dates: string[];
  };

  const detected: RawPattern[] = [];

  // Helper: group pay events by partial type match (case-insensitive)
  const groupPayByType = (...keywords: string[]) =>
    payEvents.filter(e => keywords.some(k => e.eventType.toUpperCase().includes(k.toUpperCase())));

  // Helper: group schedule changes by partial type match
  const groupChangeByType = (...keywords: string[]) =>
    scheduleChanges.filter(c => keywords.some(k => c.changeType.toUpperCase().includes(k.toUpperCase())));

  // 1. Junior Assignments
  const jas = groupPayByType("JUNIOR", "JA");
  if (jas.length >= 2) {
    detected.push({
      patternType: "JUNIOR_ASSIGNMENT",
      description: `${jas.length} junior assignment${jas.length > 1 ? "s" : ""} logged in the past ${WINDOW_MONTHS} months.`,
      ids: jas.map(e => e.id),
      dates: jas.map(e => e.eventDateISO),
    });
  }

  // 2. Reserve Extensions
  const reserveExts = groupPayByType("RESERVE_EXTENSION", "RESERVE EXTENSION", "RES_EXT");
  const reserveExtChanges = groupChangeByType("RESERVE");
  const allReserveExt = [
    ...reserveExts.map(e => ({ id: e.id, date: e.eventDateISO })),
    ...reserveExtChanges.map(c => ({ id: c.id, date: c.tripDate ?? "" })),
  ];
  if (allReserveExt.length >= 2) {
    detected.push({
      patternType: "RESERVE_EXTENSION",
      description: `${allReserveExt.length} reserve extension${allReserveExt.length > 1 ? "s" : ""} detected in the past ${WINDOW_MONTHS} months.`,
      ids: allReserveExt.map(x => x.id),
      dates: allReserveExt.map(x => x.date).filter(Boolean),
    });
  }

  // 3. Schedule Changes (any pay event or schedule change indicating a change)
  const scheduleChangePayEvents = groupPayByType("SCHEDULE_CHANGE", "REASSIGNMENT", "RESCHEDULED", "RESCHEDULE");
  const tripRemovedChanges = groupChangeByType("TRIP_REMOVED", "REMOVED", "SCHEDULE_CHANGE");
  const allScheduleChanges = [
    ...scheduleChangePayEvents.map(e => ({ id: e.id, date: e.eventDateISO })),
    ...tripRemovedChanges.map(c => ({ id: c.id, date: c.tripDate ?? "" })),
  ];
  if (allScheduleChanges.length >= 2) {
    detected.push({
      patternType: "SCHEDULE_CHANGE",
      description: `${allScheduleChanges.length} schedule change${allScheduleChanges.length > 1 ? "s" : ""} recorded in the past ${WINDOW_MONTHS} months.`,
      ids: allScheduleChanges.map(x => x.id),
      dates: allScheduleChanges.map(x => x.date).filter(Boolean),
    });
  }

  // 4. Duty Extensions
  const dutyExts = groupPayByType("DUTY_EXTENSION", "DUTY EXTENSION", "EXTENSION");
  const dutyExtChanges = groupChangeByType("EXTENSION", "DUTY");
  const allDutyExt = [
    ...dutyExts.map(e => ({ id: e.id, date: e.eventDateISO })),
    ...dutyExtChanges.map(c => ({ id: c.id, date: c.tripDate ?? "" })),
  ];
  if (allDutyExt.length >= 2) {
    detected.push({
      patternType: "DUTY_EXTENSION",
      description: `${allDutyExt.length} duty extension${allDutyExt.length > 1 ? "s" : ""} logged in the past ${WINDOW_MONTHS} months.`,
      ids: allDutyExt.map(x => x.id),
      dates: allDutyExt.map(x => x.date).filter(Boolean),
    });
  }

  // 5. Credit-Protected Reserve / Guarantee events
  const creditProtected = groupPayByType("CREDIT", "GUARANTEE", "PROTECTED", "PREMIUM");
  if (creditProtected.length >= 2) {
    detected.push({
      patternType: "CREDIT_PROTECTED_RESERVE",
      description: `${creditProtected.length} credit-protected or guaranteed pay event${creditProtected.length > 1 ? "s" : ""} in the past ${WINDOW_MONTHS} months.`,
      ids: creditProtected.map(e => e.id),
      dates: creditProtected.map(e => e.eventDateISO),
    });
  }

  // ── Upsert each detected pattern ─────────────────────────────────────────
  for (const p of detected) {
    if (p.dates.length === 0) continue;

    const sortedDates = [...p.dates].sort();
    const firstDate = new Date(sortedDates[0]!);
    const lastDate = new Date(sortedDates[sortedDates.length - 1]!);

    // Check if a non-acknowledged pattern of this type already exists
    const existing = await db.contractPatternDetection.findFirst({
      where: { userId, patternType: p.patternType, isAcknowledged: false },
    });

    if (existing) {
      await db.contractPatternDetection.update({
        where: { id: existing.id },
        data: {
          occurrenceCount: p.ids.length,
          patternDescription: p.description,
          firstOccurrence: firstDate,
          lastOccurrence: lastDate,
          relatedEntityIds: JSON.stringify(p.ids),
          updatedAt: new Date(),
        },
      });
    } else {
      await db.contractPatternDetection.create({
        data: {
          userId,
          patternType: p.patternType,
          patternDescription: p.description,
          occurrenceCount: p.ids.length,
          firstOccurrence: firstDate,
          lastOccurrence: lastDate,
          rollingWindowMonths: WINDOW_MONTHS,
          relatedEntityIds: JSON.stringify(p.ids),
          isAcknowledged: false,
        },
      });
    }
  }

  console.log(`[Contracts] Pattern detection complete for ${userId}: ${detected.length} pattern(s) found`);
}

// ============================================
// Helper functions
// ============================================

function highlightMatches(content: string, query: string): string {
  const words = query.toLowerCase().split(/\s+/);
  let result = content.slice(0, 300);

  for (const word of words) {
    if (word.length > 2) {
      const regex = new RegExp(`(${word})`, "gi");
      result = result.replace(regex, "**$1**");
    }
  }

  return result + (content.length > 300 ? "..." : "");
}

function extractKeywords(context: string, airline: string): string[] {
  const keywords: string[] = [];

  // Common pay-related keywords
  const payKeywords = [
    "schedule change", "reassignment", "premium", "guarantee",
    "junior assignment", "JA", "draft", "duty", "credit",
    "overtime", "extension", "deadhead", "reserve",
    "pay protection", "min day", "training"
  ];

  const contextLower = context.toLowerCase();
  for (const keyword of payKeywords) {
    if (contextLower.includes(keyword.toLowerCase())) {
      keywords.push(keyword);
    }
  }

  // Add airline for context
  if (airline) {
    keywords.push(airline);
  }

  return keywords;
}

function calculateRelevance(section: any, keywords: string[]): number {
  if (keywords.length === 0) return 0;

  const contentLower = (section.heading + " " + section.content).toLowerCase();
  let matches = 0;

  for (const keyword of keywords) {
    if (contentLower.includes(keyword.toLowerCase())) {
      matches++;
    }
  }

  // Check topics if available
  if (section.topics) {
    try {
      const topics = JSON.parse(section.topics);
      for (const topic of topics) {
        for (const keyword of keywords) {
          if (topic.toLowerCase().includes(keyword.toLowerCase())) {
            matches += 0.5;
          }
        }
      }
    } catch {}
  }

  return Math.min(matches / keywords.length, 1);
}

function createSnippet(content: string, keywords: string[]): string {
  // Find the first occurrence of any keyword and extract surrounding text
  const contentLower = content.toLowerCase();
  let bestIndex = -1;

  for (const keyword of keywords) {
    const index = contentLower.indexOf(keyword.toLowerCase());
    if (index !== -1 && (bestIndex === -1 || index < bestIndex)) {
      bestIndex = index;
    }
  }

  if (bestIndex === -1) {
    return content.slice(0, 200) + (content.length > 200 ? "..." : "");
  }

  const start = Math.max(0, bestIndex - 50);
  const end = Math.min(content.length, bestIndex + 150);

  return (
    (start > 0 ? "..." : "") +
    content.slice(start, end) +
    (end < content.length ? "..." : "")
  );
}

function generateExplanation(
  section: any,
  keywords: string[],
  triggerType: string
): string {
  const matchedKeywords = keywords.filter((k) =>
    (section.heading + " " + section.content).toLowerCase().includes(k.toLowerCase())
  );

  if (matchedKeywords.length === 0) {
    return "This section may contain relevant information.";
  }

  const keywordList = matchedKeywords.slice(0, 3).join(", ");

  switch (triggerType) {
    case "SCHEDULE_CHANGE":
      return `This section discusses ${keywordList} and may be relevant to understanding schedule change implications.`;
    case "PAY_EVENT":
      return `This section covers ${keywordList} which relates to the pay event you're documenting.`;
    case "PAY_REVIEW":
      return `Found references to ${keywordList} that may support your pay review.`;
    default:
      return `This section mentions ${keywordList}.`;
  }
}

// ============================================
// AIRLINE TERMINOLOGY PACK
// Common aviation pay terms and synonyms
// ============================================

const AIRLINE_TERMINOLOGY: Record<string, string[]> = {
  // Pay terms
  "junior assignment": ["JA", "junior", "draft", "assignment", "drafted"],
  "reassignment": ["reassign", "reassigned", "re-assignment", "reasign"],
  "guarantee": ["min day", "minimum", "daily guarantee", "trip guarantee", "rig"],
  "premium": ["premium pay", "bonus", "premium time", "extra pay"],
  "pay protection": ["protection", "pay protect", "protected"],
  "open time": ["open flying", "available trips", "pickup"],

  // Schedule terms
  "reserve": ["on call", "standby", "ready reserve", "short call", "long call"],
  "deadhead": ["DH", "dead head", "passenger", "positive space"],
  "training": ["recurrent", "initial training", "ground school", "sim"],
  "duty": ["duty time", "duty period", "duty day", "FDP"],
  "rest": ["rest period", "legal rest", "overnight", "layover"],

  // Limits
  "30-in-7": ["30 in 7", "thirty in seven", "weekly limit", "block limit"],
  "duty limit": ["max duty", "duty limitation", "FDP limit"],

  // General
  "credit": ["credit time", "flight credit", "trip credit"],
  "block": ["block time", "block hours", "actual block"],
  "trip": ["pairing", "sequence", "line", "rotation"],
};

// Category mapping keywords
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  pay: ["pay", "compensation", "credit", "guarantee", "premium", "rate", "overtime", "hourly"],
  scheduling: ["schedule", "assignment", "trip", "pairing", "bid", "line", "rotation"],
  reserve: ["reserve", "standby", "on call", "ready reserve", "short call", "long call", "airport standby"],
  training: ["training", "recurrent", "initial", "qualification", "ground school", "simulator", "check ride"],
  deadhead: ["deadhead", "DH", "positioning", "ferry", "positive space"],
  other: [],
};

function expandSearchTerms(query: string): string[] {
  const terms: Set<string> = new Set();
  const queryLower = query.toLowerCase();

  // Add original query terms
  queryLower.split(/\s+/).forEach(term => {
    if (term.length > 1) {
      terms.add(term);
    }
  });

  // Expand using terminology pack
  for (const [canonical, synonyms] of Object.entries(AIRLINE_TERMINOLOGY)) {
    const allTerms = [canonical.toLowerCase(), ...synonyms.map(s => s.toLowerCase())];
    const foundMatch = allTerms.some(t => queryLower.includes(t));

    if (foundMatch) {
      allTerms.forEach(t => terms.add(t));
    }
  }

  return Array.from(terms);
}

function inferCategory(content: string): string | null {
  const contentLower = content.toLowerCase();
  let bestCategory: string | null = null;
  let bestScore = 0;

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (category === "other") continue;

    let score = 0;
    for (const keyword of keywords) {
      const regex = new RegExp(`\\b${keyword}\\b`, "gi");
      const matches = contentLower.match(regex);
      score += matches?.length ?? 0;
    }

    if (score > bestScore) {
      bestScore = score;
      bestCategory = category;
    }
  }

  return bestScore > 0 ? bestCategory : null;
}

function calculateAdvancedRelevance(
  section: any,
  searchTerms: string[],
  matchType: "exact" | "fuzzy"
): { score: number; matchedTerms: string[]; confidence: SearchConfidence } {
  const contentLower = (section.heading + " " + section.content).toLowerCase();
  const matchedTerms: string[] = [];
  let score = 0;

  for (const term of searchTerms) {
    if (matchType === "exact") {
      // Exact word boundary match
      const regex = new RegExp(`\\b${term}\\b`, "gi");
      const matches = contentLower.match(regex);
      if (matches) {
        score += matches.length * 2;
        matchedTerms.push(term);
      }
    } else {
      // Fuzzy partial match
      if (contentLower.includes(term)) {
        score += 1;
        matchedTerms.push(term);
      }
    }
  }

  // Boost score for heading matches
  const headingLower = section.heading.toLowerCase();
  for (const term of searchTerms) {
    if (headingLower.includes(term)) {
      score += 3;
    }
  }

  // Calculate confidence based on match density
  const normalizedScore = Math.min(score / (searchTerms.length * 3), 1);
  let confidence: SearchConfidence = "low";
  if (normalizedScore > 0.7) confidence = "high";
  else if (normalizedScore > 0.3) confidence = "medium";

  return {
    score: normalizedScore,
    matchedTerms: [...new Set(matchedTerms)],
    confidence,
  };
}

// ============================================
// POST /api/contracts/advanced-search - Advanced contract search
// ============================================
contractsRouter.post(
  "/advanced-search",
  zValidator("json", advancedContractSearchRequestSchema),
  async (c) => {
    const user = c.get("user");
    if (!user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const { query, documentIds, documentTypes, categories, matchType = "fuzzy", limit = 20, offset = 0 } = c.req.valid("json");
    console.log(`🔍 [Contracts] Advanced search for: "${query}"`);

    try {
      // Get user's active documents
      const whereClause: any = {
        userId: user.id,
        isActive: true,
      };

      if (documentIds && documentIds.length > 0) {
        whereClause.id = { in: documentIds };
      }

      if (documentTypes && documentTypes.length > 0) {
        whereClause.documentType = { in: documentTypes };
      }

      const documents = await db.contractDocument.findMany({
        where: whereClause,
        include: {
          sections: true,
        },
      });

      if (documents.length === 0) {
        return c.json({
          results: [],
          totalCount: 0,
          query,
          disclaimer: DISCLAIMER_TEXT,
        } satisfies AdvancedContractSearchResponse);
      }

      // Expand search terms with airline terminology
      const searchTerms = expandSearchTerms(query);
      console.log(`🔍 [Contracts] Expanded terms: ${searchTerms.join(", ")}`);

      // Collect all results
      const allResults: ContractSearchResult[] = [];

      for (const doc of documents) {
        for (const section of doc.sections ?? []) {
          // Infer category from content
          const sectionCategory = inferCategory(section.heading + " " + section.content);

          // Filter by category if specified
          if (categories && categories.length > 0 && sectionCategory) {
            if (!categories.includes(sectionCategory as any)) {
              continue;
            }
          }

          const { score, matchedTerms, confidence } = calculateAdvancedRelevance(
            section,
            searchTerms,
            matchType
          );

          if (score > 0.1 || matchedTerms.length > 0) {
            const excerpt = createSnippet(section.content, matchedTerms);
            const highlightedExcerpt = highlightMatches(excerpt, matchedTerms.join(" "));

            allResults.push({
              id: `${section.id}-${randomUUID().slice(0, 8)}`,
              sectionId: section.id,
              documentId: doc.id,
              documentTitle: doc.title,
              documentType: doc.documentType as any,
              heading: section.heading,
              sectionNumber: section.sectionNumber,
              pageNumber: section.pageNumber,
              excerpt,
              highlightedExcerpt,
              confidence,
              relevanceScore: score,
              matchedTerms,
            });
          }
        }
      }

      // Sort by relevance
      allResults.sort((a, b) => b.relevanceScore - a.relevanceScore);

      // Paginate
      const paginatedResults = allResults.slice(offset, offset + limit);

      // Generate suggested keywords from terminology pack
      const suggestedKeywords: string[] = [];
      for (const [canonical, synonyms] of Object.entries(AIRLINE_TERMINOLOGY)) {
        if (query.toLowerCase().includes(canonical.toLowerCase()) ||
            synonyms.some(s => query.toLowerCase().includes(s.toLowerCase()))) {
          // Add related terms user might not have searched
          suggestedKeywords.push(...synonyms.slice(0, 2).filter(s => !query.toLowerCase().includes(s.toLowerCase())));
        }
      }

      return c.json({
        results: paginatedResults,
        totalCount: allResults.length,
        query,
        suggestedKeywords: [...new Set(suggestedKeywords)].slice(0, 6),
        disclaimer: DISCLAIMER_TEXT,
      } satisfies AdvancedContractSearchResponse);
    } catch (error) {
      console.error("💥 [Contracts] Advanced search error:", error);
      return c.json({ error: "Failed to search contracts" }, 500);
    }
  }
);

// ============================================
// POST /api/contracts/ai-suggest-keywords - AI keyword suggestions
// ============================================
contractsRouter.post(
  "/ai-suggest-keywords",
  zValidator("json", aiSuggestKeywordsRequestSchema),
  async (c) => {
    const user = c.get("user");
    if (!user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const { query, context } = c.req.valid("json");
    console.log(`🤖 [Contracts] AI suggest keywords for: "${query}"`);

    try {
      const queryLower = query.toLowerCase();
      const suggestedKeywords: string[] = [];
      const suggestedDocTypes: Set<string> = new Set();
      const suggestedCategories: Set<string> = new Set();

      // Find matching terminology and suggest related terms
      for (const [canonical, synonyms] of Object.entries(AIRLINE_TERMINOLOGY)) {
        const allTerms = [canonical, ...synonyms];
        const matchedTerm = allTerms.find(t => queryLower.includes(t.toLowerCase()));

        if (matchedTerm) {
          // Add canonical term if not already in query
          if (!queryLower.includes(canonical.toLowerCase())) {
            suggestedKeywords.push(canonical);
          }

          // Add some synonyms user hasn't used
          const unusedSynonyms = synonyms.filter(s => !queryLower.includes(s.toLowerCase()));
          suggestedKeywords.push(...unusedSynonyms.slice(0, 2));
        }
      }

      // Suggest related terms based on context
      if (context) {
        const contextLower = context.toLowerCase();

        // Infer likely categories
        for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
          if (keywords.some(k => contextLower.includes(k) || queryLower.includes(k))) {
            suggestedCategories.add(category);
          }
        }

        // Infer document types
        if (contextLower.includes("pay") || contextLower.includes("credit") || contextLower.includes("premium")) {
          suggestedDocTypes.add("CBA");
          suggestedDocTypes.add("PAY_MANUAL");
        }
        if (contextLower.includes("agreement") || contextLower.includes("contract")) {
          suggestedDocTypes.add("CBA");
          suggestedDocTypes.add("LOA");
        }
      }

      // Suggest common expansions
      if (queryLower.includes("ja") || queryLower.includes("junior")) {
        suggestedKeywords.push("junior assignment", "draft", "assignment premium");
      }
      if (queryLower.includes("reserve") || queryLower.includes("standby")) {
        suggestedKeywords.push("short call", "long call", "airport reserve");
      }

      return c.json({
        suggestedKeywords: [...new Set(suggestedKeywords)].slice(0, 6),
        suggestedFilters: {
          documentTypes: suggestedDocTypes.size > 0 ? Array.from(suggestedDocTypes) as any : undefined,
          categories: suggestedCategories.size > 0 ? Array.from(suggestedCategories) as any : undefined,
        },
        explanation: suggestedKeywords.length > 0
          ? `Try these keywords: ${suggestedKeywords.slice(0, 3).join(", ")}`
          : "Try adding more specific terms related to your search.",
      } satisfies AiSuggestKeywordsResponse);
    } catch (error) {
      console.error("💥 [Contracts] AI suggest error:", error);
      return c.json({ error: "Failed to generate suggestions" }, 500);
    }
  }
);

// ============================================
// POST /api/contracts/saved-references - Save a reference
// ============================================
contractsRouter.post(
  "/saved-references",
  zValidator("json", saveContractReferenceRequestSchema),
  async (c) => {
    const user = c.get("user");
    if (!user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const data = c.req.valid("json");
    console.log(`💾 [Contracts] Saving reference for user: ${user.id}`);

    try {
      // Check if already saved (upsert behavior)
      const existing = await db.savedContractReference.findUnique({
        where: {
          userId_sectionId: {
            userId: user.id,
            sectionId: data.sectionId,
          },
        },
      });

      let reference;
      if (existing) {
        reference = await db.savedContractReference.update({
          where: { id: existing.id },
          data: {
            userNotes: data.userNotes ?? existing.userNotes,
            category: data.category ?? existing.category,
          },
        });
      } else {
        reference = await db.savedContractReference.create({
          data: {
            userId: user.id,
            sectionId: data.sectionId,
            documentId: data.documentId,
            documentTitle: data.documentTitle,
            sectionHeading: data.sectionHeading,
            sectionNumber: data.sectionNumber ?? null,
            pageNumber: data.pageNumber ?? null,
            excerpt: data.excerpt,
            category: data.category ?? null,
            userNotes: data.userNotes ?? null,
          },
        });
      }

      return c.json({
        success: true,
        reference: {
          ...reference,
          category: reference.category as "pay" | "scheduling" | "reserve" | "training" | "deadhead" | "other" | null,
          createdAt: reference.createdAt.toISOString(),
          updatedAt: reference.updatedAt.toISOString(),
        },
      } satisfies SaveContractReferenceResponse);
    } catch (error) {
      console.error("💥 [Contracts] Save reference error:", error);
      return c.json({ error: "Failed to save reference" }, 500);
    }
  }
);

// ============================================
// DELETE /api/contracts/saved-references/:id - Delete saved reference
// ============================================
contractsRouter.delete("/saved-references/:id", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const { id } = c.req.param();
  console.log(`🗑️ [Contracts] Deleting saved reference: ${id}`);

  try {
    const existing = await db.savedContractReference.findFirst({
      where: { id, userId: user.id },
    });

    if (!existing) {
      return c.json({ error: "Reference not found" }, 404);
    }

    await db.savedContractReference.delete({ where: { id } });

    return c.json({ success: true } satisfies DeleteSavedReferenceResponse);
  } catch (error) {
    console.error("💥 [Contracts] Delete saved reference error:", error);
    return c.json({ error: "Failed to delete reference" }, 500);
  }
});

export { contractsRouter };
