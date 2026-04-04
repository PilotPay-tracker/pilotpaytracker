/**
 * Late Arrival Pay (LAP) Routes
 *
 * UPS Premium Code for delays exceeding 4 hours.
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { type AppType } from "../types";
import { db } from "../db";
import { calculateLap, type LegData } from "../lib/lap-calculator";
import {
  createLapEntryRequestSchema,
  updateLapEntryRequestSchema,
  uploadLapProofRequestSchema,
  calculateLapRequestSchema,
} from "@/shared/contracts";

const lapRouter = new Hono<AppType>();

// ============================================
// GET /api/lap - List LAP entries
// ============================================
lapRouter.get("/", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const tripId = c.req.query("tripId");
  const startDate = c.req.query("startDate");
  const endDate = c.req.query("endDate");
  const status = c.req.query("status");

  const entries = await db.lapEntry.findMany({
    where: {
      userId: user.id,
      ...(tripId ? { tripId } : {}),
      ...(startDate && endDate
        ? { tripDate: { gte: startDate, lte: endDate } }
        : {}),
      ...(status ? { status } : {}),
    },
    include: {
      proofAttachments: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return c.json({
    entries: entries.map(serializeLapEntry),
    totalCount: entries.length,
  });
});

// ============================================
// GET /api/lap/:id - Get single LAP entry
// ============================================
lapRouter.get("/:id", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const id = c.req.param("id");

  const entry = await db.lapEntry.findFirst({
    where: { id, userId: user.id },
    include: { proofAttachments: true },
  });

  if (!entry) {
    return c.json({ error: "LAP entry not found" }, 404);
  }

  return c.json({ entry: serializeLapEntry(entry) });
});

// ============================================
// POST /api/lap - Create LAP entry
// ============================================
lapRouter.post("/", zValidator("json", createLapEntryRequestSchema), async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const body = c.req.valid("json");

  // Get user's hourly rate
  const profile = await db.profile.findUnique({
    where: { userId: user.id },
  });
  const hourlyRateCents = profile?.hourlyRateCents ?? 32500;

  // Check if LAP already exists for this trip
  const existing = await db.lapEntry.findFirst({
    where: { tripId: body.tripId, userId: user.id },
  });

  if (existing) {
    return c.json({ error: "LAP entry already exists for this trip" }, 400);
  }

  // Calculate LAP if we have the required data
  let calculationResult = null;
  if (body.originalArrivalUtc && body.actualArrivalUtc) {
    calculationResult = calculateLap({
      originalArrivalUtc: body.originalArrivalUtc,
      actualArrivalUtc: body.actualArrivalUtc,
      dutyStartUtc: body.dutyStartUtc,
      dutyEndUtc: body.dutyEndUtc,
      isWxMx: body.isWxMx ?? false,
      isEdw: body.isEdw ?? false,
      isDomicileAirportClosed: body.isDomicileAirportClosed ?? false,
      hourlyRateCents,
      legs: body.legs as LegData[],
    });
  }

  const entry = await db.lapEntry.create({
    data: {
      userId: user.id,
      tripId: body.tripId,
      tripNumber: body.tripNumber ?? null,
      tripDate: body.tripDate,
      originalArrivalUtc: body.originalArrivalUtc ?? null,
      actualArrivalUtc: body.actualArrivalUtc ?? null,
      dutyStartUtc: body.dutyStartUtc ?? null,
      dutyEndUtc: body.dutyEndUtc ?? null,
      isWxMx: body.isWxMx ?? false,
      isEdw: body.isEdw ?? false,
      isDomicileAirportClosed: body.isDomicileAirportClosed ?? false,
      pilotNotes: body.pilotNotes ?? null,
      hourlyRateCents,
      // Calculation results
      lapStartTimeUtc: calculationResult?.lapStartTimeUtc ?? null,
      lateMinutes: calculationResult?.lateMinutes ?? 0,
      legMinutesAfterLap: calculationResult?.legMinutesAfterLap ?? 0,
      dutyMinutesAfterLap: calculationResult?.dutyMinutesAfterLap ?? 0,
      tripRigCredit: calculationResult?.tripRigCredit ?? 0,
      dutyRigCredit: calculationResult?.dutyRigCredit ?? 0,
      legCredit: calculationResult?.legCredit ?? 0,
      chosenBasis: calculationResult?.chosenBasis ?? null,
      chosenCreditMinutes: calculationResult?.chosenCreditMinutes ?? 0,
      estimatedPayCents: calculationResult?.estimatedPayCents ?? 0,
      confidenceLevel: calculationResult?.confidenceLevel ?? "red",
      confidenceReason: calculationResult?.confidenceReason ?? null,
      explanationText: calculationResult?.explanationText ?? null,
    },
    include: { proofAttachments: true },
  });

  console.log(`✅ [LAP] Created entry: ${entry.id} for trip ${body.tripId}`);

  return c.json({ success: true, entry: serializeLapEntry(entry) });
});

// ============================================
// PUT /api/lap/:id - Update LAP entry
// ============================================
lapRouter.put("/:id", zValidator("json", updateLapEntryRequestSchema), async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const id = c.req.param("id");
  const body = c.req.valid("json");

  const existing = await db.lapEntry.findFirst({
    where: { id, userId: user.id },
  });

  if (!existing) {
    return c.json({ error: "LAP entry not found" }, 404);
  }

  // Get user's hourly rate
  const profile = await db.profile.findUnique({
    where: { userId: user.id },
  });
  const hourlyRateCents = profile?.hourlyRateCents ?? existing.hourlyRateCents;

  // Merge existing values with updates
  const originalArrivalUtc = body.originalArrivalUtc ?? existing.originalArrivalUtc;
  const actualArrivalUtc = body.actualArrivalUtc ?? existing.actualArrivalUtc;
  const dutyStartUtc = body.dutyStartUtc ?? existing.dutyStartUtc;
  const dutyEndUtc = body.dutyEndUtc ?? existing.dutyEndUtc;
  const isWxMx = body.isWxMx ?? existing.isWxMx;
  const isEdw = body.isEdw ?? existing.isEdw;
  const isDomicileAirportClosed = body.isDomicileAirportClosed ?? existing.isDomicileAirportClosed;

  // Recalculate if we have the required data
  let calculationResult = null;
  if (originalArrivalUtc && actualArrivalUtc) {
    calculationResult = calculateLap({
      originalArrivalUtc,
      actualArrivalUtc,
      dutyStartUtc: dutyStartUtc ?? undefined,
      dutyEndUtc: dutyEndUtc ?? undefined,
      isWxMx,
      isEdw,
      isDomicileAirportClosed,
      hourlyRateCents,
      legs: body.legs as LegData[],
    });
  }

  const entry = await db.lapEntry.update({
    where: { id },
    data: {
      originalArrivalUtc,
      actualArrivalUtc,
      dutyStartUtc,
      dutyEndUtc,
      isWxMx,
      isEdw,
      isDomicileAirportClosed,
      pilotNotes: body.pilotNotes ?? existing.pilotNotes,
      status: body.status ?? existing.status,
      hourlyRateCents,
      // Recalculation results
      lapStartTimeUtc: calculationResult?.lapStartTimeUtc ?? existing.lapStartTimeUtc,
      lateMinutes: calculationResult?.lateMinutes ?? existing.lateMinutes,
      legMinutesAfterLap: calculationResult?.legMinutesAfterLap ?? existing.legMinutesAfterLap,
      dutyMinutesAfterLap: calculationResult?.dutyMinutesAfterLap ?? existing.dutyMinutesAfterLap,
      tripRigCredit: calculationResult?.tripRigCredit ?? existing.tripRigCredit,
      dutyRigCredit: calculationResult?.dutyRigCredit ?? existing.dutyRigCredit,
      legCredit: calculationResult?.legCredit ?? existing.legCredit,
      chosenBasis: calculationResult?.chosenBasis ?? existing.chosenBasis,
      chosenCreditMinutes: calculationResult?.chosenCreditMinutes ?? existing.chosenCreditMinutes,
      estimatedPayCents: calculationResult?.estimatedPayCents ?? existing.estimatedPayCents,
      confidenceLevel: calculationResult?.confidenceLevel ?? existing.confidenceLevel,
      confidenceReason: calculationResult?.confidenceReason ?? existing.confidenceReason,
      explanationText: calculationResult?.explanationText ?? existing.explanationText,
      needsReview: false,
    },
    include: { proofAttachments: true },
  });

  console.log(`✅ [LAP] Updated entry: ${entry.id}`);

  return c.json({ success: true, entry: serializeLapEntry(entry) });
});

// ============================================
// DELETE /api/lap/:id - Delete LAP entry
// ============================================
lapRouter.delete("/:id", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const id = c.req.param("id");

  const existing = await db.lapEntry.findFirst({
    where: { id, userId: user.id },
  });

  if (!existing) {
    return c.json({ error: "LAP entry not found" }, 404);
  }

  await db.lapEntry.delete({ where: { id } });

  console.log(`✅ [LAP] Deleted entry: ${id}`);

  return c.json({ success: true });
});

// ============================================
// POST /api/lap/:id/proof - Upload proof attachment
// ============================================
lapRouter.post("/:id/proof", zValidator("json", uploadLapProofRequestSchema), async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const id = c.req.param("id");
  const body = c.req.valid("json");

  const lapEntry = await db.lapEntry.findFirst({
    where: { id, userId: user.id },
  });

  if (!lapEntry) {
    return c.json({ error: "LAP entry not found" }, 404);
  }

  const attachment = await db.lapProofAttachment.create({
    data: {
      lapEntryId: id,
      fileName: body.fileName,
      fileUrl: body.fileUrl,
      mimeType: body.mimeType,
      fileSize: body.fileSize ?? 0,
      description: body.description ?? null,
    },
  });

  console.log(`✅ [LAP] Added proof attachment: ${attachment.id} to entry ${id}`);

  return c.json({
    success: true,
    attachment: serializeLapProofAttachment(attachment),
  });
});

// ============================================
// DELETE /api/lap/:id/proof/:proofId - Delete proof attachment
// ============================================
lapRouter.delete("/:id/proof/:proofId", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const id = c.req.param("id");
  const proofId = c.req.param("proofId");

  const lapEntry = await db.lapEntry.findFirst({
    where: { id, userId: user.id },
  });

  if (!lapEntry) {
    return c.json({ error: "LAP entry not found" }, 404);
  }

  const attachment = await db.lapProofAttachment.findFirst({
    where: { id: proofId, lapEntryId: id },
  });

  if (!attachment) {
    return c.json({ error: "Proof attachment not found" }, 404);
  }

  await db.lapProofAttachment.delete({ where: { id: proofId } });

  console.log(`✅ [LAP] Deleted proof attachment: ${proofId}`);

  return c.json({ success: true });
});

// ============================================
// POST /api/lap/calculate - Calculate LAP without saving
// ============================================
lapRouter.post("/calculate", zValidator("json", calculateLapRequestSchema), async (c) => {
  const body = c.req.valid("json");

  const result = calculateLap({
    originalArrivalUtc: body.originalArrivalUtc,
    actualArrivalUtc: body.actualArrivalUtc,
    dutyStartUtc: body.dutyStartUtc,
    dutyEndUtc: body.dutyEndUtc,
    isWxMx: body.isWxMx,
    isEdw: body.isEdw,
    isDomicileAirportClosed: body.isDomicileAirportClosed,
    hourlyRateCents: body.hourlyRateCents,
    legs: body.legs as LegData[],
  });

  return c.json(result);
});

// ============================================
// POST /api/lap/:id/generate-pdf - Generate grievance PDF
// ============================================
lapRouter.post("/:id/generate-pdf", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const id = c.req.param("id");

  const entry = await db.lapEntry.findFirst({
    where: { id, userId: user.id },
    include: { proofAttachments: true },
  });

  if (!entry) {
    return c.json({ error: "LAP entry not found" }, 404);
  }

  // Get user profile for name
  const profile = await db.profile.findUnique({
    where: { userId: user.id },
  });

  // Generate PDF (we'll use a simple text-based approach for now)
  const pdfContent = generateGrievancePdfContent(entry, profile);

  // For now, we'll store the content as a text file
  // In production, you'd use a proper PDF library
  const fs = await import("fs/promises");
  const path = await import("path");

  const uploadsDir = path.join(process.cwd(), "uploads", "grievances");
  await fs.mkdir(uploadsDir, { recursive: true });

  const filename = `LAP_Grievance_${entry.tripNumber ?? entry.tripId}_${Date.now()}.txt`;
  const filepath = path.join(uploadsDir, filename);

  await fs.writeFile(filepath, pdfContent, "utf-8");

  const pdfUrl = `/uploads/grievances/${filename}`;
  const generatedAt = new Date().toISOString();

  // Update entry with PDF URL
  await db.lapEntry.update({
    where: { id },
    data: {
      grievancePdfUrl: pdfUrl,
      grievancePdfGeneratedAt: generatedAt,
    },
  });

  console.log(`✅ [LAP] Generated grievance PDF: ${filename}`);

  return c.json({
    success: true,
    pdfUrl,
    generatedAt,
  });
});

// ============================================
// POST /api/lap/:id/polish-explanation - AI polish explanation
// ============================================
lapRouter.post("/:id/polish-explanation", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const id = c.req.param("id");

  const entry = await db.lapEntry.findFirst({
    where: { id, userId: user.id },
  });

  if (!entry) {
    return c.json({ error: "LAP entry not found" }, 404);
  }

  if (!entry.explanationText) {
    return c.json({ error: "No explanation to polish" }, 400);
  }

  // For now, create a polished version without AI
  // In production, you'd call an AI service
  const polishedExplanation = polishExplanationText(entry);

  // Update entry with polished explanation
  await db.lapEntry.update({
    where: { id },
    data: { explanationPolished: polishedExplanation },
  });

  return c.json({
    success: true,
    polishedExplanation,
  });
});

// ============================================
// Helper Functions
// ============================================

function serializeLapEntry(entry: any) {
  return {
    id: entry.id,
    userId: entry.userId,
    tripId: entry.tripId,
    tripNumber: entry.tripNumber,
    tripDate: entry.tripDate,
    originalArrivalUtc: entry.originalArrivalUtc,
    actualArrivalUtc: entry.actualArrivalUtc,
    dutyStartUtc: entry.dutyStartUtc,
    dutyEndUtc: entry.dutyEndUtc,
    isWxMx: entry.isWxMx,
    isEdw: entry.isEdw,
    isDomicileAirportClosed: entry.isDomicileAirportClosed,
    lapStartTimeUtc: entry.lapStartTimeUtc,
    lateMinutes: entry.lateMinutes,
    legMinutesAfterLap: entry.legMinutesAfterLap,
    dutyMinutesAfterLap: entry.dutyMinutesAfterLap,
    tripRigCredit: entry.tripRigCredit,
    dutyRigCredit: entry.dutyRigCredit,
    legCredit: entry.legCredit,
    chosenBasis: entry.chosenBasis,
    chosenCreditMinutes: entry.chosenCreditMinutes,
    hourlyRateCents: entry.hourlyRateCents,
    estimatedPayCents: entry.estimatedPayCents,
    confidenceLevel: entry.confidenceLevel,
    confidenceReason: entry.confidenceReason,
    explanationText: entry.explanationText,
    explanationPolished: entry.explanationPolished,
    grievancePdfUrl: entry.grievancePdfUrl,
    grievancePdfGeneratedAt: entry.grievancePdfGeneratedAt,
    pilotNotes: entry.pilotNotes,
    status: entry.status,
    needsReview: entry.needsReview,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
    proofAttachments: entry.proofAttachments?.map(serializeLapProofAttachment),
  };
}

function serializeLapProofAttachment(attachment: any) {
  return {
    id: attachment.id,
    lapEntryId: attachment.lapEntryId,
    fileName: attachment.fileName,
    fileUrl: attachment.fileUrl,
    mimeType: attachment.mimeType,
    fileSize: attachment.fileSize,
    uploadedAt: attachment.uploadedAt.toISOString(),
    description: attachment.description,
  };
}

function generateGrievancePdfContent(entry: any, profile: any): string {
  const lines: string[] = [];
  const pilotName = profile ? `${profile.firstName ?? ""} ${profile.lastName ?? ""}`.trim() : "Pilot";
  const date = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  lines.push("═".repeat(60));
  lines.push("LATE ARRIVAL PAY (LAP) GRIEVANCE DOCUMENTATION");
  lines.push("═".repeat(60));
  lines.push("");
  lines.push(`Date: ${date}`);
  lines.push(`Pilot: ${pilotName}`);
  if (profile?.gemsId) lines.push(`GEMS ID: ${profile.gemsId}`);
  if (profile?.base) lines.push(`Base: ${profile.base}`);
  lines.push("");
  lines.push("─".repeat(60));
  lines.push("TRIP INFORMATION");
  lines.push("─".repeat(60));
  lines.push(`Trip Number: ${entry.tripNumber ?? "N/A"}`);
  lines.push(`Trip Date: ${entry.tripDate}`);
  lines.push("");
  lines.push("─".repeat(60));
  lines.push("ARRIVAL TIMES");
  lines.push("─".repeat(60));

  if (entry.originalArrivalUtc) {
    const orig = new Date(entry.originalArrivalUtc);
    lines.push(`Original Scheduled Arrival: ${orig.toISOString().replace("T", " ").slice(0, 19)} UTC`);
  }
  if (entry.actualArrivalUtc) {
    const actual = new Date(entry.actualArrivalUtc);
    lines.push(`Actual Arrival at Domicile: ${actual.toISOString().replace("T", " ").slice(0, 19)} UTC`);
  }

  const lateHrs = Math.floor(entry.lateMinutes / 60);
  const lateMins = entry.lateMinutes % 60;
  lines.push(`Total Delay: ${lateHrs}:${lateMins.toString().padStart(2, "0")} (${entry.lateMinutes} minutes)`);
  lines.push("");

  lines.push("─".repeat(60));
  lines.push("DELAY CLASSIFICATION");
  lines.push("─".repeat(60));
  lines.push(`Weather/Maintenance (WX/MX): ${entry.isWxMx ? "Yes" : "No"}`);
  lines.push(`Extended Duty Workday (EDW): ${entry.isEdw ? "Yes" : "No"}`);
  lines.push(`Domicile Airport Closed: ${entry.isDomicileAirportClosed ? "Yes" : "No"}`);
  lines.push("");

  if (entry.lapStartTimeUtc) {
    const lapStart = new Date(entry.lapStartTimeUtc);
    lines.push(`LAP Start Time: ${lapStart.toISOString().replace("T", " ").slice(0, 19)} UTC`);
  }
  lines.push("");

  lines.push("─".repeat(60));
  lines.push("CREDIT CALCULATION");
  lines.push("─".repeat(60));

  const formatCredit = (mins: number) => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h}:${m.toString().padStart(2, "0")}`;
  };

  lines.push(`Trip Rig Credit: ${formatCredit(entry.tripRigCredit)}`);
  lines.push(`Duty Rig Credit: ${formatCredit(entry.dutyRigCredit)}`);
  lines.push(`Leg Credit: ${formatCredit(entry.legCredit)}`);
  lines.push("");
  lines.push(`CHOSEN BASIS: ${entry.chosenBasis ?? "N/A"}`);
  lines.push(`CHOSEN CREDIT: ${formatCredit(entry.chosenCreditMinutes)}`);
  lines.push("");

  lines.push("─".repeat(60));
  lines.push("PAY CALCULATION");
  lines.push("─".repeat(60));
  const hourlyRate = entry.hourlyRateCents / 100;
  const creditHours = entry.chosenCreditMinutes / 60;
  const estPay = entry.estimatedPayCents / 100;

  lines.push(`Credit Hours: ${creditHours.toFixed(2)}`);
  lines.push(`Premium Rate: 1.5x`);
  lines.push(`Hourly Rate: $${hourlyRate.toFixed(2)}`);
  lines.push(`Formula: ${creditHours.toFixed(2)} × 1.5 × $${hourlyRate.toFixed(2)}`);
  lines.push("");
  lines.push(`ESTIMATED LAP PAY: $${estPay.toFixed(2)}`);
  lines.push("");

  if (entry.pilotNotes) {
    lines.push("─".repeat(60));
    lines.push("PILOT NOTES");
    lines.push("─".repeat(60));
    lines.push(entry.pilotNotes);
    lines.push("");
  }

  if (entry.proofAttachments && entry.proofAttachments.length > 0) {
    lines.push("─".repeat(60));
    lines.push("PROOF ATTACHMENTS");
    lines.push("─".repeat(60));
    entry.proofAttachments.forEach((att: any, i: number) => {
      lines.push(`${i + 1}. ${att.fileName}`);
      if (att.description) lines.push(`   Description: ${att.description}`);
    });
    lines.push("");
  }

  if (entry.explanationPolished) {
    lines.push("─".repeat(60));
    lines.push("GRIEVANCE SUMMARY");
    lines.push("─".repeat(60));
    lines.push(entry.explanationPolished);
    lines.push("");
  } else if (entry.explanationText) {
    lines.push("─".repeat(60));
    lines.push("CALCULATION DETAILS");
    lines.push("─".repeat(60));
    lines.push(entry.explanationText);
    lines.push("");
  }

  lines.push("═".repeat(60));
  lines.push("Generated by Pilot Pay Tracker");
  lines.push(`Confidence Level: ${entry.confidenceLevel?.toUpperCase() ?? "N/A"}`);
  if (entry.confidenceReason) lines.push(`Note: ${entry.confidenceReason}`);
  lines.push("═".repeat(60));

  return lines.join("\n");
}

function polishExplanationText(entry: any): string {
  // Create a grievance-ready paragraph from the calculation data
  const lateHrs = Math.floor(entry.lateMinutes / 60);
  const lateMins = entry.lateMinutes % 60;
  const lateTime = `${lateHrs}:${lateMins.toString().padStart(2, "0")}`;

  const creditHrs = Math.floor(entry.chosenCreditMinutes / 60);
  const creditMins = entry.chosenCreditMinutes % 60;
  const creditTime = `${creditHrs}:${creditMins.toString().padStart(2, "0")}`;

  const estPay = (entry.estimatedPayCents / 100).toFixed(2);

  let basisExplanation = "";
  switch (entry.chosenBasis) {
    case "TRIP_RIG":
      basisExplanation = "trip rig calculation (time after LAP start divided by 3.75)";
      break;
    case "DUTY_RIG":
      basisExplanation = entry.isEdw
        ? "duty rig calculation for Extended Duty Workday (duty minutes divided by 1.5)"
        : "duty rig calculation (duty minutes divided by 2.0)";
      break;
    case "LEG":
      basisExplanation = "actual leg minutes flown after LAP start time";
      break;
    default:
      basisExplanation = "applicable credit calculation";
  }

  let delayType = entry.isWxMx
    ? "weather/maintenance-related delay"
    : "operational delay";

  const paragraph = `On ${entry.tripDate}, Trip ${entry.tripNumber ?? entry.tripId} experienced a ${delayType} resulting in arrival ${lateTime} (${entry.lateMinutes} minutes) past the originally scheduled time. ` +
    `This delay exceeds the 4-hour threshold for Late Arrival Pay eligibility. ` +
    `The LAP credit of ${creditTime} (${entry.chosenCreditMinutes} minutes) was determined using the ${basisExplanation}, which provided the maximum credit among all applicable methods. ` +
    `At the premium rate of 1.5x the hourly rate, this results in estimated Late Arrival Pay of $${estPay}. ` +
    `All calculations are based on the UPS pilot contract provisions for Late Arrival Pay.`;

  return paragraph;
}

export { lapRouter };
