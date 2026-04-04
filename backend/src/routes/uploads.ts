/**
 * Uploads Routes
 *
 * API endpoints for managing schedule uploads:
 * - Check for duplicate uploads
 * - Get recent uploads
 * - Retry failed uploads
 * - Get upload details
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { type AppType } from "../types";
import {
  checkDuplicateUpload,
  getRecentUploads,
  getUploadById,
  updateUploadStatus,
  rebuildFromUploads,
} from "../lib/import-reliability";

const uploadsRouter = new Hono<AppType>();

// ============================================
// GET /api/uploads/recent - Get recent uploads
// ============================================
uploadsRouter.get("/recent", async (c) => {
  const user = c.get("user");
  if (!user?.id) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const limitParam = c.req.query("limit");
  const limit = limitParam ? parseInt(limitParam, 10) : 20;

  try {
    const result = await getRecentUploads(user.id, limit);

    return c.json({
      uploads: result.uploads.map((u) => ({
        ...u,
        uploadedAt: u.uploadedAt.toISOString(),
        processedAt: u.processedAt?.toISOString() ?? null,
      })),
      totalCount: result.totalCount,
    });
  } catch (error) {
    console.error("[Uploads] Error fetching recent uploads:", error);
    return c.json({ error: "Failed to fetch uploads" }, 500);
  }
});

// ============================================
// GET /api/uploads/:id - Get upload details
// ============================================
uploadsRouter.get("/:id", async (c) => {
  const user = c.get("user");
  if (!user?.id) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const uploadId = c.req.param("id");

  try {
    const upload = await getUploadById(uploadId, user.id);

    if (!upload) {
      return c.json({ error: "Upload not found" }, 404);
    }

    return c.json({
      upload: {
        ...upload,
        uploadedAt: upload.uploadedAt.toISOString(),
        processedAt: upload.processedAt?.toISOString() ?? null,
      },
    });
  } catch (error) {
    console.error("[Uploads] Error fetching upload:", error);
    return c.json({ error: "Failed to fetch upload" }, 500);
  }
});

// ============================================
// POST /api/uploads/check-duplicate - Check if file already uploaded
// ============================================
const checkDuplicateSchema = z.object({
  fileHash: z.string().min(1),
});

uploadsRouter.post(
  "/check-duplicate",
  zValidator("json", checkDuplicateSchema),
  async (c) => {
    const user = c.get("user");
    if (!user?.id) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const { fileHash } = c.req.valid("json");

    try {
      const result = await checkDuplicateUpload(user.id, fileHash);

      if (result.isDuplicate && result.existingUpload) {
        return c.json({
          isDuplicate: true,
          existingUploadId: result.existingUpload.id,
          existingUploadDate: result.existingUpload.uploadedAt.toISOString(),
          message: `This file was already uploaded on ${result.existingUpload.uploadedAt.toLocaleDateString()}. ${result.existingUpload.tripsCreated} trips created, ${result.existingUpload.tripsUpdated} updated.`,
        });
      }

      return c.json({
        isDuplicate: false,
        existingUploadId: null,
        existingUploadDate: null,
        message: "File has not been uploaded before",
      });
    } catch (error) {
      console.error("[Uploads] Error checking duplicate:", error);
      return c.json({ error: "Failed to check duplicate" }, 500);
    }
  }
);

// ============================================
// POST /api/uploads/:id/retry - Retry a failed upload
// ============================================
uploadsRouter.post("/:id/retry", async (c) => {
  const user = c.get("user");
  if (!user?.id) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const uploadId = c.req.param("id");

  try {
    const upload = await getUploadById(uploadId, user.id);

    if (!upload) {
      return c.json({ error: "Upload not found" }, 404);
    }

    if (upload.status !== "failed") {
      return c.json({
        success: false,
        uploadId,
        summary: null,
        message: `Cannot retry upload with status: ${upload.status}. Only failed uploads can be retried.`,
      });
    }

    // Reset status to pending for reprocessing
    await updateUploadStatus(uploadId, "pending", {
      errorMessage: undefined,
    });

    // Note: The actual reprocessing would be triggered by a background job
    // For now, return success indicating the upload is queued for retry
    return c.json({
      success: true,
      uploadId,
      summary: null,
      message: "Upload queued for retry. Refresh to see results.",
    });
  } catch (error) {
    console.error("[Uploads] Error retrying upload:", error);
    return c.json({ error: "Failed to retry upload" }, 500);
  }
});

// ============================================
// POST /api/uploads/rebuild - Rebuild all trips from uploads
// ============================================
const rebuildSchema = z.object({
  deleteExisting: z.boolean().optional().default(false),
  onlyFailed: z.boolean().optional().default(false),
});

uploadsRouter.post(
  "/rebuild",
  zValidator("json", rebuildSchema),
  async (c) => {
    const user = c.get("user");
    if (!user?.id) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const { deleteExisting, onlyFailed } = c.req.valid("json");

    try {
      const result = await rebuildFromUploads(user.id, {
        deleteExisting,
        onlyFailed,
      });

      return c.json({
        success: true,
        processed: result.processed,
        skipped: result.skipped,
        errors: result.errors,
        message: `Processed ${result.processed} uploads. ${result.skipped} skipped with errors.`,
      });
    } catch (error) {
      console.error("[Uploads] Error rebuilding from uploads:", error);
      return c.json({ error: "Failed to rebuild from uploads" }, 500);
    }
  }
);

export { uploadsRouter };
