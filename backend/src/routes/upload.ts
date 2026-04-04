import { Hono } from "hono";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { type AppType } from "../types";
import { zValidator } from "@hono/zod-validator";
import {
  uploadImageRequestSchema,
  type UploadImageResponse,
} from "@/shared/contracts";

// ============================================
// Uploads directory setup
// ============================================
// Creates uploads/ directory if it doesn't exist
// All uploaded images are stored here and served via /uploads/* endpoint
const UPLOADS_DIR = path.join(process.cwd(), "uploads");
if (!fs.existsSync(UPLOADS_DIR)) {
  console.log("📁 [Upload] Creating uploads directory:", UPLOADS_DIR);
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
} else {
  console.log("📁 [Upload] Uploads directory exists:", UPLOADS_DIR);
}

const uploadRouter = new Hono<AppType>();

// Helper: Write file with async for better performance
async function writeFileAsync(filePath: string, buffer: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    fs.writeFile(filePath, buffer, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

// ============================================
// POST /api/upload/image - Upload an image
// ============================================
// Accepts multipart/form-data with "image" field
// Validates file type and size before saving
// Returns URL to access the uploaded image
uploadRouter.post("/image", zValidator("form", uploadImageRequestSchema), async (c) => {
  // Require authentication
  const user = c.get("user");
  if (!user?.id) {
    console.log("❌ [Upload] Unauthorized - no user session");
    return c.json({ error: "Unauthorized" }, 401);
  }

  const { image } = c.req.valid("form");
  console.log("📤 [Upload] Image upload request received from user:", user.id);

  try {
    // Check if file exists in request
    if (!image) {
      console.log("❌ [Upload] No image file provided in request");
      return c.json({ error: "No image file provided" }, 400);
    }
    console.log(
      `📄 [Upload] File received: ${image.name} (${image.type}, ${(image.size / 1024).toFixed(2)} KB)`,
    );

    // Validate file type
    const allowedTypes = ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"];
    if (!allowedTypes.includes(image.type)) {
      console.log(`❌ [Upload] Invalid file type: ${image.type}`);
      return c.json(
        { error: "Invalid file type. Only JPEG, PNG, GIF, and WebP images are allowed" },
        400,
      );
    }
    console.log(`✅ [Upload] File type validated: ${image.type}`);

    // Validate file size (10MB limit)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (image.size > maxSize) {
      console.log(
        `❌ [Upload] File too large: ${(image.size / 1024 / 1024).toFixed(2)} MB (max: 10 MB)`,
      );
      return c.json({ error: "File too large. Maximum size is 10MB" }, 400);
    }
    console.log(`✅ [Upload] File size validated: ${(image.size / 1024).toFixed(2)} KB`);

    // Generate unique filename to prevent collisions
    const fileExtension = path.extname(image.name);
    const uniqueFilename = `${randomUUID()}${fileExtension}`;
    const filePath = path.join(UPLOADS_DIR, uniqueFilename);
    console.log(`🔑 [Upload] Generated unique filename: ${uniqueFilename}`);

    // Save file to disk using async write for better performance
    console.log(`💾 [Upload] Saving file to: ${filePath}`);
    const arrayBuffer = await image.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    await writeFileAsync(filePath, buffer);
    console.log(`✅ [Upload] File saved successfully`);

    // Return the URL to access the uploaded image
    const imageUrl = `/uploads/${uniqueFilename}`;
    console.log(`🎉 [Upload] Upload complete! Image URL: ${imageUrl}`);

    return c.json({
      success: true,
      message: "Image uploaded successfully",
      url: imageUrl,
      filename: uniqueFilename,
    } satisfies UploadImageResponse);
  } catch (error) {
    console.error("💥 [Upload] Upload error:", error);
    console.error(
      "Stack trace:",
      error instanceof Error ? error.stack : "No stack trace available",
    );
    return c.json({ error: "Failed to upload image" }, 500);
  }
});

// ============================================
// POST /api/upload/image-base64 - Upload image via base64
// ============================================
// Accepts JSON body with base64 encoded image data
// This is more reliable for React Native than FormData
uploadRouter.post(
  "/image-base64",
  async (c) => {
    // Require authentication
    const user = c.get("user");
    if (!user?.id) {
      console.log("❌ [Upload] Unauthorized - no user session");
      return c.json({ error: "Unauthorized" }, 401);
    }

    console.log("📤 [Upload] Base64 image upload request started from user:", user.id);

    let body: { base64?: string; mimeType?: string; filename?: string };
    try {
      body = await c.req.json();
      console.log(`📤 [Upload] Request body keys: ${Object.keys(body).join(", ")}`);
      console.log(`📤 [Upload] base64 length: ${body.base64?.length || 0} chars`);
      console.log(`📤 [Upload] mimeType: ${body.mimeType || "not provided"}`);
    } catch (err) {
      console.error("📤 [Upload] Failed to parse request body:", err);
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const base64 = body.base64;
    const mimeType = body.mimeType || "image/jpeg";
    console.log("📤 [Upload] Base64 image upload - processing");

    try {
      // Validate base64 data
      if (!base64 || base64.length === 0) {
        console.log("❌ [Upload] No base64 data provided");
        return c.json({ error: "No image data provided" }, 400);
      }

      // Validate mime type
      const allowedTypes = ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"];
      if (!allowedTypes.includes(mimeType)) {
        console.log(`❌ [Upload] Invalid mime type: ${mimeType}`);
        return c.json(
          { error: "Invalid file type. Only JPEG, PNG, GIF, and WebP images are allowed" },
          400,
        );
      }

      // Decode base64 to buffer
      const buffer = Buffer.from(base64, "base64");
      console.log(`📄 [Upload] Decoded base64 data: ${(buffer.length / 1024).toFixed(2)} KB`);

      // Validate size (10MB limit)
      const maxSize = 10 * 1024 * 1024;
      if (buffer.length > maxSize) {
        console.log(`❌ [Upload] File too large: ${(buffer.length / 1024 / 1024).toFixed(2)} MB`);
        return c.json({ error: "File too large. Maximum size is 10MB" }, 400);
      }

      // Determine file extension from mime type
      const extensionMap: Record<string, string> = {
        "image/jpeg": ".jpg",
        "image/jpg": ".jpg",
        "image/png": ".png",
        "image/gif": ".gif",
        "image/webp": ".webp",
      };
      const fileExtension = extensionMap[mimeType] || ".jpg";

      // Generate unique filename
      const uniqueFilename = `${randomUUID()}${fileExtension}`;
      const filePath = path.join(UPLOADS_DIR, uniqueFilename);
      console.log(`🔑 [Upload] Generated unique filename: ${uniqueFilename}`);

      // Save file to disk using async write for better performance
      console.log(`💾 [Upload] Saving file to: ${filePath}`);
      await writeFileAsync(filePath, buffer);
      console.log(`✅ [Upload] File saved successfully`);

      // Return the URL to access the uploaded image
      const imageUrl = `/uploads/${uniqueFilename}`;
      console.log(`🎉 [Upload] Upload complete! Image URL: ${imageUrl}`);

      return c.json({
        success: true,
        message: "Image uploaded successfully",
        url: imageUrl,
        filename: uniqueFilename,
      } satisfies UploadImageResponse);
    } catch (error) {
      console.error("💥 [Upload] Base64 upload error:", error);
      console.error(
        "Stack trace:",
        error instanceof Error ? error.stack : "No stack trace available",
      );
      return c.json({ error: "Failed to upload image" }, 500);
    }
  },
);

export { uploadRouter };
