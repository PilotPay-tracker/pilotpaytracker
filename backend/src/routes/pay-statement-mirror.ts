/**
 * Pay Statement Mirror Routes
 *
 * API endpoints for pay statement upload, parsing, projection,
 * reconciliation, and audit features.
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { type AppType } from "../types";
import { db } from "../db";
import {
  payStatementMirrorService,
  parsePayStatementMock,
  buildTemplate,
} from "../services/pay-statement-mirror";
import {
  uploadPayStatementRequestSchema,
  recalculateProjectedRequestSchema,
  exportPacketRequestSchema,
  type PayStatementParsed,
} from "@/shared/contracts";
import { getPayPeriodForDate, PAY_PERIODS_2026 } from "../lib/constants";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

const payStatementMirrorRouter = new Hono<AppType>();

// Uploads directory for pay statements
const STATEMENTS_DIR = path.join(process.cwd(), "uploads", "statements");
if (!fs.existsSync(STATEMENTS_DIR)) {
  fs.mkdirSync(STATEMENTS_DIR, { recursive: true });
}

// ============================================
// HELPER: Get pay period info
// ============================================
function findPayPeriod(payPeriodId: string) {
  // payPeriodId format: "2026-1" to "2026-13"
  const [yearStr, periodStr] = payPeriodId.split("-");
  const year = parseInt(yearStr ?? "2026", 10);
  const periodNumber = parseInt(periodStr ?? "1", 10);

  const period = PAY_PERIODS_2026.find(
    (p) => p.year === year && p.periodNumber === periodNumber && p.payType === "standard"
  );

  return period ?? null;
}

// ============================================
// POST /api/pay-statements/upload - Upload a pay statement
// ============================================
payStatementMirrorRouter.post("/upload", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  try {
    const formData = await c.req.formData();
    const file = formData.get("file") as File | null;
    const source = (formData.get("source") as string) ?? "image";
    const payPeriodStart = formData.get("payPeriodStart") as string | null;
    const payPeriodEnd = formData.get("payPeriodEnd") as string | null;

    if (!file) {
      return c.json({ error: "No file provided" }, 400);
    }

    // Validate file type
    const allowedTypes = [
      "application/pdf",
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/gif",
      "image/webp",
    ];
    if (!allowedTypes.includes(file.type)) {
      return c.json({ error: "Invalid file type. Only PDF and image files are allowed." }, 400);
    }

    // Validate file size (20MB limit for statements)
    const maxSize = 20 * 1024 * 1024;
    if (file.size > maxSize) {
      return c.json({ error: "File too large. Maximum size is 20MB." }, 400);
    }

    // Save file
    const ext = path.extname(file.name) || (file.type.includes("pdf") ? ".pdf" : ".jpg");
    const filename = `${randomUUID()}${ext}`;
    const filePath = path.join(STATEMENTS_DIR, filename);
    const arrayBuffer = await file.arrayBuffer();
    fs.writeFileSync(filePath, Buffer.from(arrayBuffer));

    const fileUrl = `/uploads/statements/${filename}`;

    // Create upload record
    const upload = await db.payStatementUpload.create({
      data: {
        userId: user.id,
        source: source === "pdf" ? "pdf" : "image",
        fileUrl,
        mimeType: file.type,
        status: "queued",
        extractedPeriodStart: payPeriodStart,
        extractedPeriodEnd: payPeriodEnd,
      },
    });

    console.log(`📤 [PayStatement] Upload created: ${upload.id}`);

    return c.json({
      success: true,
      uploadId: upload.id,
    });
  } catch (error) {
    console.error("💥 [PayStatement] Upload error:", error);
    return c.json({ error: "Failed to upload pay statement" }, 500);
  }
});

// ============================================
// POST /api/pay-statements/:uploadId/parse - Parse uploaded statement
// ============================================
payStatementMirrorRouter.post("/:uploadId/parse", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const uploadId = c.req.param("uploadId");

  try {
    // Get upload record
    const upload = await db.payStatementUpload.findFirst({
      where: { id: uploadId, userId: user.id },
    });

    if (!upload) {
      return c.json({ error: "Upload not found" }, 404);
    }

    // Update status
    await db.payStatementUpload.update({
      where: { id: uploadId },
      data: { status: "processing" },
    });

    // Get pay period from upload or detect from current date
    let payPeriodStart = upload.extractedPeriodStart;
    let payPeriodEnd = upload.extractedPeriodEnd;

    if (!payPeriodStart || !payPeriodEnd) {
      const today = new Date().toISOString().split("T")[0] ?? "";
      const currentPeriod = getPayPeriodForDate(today);
      if (currentPeriod) {
        payPeriodStart = currentPeriod.startDate;
        payPeriodEnd = currentPeriod.endDate;
      }
    }

    if (!payPeriodStart || !payPeriodEnd) {
      await db.payStatementUpload.update({
        where: { id: uploadId },
        data: { status: "failed", error: "Could not determine pay period" },
      });
      return c.json({ error: "Could not determine pay period" }, 400);
    }

    // Parse statement (mock for now - replace with real OCR)
    // In production, this would read the file and use OCR
    const parsed = await parsePayStatementMock(user.id, payPeriodStart, payPeriodEnd);

    // Get or create template
    const profile = await db.profile.findUnique({ where: { userId: user.id } });

    let template = await db.statementTemplate.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });

    if (!template) {
      const templateData = buildTemplate({
        userId: user.id,
        airlineId: profile?.airline,
        parsed,
      });

      template = await db.statementTemplate.create({
        data: {
          userId: templateData.userId,
          airlineId: templateData.airlineId,
          version: templateData.version,
          sectionOrder: JSON.stringify(templateData.sectionOrder),
          sectionHeaders: JSON.stringify(templateData.sectionHeaders),
          lineItemOrderingHints: templateData.lineItemOrderingHints
            ? JSON.stringify(templateData.lineItemOrderingHints)
            : null,
          normalizationRules: templateData.normalizationRules
            ? JSON.stringify(templateData.normalizationRules)
            : null,
        },
      });
    }

    // Update upload record
    await db.payStatementUpload.update({
      where: { id: uploadId },
      data: {
        status: "parsed",
        parsedData: JSON.stringify(parsed),
        extractedPeriodStart: payPeriodStart,
        extractedPeriodEnd: payPeriodEnd,
        extractedPayDate: parsed.payPeriod?.payDate,
      },
    });

    // Find corresponding pay period ID
    const period = PAY_PERIODS_2026.find(
      (p) => p.startDate === payPeriodStart && p.endDate === payPeriodEnd
    );
    const payPeriodId = period ? `${period.year}-${period.periodNumber}` : null;

    // Store as actual statement if we have a pay period
    if (payPeriodId) {
      await payStatementMirrorService.storeActualStatement(
        user.id,
        payPeriodId,
        parsed,
        uploadId
      );
    }

    console.log(`✅ [PayStatement] Parse complete: ${uploadId}`);

    return c.json({
      success: true,
      parsed,
      templateId: template.id,
    });
  } catch (error) {
    console.error("💥 [PayStatement] Parse error:", error);

    await db.payStatementUpload.update({
      where: { id: uploadId },
      data: { status: "failed", error: String(error) },
    });

    return c.json({ error: "Failed to parse pay statement" }, 500);
  }
});

// ============================================
// GET /api/pay-periods/:payPeriodId/actual-statement
// ============================================
payStatementMirrorRouter.get("/pay-periods/:payPeriodId/actual-statement", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const payPeriodId = c.req.param("payPeriodId");

  try {
    const actual = await db.actualStatement.findUnique({
      where: { userId_payPeriodId: { userId: user.id, payPeriodId } },
    });

    if (!actual) {
      return c.json({ parsed: null });
    }

    const parsed: PayStatementParsed = JSON.parse(actual.parsedData);

    return c.json({ parsed });
  } catch (error) {
    console.error("💥 [PayStatement] Get actual error:", error);
    return c.json({ error: "Failed to get actual statement" }, 500);
  }
});

// ============================================
// GET /api/pay-periods/:payPeriodId/projected-statement
// ============================================
payStatementMirrorRouter.get("/pay-periods/:payPeriodId/projected-statement", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const payPeriodId = c.req.param("payPeriodId");

  try {
    const period = findPayPeriod(payPeriodId);
    if (!period) {
      return c.json({ error: "Pay period not found" }, 404);
    }

    const projected = await payStatementMirrorService.getProjected(
      user.id,
      payPeriodId,
      period.startDate,
      period.endDate,
      period.payDate
    );

    return c.json({ projected });
  } catch (error) {
    console.error("💥 [PayStatement] Get projected error:", error);
    return c.json({ error: "Failed to get projected statement" }, 500);
  }
});

// ============================================
// POST /api/pay-periods/:payPeriodId/projected-statement/recalculate
// ============================================
payStatementMirrorRouter.post(
  "/pay-periods/:payPeriodId/projected-statement/recalculate",
  zValidator("json", recalculateProjectedRequestSchema),
  async (c) => {
    const user = c.get("user");
    if (!user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const payPeriodId = c.req.param("payPeriodId");
    const { reason } = c.req.valid("json");

    try {
      const period = findPayPeriod(payPeriodId);
      if (!period) {
        return c.json({ error: "Pay period not found" }, 404);
      }

      const result = await payStatementMirrorService.recalcAndDiff(
        user.id,
        payPeriodId,
        period.startDate,
        period.endDate,
        period.payDate,
        reason
      );

      return c.json(result);
    } catch (error) {
      console.error("💥 [PayStatement] Recalc error:", error);
      return c.json({ error: "Failed to recalculate projected statement" }, 500);
    }
  }
);

// ============================================
// POST /api/pay-periods/:payPeriodId/reconciliation/run
// ============================================
payStatementMirrorRouter.post("/pay-periods/:payPeriodId/reconciliation/run", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const payPeriodId = c.req.param("payPeriodId");

  try {
    const period = findPayPeriod(payPeriodId);
    if (!period) {
      return c.json({ error: "Pay period not found" }, 404);
    }

    const reconciliation = await payStatementMirrorService.runReconciliation(
      user.id,
      payPeriodId,
      period.startDate,
      period.endDate,
      period.payDate
    );

    return c.json({ reconciliation });
  } catch (error) {
    console.error("💥 [PayStatement] Reconciliation error:", error);
    const message = error instanceof Error ? error.message : "Failed to run reconciliation";
    return c.json({ error: message }, 500);
  }
});

// ============================================
// POST /api/pay-periods/:payPeriodId/audit/run
// ============================================
payStatementMirrorRouter.post("/pay-periods/:payPeriodId/audit/run", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const payPeriodId = c.req.param("payPeriodId");

  try {
    const period = findPayPeriod(payPeriodId);
    if (!period) {
      return c.json({ error: "Pay period not found" }, 404);
    }

    const audit = await payStatementMirrorService.runAudit(
      user.id,
      payPeriodId,
      period.startDate,
      period.endDate,
      period.payDate
    );

    return c.json({ audit });
  } catch (error) {
    console.error("💥 [PayStatement] Audit error:", error);
    return c.json({ error: "Failed to run audit" }, 500);
  }
});

// ============================================
// POST /api/pay-periods/:payPeriodId/export
// ============================================
payStatementMirrorRouter.post(
  "/pay-periods/:payPeriodId/export",
  zValidator("json", exportPacketRequestSchema),
  async (c) => {
    const user = c.get("user");
    if (!user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const payPeriodId = c.req.param("payPeriodId");
    const body = c.req.valid("json");

    try {
      const period = findPayPeriod(payPeriodId);
      if (!period) {
        return c.json({ error: "Pay period not found" }, 404);
      }

      // Create export packet record
      const packet = await db.exportPacket.create({
        data: {
          userId: user.id,
          payPeriodId,
          status: "queued",
          includeConfig: JSON.stringify(body.include),
        },
      });

      // For now, just return queued status
      // In production, this would queue a background job
      return c.json({
        packetId: packet.id,
        status: packet.status,
      });
    } catch (error) {
      console.error("💥 [PayStatement] Export error:", error);
      return c.json({ error: "Failed to create export packet" }, 500);
    }
  }
);

// ============================================
// GET /api/exports/:packetId/status
// ============================================
payStatementMirrorRouter.get("/exports/:packetId/status", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const packetId = c.req.param("packetId");

  try {
    const packet = await db.exportPacket.findFirst({
      where: { id: packetId, userId: user.id },
    });

    if (!packet) {
      return c.json({ error: "Export packet not found" }, 404);
    }

    return c.json({
      packetId: packet.id,
      status: packet.status,
      downloadUrl: packet.downloadUrl,
      error: packet.error,
    });
  } catch (error) {
    console.error("💥 [PayStatement] Export status error:", error);
    return c.json({ error: "Failed to get export status" }, 500);
  }
});

export { payStatementMirrorRouter };
