/**
 * AI Feedback & Learning Routes
 *
 * Collects user feedback to improve AI parsing, suggestions, and explanations.
 * This data feeds back into improving the AI's accuracy over time.
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "../db";
import { type AppType } from "../types";

const feedbackRouter = new Hono<AppType>();

// ============================================
// Schema Definitions
// ============================================

const parsingFeedbackSchema = z.object({
  entityType: z.enum(["trip", "leg", "duty_day", "hotel", "transport"]),
  entityId: z.string(),
  fieldName: z.string(),
  originalValue: z.string().optional(),
  correctedValue: z.string().optional(),
  aiConfidence: z.number().min(0).max(1).optional(),
  sourceType: z.enum(["ocr", "ai_vision", "manual"]).optional(),
  imageHash: z.string().optional(),
});

const suggestionOutcomeSchema = z.object({
  suggestionType: z.enum(["premium_event", "contract_reference", "hotel", "pay_rule"]),
  suggestionId: z.string(),
  action: z.enum(["accepted", "dismissed", "modified", "ignored"]),
  dismissReason: z.enum(["already_claimed", "incorrect", "not_applicable", "timing_issue", "other"]).optional(),
  dismissNotes: z.string().optional(),
  aiConfidence: z.number().min(0).max(1).optional(),
  userConfidence: z.number().min(1).max(5).optional(),
});

const suggestionValidationSchema = z.object({
  outcomeId: z.string(),
  wasAccurate: z.boolean(),
  outcomeNotes: z.string().optional(),
});

const explanationFeedbackSchema = z.object({
  explanationType: z.enum(["pay_statement", "contract_reference", "roster_change", "pay_rule"]),
  entityId: z.string(),
  wasHelpful: z.boolean(),
  clarityRating: z.number().min(1).max(5).optional(),
  feedbackText: z.string().optional(),
  confusingParts: z.array(z.string()).optional(),
});

// ============================================
// PARSING FEEDBACK - Track AI corrections
// ============================================

/**
 * POST /api/feedback/parsing
 * Record when a user corrects AI-parsed data
 */
feedbackRouter.post(
  "/parsing",
  zValidator("json", parsingFeedbackSchema),
  async (c) => {
    const user = c.get("user");
    if (!user?.id) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const data = c.req.valid("json");

    try {
      const feedback = await db.aIParsingFeedback.create({
        data: {
          userId: user.id,
          entityType: data.entityType,
          entityId: data.entityId,
          fieldName: data.fieldName,
          originalValue: data.originalValue,
          correctedValue: data.correctedValue,
          aiConfidence: data.aiConfidence,
          sourceType: data.sourceType,
          imageHash: data.imageHash,
        },
      });

      console.log(`📝 [Feedback] Parsing correction recorded: ${data.entityType}.${data.fieldName}`);

      return c.json({
        success: true,
        feedbackId: feedback.id,
        message: "Thanks for the correction! This helps improve accuracy.",
      });
    } catch (error) {
      console.error("[Feedback] Failed to record parsing feedback:", error);
      return c.json({ error: "Failed to record feedback" }, 500);
    }
  }
);

// ============================================
// SUGGESTION OUTCOMES - Track acceptance/rejection
// ============================================

/**
 * POST /api/feedback/suggestion
 * Record user action on a suggestion (accept, dismiss, modify)
 */
feedbackRouter.post(
  "/suggestion",
  zValidator("json", suggestionOutcomeSchema),
  async (c) => {
    const user = c.get("user");
    if (!user?.id) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const data = c.req.valid("json");

    try {
      const outcome = await db.suggestionOutcome.create({
        data: {
          userId: user.id,
          suggestionType: data.suggestionType,
          suggestionId: data.suggestionId,
          action: data.action,
          dismissReason: data.dismissReason,
          dismissNotes: data.dismissNotes,
          aiConfidence: data.aiConfidence,
          userConfidence: data.userConfidence,
        },
      });

      console.log(`📝 [Feedback] Suggestion outcome: ${data.suggestionType} -> ${data.action}`);

      return c.json({
        success: true,
        outcomeId: outcome.id,
      });
    } catch (error) {
      console.error("[Feedback] Failed to record suggestion outcome:", error);
      return c.json({ error: "Failed to record feedback" }, 500);
    }
  }
);

/**
 * POST /api/feedback/suggestion/validate
 * Validate a previous suggestion outcome (was it actually accurate?)
 */
feedbackRouter.post(
  "/suggestion/validate",
  zValidator("json", suggestionValidationSchema),
  async (c) => {
    const user = c.get("user");
    if (!user?.id) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const data = c.req.valid("json");

    try {
      const outcome = await db.suggestionOutcome.update({
        where: { id: data.outcomeId, userId: user.id },
        data: {
          wasAccurate: data.wasAccurate,
          outcomeNotes: data.outcomeNotes,
          validatedAt: new Date(),
        },
      });

      console.log(`📝 [Feedback] Suggestion validated: ${outcome.id} -> ${data.wasAccurate ? 'accurate' : 'inaccurate'}`);

      return c.json({
        success: true,
        message: "Thanks for validating! This improves future suggestions.",
      });
    } catch (error) {
      console.error("[Feedback] Failed to validate suggestion:", error);
      return c.json({ error: "Failed to validate" }, 500);
    }
  }
);

// ============================================
// EXPLANATION FEEDBACK - Track helpfulness
// ============================================

/**
 * POST /api/feedback/explanation
 * Record if an AI explanation was helpful
 */
feedbackRouter.post(
  "/explanation",
  zValidator("json", explanationFeedbackSchema),
  async (c) => {
    const user = c.get("user");
    if (!user?.id) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const data = c.req.valid("json");

    try {
      const feedback = await db.explanationFeedback.create({
        data: {
          userId: user.id,
          explanationType: data.explanationType,
          entityId: data.entityId,
          wasHelpful: data.wasHelpful,
          clarityRating: data.clarityRating,
          feedbackText: data.feedbackText,
          confusingParts: data.confusingParts ? JSON.stringify(data.confusingParts) : null,
        },
      });

      console.log(`📝 [Feedback] Explanation feedback: ${data.explanationType} -> ${data.wasHelpful ? 'helpful' : 'not helpful'}`);

      return c.json({
        success: true,
        feedbackId: feedback.id,
        message: data.wasHelpful
          ? "Glad it helped!"
          : "Thanks for letting us know. We'll work on improving this.",
      });
    } catch (error) {
      console.error("[Feedback] Failed to record explanation feedback:", error);
      return c.json({ error: "Failed to record feedback" }, 500);
    }
  }
);

// ============================================
// ANALYTICS - Get learning metrics
// ============================================

/**
 * GET /api/feedback/metrics
 * Get aggregated AI learning metrics (for admin/debugging)
 */
feedbackRouter.get("/metrics", async (c) => {
  const user = c.get("user");
  if (!user?.id) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  try {
    // Get parsing accuracy by field
    const parsingStats = await db.aIParsingFeedback.groupBy({
      by: ["fieldName"],
      _count: { id: true },
      _avg: { aiConfidence: true },
    });

    // Get suggestion acceptance rates
    const suggestionStats = await db.suggestionOutcome.groupBy({
      by: ["suggestionType", "action"],
      _count: { id: true },
    });

    // Get explanation helpfulness
    const explanationStats = await db.explanationFeedback.groupBy({
      by: ["explanationType", "wasHelpful"],
      _count: { id: true },
      _avg: { clarityRating: true },
    });

    // Calculate summary metrics
    const totalCorrections = parsingStats.reduce((sum, s) => sum + s._count.id, 0);
    const totalSuggestions = suggestionStats.reduce((sum, s) => sum + s._count.id, 0);
    const totalExplanations = explanationStats.reduce((sum, s) => sum + s._count.id, 0);

    // Find most corrected fields
    const topCorrectedFields = parsingStats
      .sort((a, b) => b._count.id - a._count.id)
      .slice(0, 5)
      .map(s => ({
        field: s.fieldName,
        corrections: s._count.id,
        avgConfidence: s._avg.aiConfidence,
      }));

    // Calculate acceptance rate by type
    const acceptanceByType: Record<string, { accepted: number; dismissed: number; rate: number }> = {};
    for (const stat of suggestionStats) {
      const typeKey = stat.suggestionType;
      if (!acceptanceByType[typeKey]) {
        acceptanceByType[typeKey] = { accepted: 0, dismissed: 0, rate: 0 };
      }
      const bucket = acceptanceByType[typeKey]!;
      if (stat.action === "accepted") {
        bucket.accepted += stat._count.id;
      } else if (stat.action === "dismissed") {
        bucket.dismissed += stat._count.id;
      }
    }
    for (const type of Object.keys(acceptanceByType)) {
      const bucket = acceptanceByType[type]!;
      const total = bucket.accepted + bucket.dismissed;
      bucket.rate = total > 0 ? bucket.accepted / total : 0;
    }

    // Calculate helpfulness rate
    const helpfulnessStats: Record<string, { helpful: number; notHelpful: number; rate: number }> = {};
    for (const stat of explanationStats) {
      const typeKey = stat.explanationType;
      if (!helpfulnessStats[typeKey]) {
        helpfulnessStats[typeKey] = { helpful: 0, notHelpful: 0, rate: 0 };
      }
      const bucket = helpfulnessStats[typeKey]!;
      if (stat.wasHelpful) {
        bucket.helpful += stat._count.id;
      } else {
        bucket.notHelpful += stat._count.id;
      }
    }
    for (const type of Object.keys(helpfulnessStats)) {
      const bucket = helpfulnessStats[type]!;
      const total = bucket.helpful + bucket.notHelpful;
      bucket.rate = total > 0 ? bucket.helpful / total : 0;
    }

    return c.json({
      summary: {
        totalCorrections,
        totalSuggestions,
        totalExplanations,
      },
      parsing: {
        topCorrectedFields,
        totalFields: parsingStats.length,
      },
      suggestions: {
        acceptanceByType,
      },
      explanations: {
        helpfulnessStats,
      },
    });
  } catch (error) {
    console.error("[Feedback] Failed to get metrics:", error);
    return c.json({ error: "Failed to get metrics" }, 500);
  }
});

/**
 * POST /api/feedback/compute-insights
 * Compute and store learning insights (run periodically)
 */
feedbackRouter.post("/compute-insights", async (c) => {
  const user = c.get("user");
  if (!user?.id) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  try {
    const now = new Date();
    const periodStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // Last 7 days

    // Compute parsing accuracy metrics
    const parsingFeedback = await db.aIParsingFeedback.findMany({
      where: { createdAt: { gte: periodStart } },
    });

    const fieldStats: Record<string, { total: number; lowConfidence: number }> = {};
    for (const fb of parsingFeedback) {
      const fieldKey = fb.fieldName;
      if (!fieldStats[fieldKey]) {
        fieldStats[fieldKey] = { total: 0, lowConfidence: 0 };
      }
      const bucket = fieldStats[fieldKey]!;
      bucket.total++;
      if (fb.aiConfidence && fb.aiConfidence < 0.7) {
        bucket.lowConfidence++;
      }
    }

    // Store insights for most problematic fields
    const topIssues = Object.entries(fieldStats)
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 10)
      .map(([field, stats]) => ({
        issue: `Field "${field}" frequently corrected`,
        count: stats.total,
        lowConfidenceRate: stats.total > 0 ? stats.lowConfidence / stats.total : 0,
      }));

    // Upsert the learning metrics
    await db.aILearningMetrics.upsert({
      where: {
        metricType_category_periodStart: {
          metricType: "parsing_accuracy",
          category: "all_fields",
          periodStart,
        },
      },
      create: {
        metricType: "parsing_accuracy",
        category: "all_fields",
        totalCount: parsingFeedback.length,
        successCount: 0, // Would need original data to calculate
        successRate: 0,
        periodStart,
        periodEnd: now,
        topIssues: JSON.stringify(topIssues),
        recommendations: JSON.stringify([
          "Review OCR preprocessing for frequently corrected fields",
          "Consider adding validation rules for high-error fields",
          "Flag low-confidence extractions for user review",
        ]),
      },
      update: {
        totalCount: parsingFeedback.length,
        periodEnd: now,
        topIssues: JSON.stringify(topIssues),
        updatedAt: now,
      },
    });

    console.log(`📊 [Feedback] Computed insights for ${parsingFeedback.length} parsing corrections`);

    return c.json({
      success: true,
      message: "Insights computed successfully",
      period: { start: periodStart, end: now },
      feedbackCount: parsingFeedback.length,
      topIssues,
    });
  } catch (error) {
    console.error("[Feedback] Failed to compute insights:", error);
    return c.json({ error: "Failed to compute insights" }, 500);
  }
});

export { feedbackRouter };
