/**
 * Image Preprocessing Module
 * Handles auto-rotation, cropping, contrast enhancement, and resizing
 * for optimal OCR performance
 */

import sharp from "sharp";
import * as crypto from "crypto";
import * as fs from "node:fs";
import * as path from "node:path";

// ============================================
// Types
// ============================================

export interface PreprocessedImage {
  buffer: Buffer;
  width: number;
  height: number;
  hash: string;
  originalPath: string;
  preprocessedPath: string;
}

export interface ImageMetadata {
  width: number;
  height: number;
  orientation?: number;
  format?: string;
}

// ============================================
// Image Hash Generation
// ============================================

/**
 * Generate a perceptual hash for an image
 * Used for caching and deduplication
 */
export async function generateImageHash(imagePath: string): Promise<string> {
  const buffer = fs.readFileSync(imagePath);

  // Create a small grayscale thumbnail for perceptual hashing
  const thumbnail = await sharp(buffer)
    .resize(16, 16, { fit: "fill" })
    .grayscale()
    .raw()
    .toBuffer();

  // Generate hash from thumbnail pixels
  const hash = crypto.createHash("sha256").update(thumbnail).digest("hex");
  return hash.substring(0, 32); // Use first 32 chars
}

/**
 * Generate MD5 hash of file contents for exact matching
 */
export function generateFileHash(imagePath: string): string {
  const buffer = fs.readFileSync(imagePath);
  return crypto.createHash("md5").update(buffer).digest("hex");
}

// ============================================
// Image Preprocessing Pipeline
// ============================================

/**
 * Main preprocessing function
 * Applies all optimizations for OCR
 */
export async function preprocessImage(
  imagePath: string,
  outputDir: string
): Promise<PreprocessedImage> {
  const buffer = fs.readFileSync(imagePath);
  const hash = await generateImageHash(imagePath);

  // Get original metadata
  const metadata = await sharp(buffer).metadata();

  let pipeline = sharp(buffer);

  // 1. Auto-rotate based on EXIF orientation
  pipeline = pipeline.rotate(); // Auto-rotates based on EXIF

  // 2. Convert to grayscale for better OCR
  // (keeping color for now as it might help with classification)

  // 3. Resize if too large (optimal OCR is around 300 DPI equivalent)
  const maxDimension = 2400; // Good balance for OCR
  if ((metadata.width || 0) > maxDimension || (metadata.height || 0) > maxDimension) {
    pipeline = pipeline.resize(maxDimension, maxDimension, {
      fit: "inside",
      withoutEnlargement: true,
    });
  }

  // 4. Enhance contrast and sharpen for better text detection
  pipeline = pipeline
    .normalize() // Stretch contrast to full range
    .sharpen({
      sigma: 1.0,
      m1: 1.5,
      m2: 0.7,
    })
    .modulate({
      brightness: 1.0,
      saturation: 0.8, // Slightly reduce saturation
    });

  // 5. Convert to PNG for lossless quality
  pipeline = pipeline.png({ quality: 100 });

  // Process the image
  const processedBuffer = await pipeline.toBuffer();
  const processedMetadata = await sharp(processedBuffer).metadata();

  // Save preprocessed image
  const outputFilename = `preprocessed_${hash}.png`;
  const outputPath = path.join(outputDir, outputFilename);
  fs.writeFileSync(outputPath, processedBuffer);

  return {
    buffer: processedBuffer,
    width: processedMetadata.width || 0,
    height: processedMetadata.height || 0,
    hash,
    originalPath: imagePath,
    preprocessedPath: outputPath,
  };
}

/**
 * Enhanced preprocessing for schedule screenshots
 * Includes content-aware cropping to remove UI elements
 * With magnification for small text and improved contrast
 */
export async function preprocessScheduleImage(
  imagePath: string,
  outputDir: string
): Promise<PreprocessedImage> {
  const buffer = fs.readFileSync(imagePath);
  const hash = await generateImageHash(imagePath);

  const metadata = await sharp(buffer).metadata();
  const originalWidth = metadata.width || 0;
  const originalHeight = metadata.height || 0;

  // First, auto-rotate and get the actual dimensions after rotation
  const rotatedBuffer = await sharp(buffer).rotate().toBuffer();
  const rotatedMetadata = await sharp(rotatedBuffer).metadata();
  const width = rotatedMetadata.width || originalWidth;
  const height = rotatedMetadata.height || originalHeight;

  let pipeline = sharp(rotatedBuffer);

  // 2. Crop to remove typical mobile UI elements (skip if dimensions are too small)
  // Top: status bar (~5-8% of height)
  // Bottom: navigation bar (~8-12% of height)
  const topCrop = Math.floor(height * 0.06);
  const bottomCrop = Math.floor(height * 0.10);
  const cropHeight = height - topCrop - bottomCrop;

  // Only crop if we have valid dimensions and enough height
  if (cropHeight > 200 && width > 100 && topCrop >= 0 && cropHeight <= height) {
    try {
      pipeline = pipeline.extract({
        left: 0,
        top: topCrop,
        width: width,
        height: cropHeight,
      });
    } catch (extractErr) {
      console.log(`  ⚠️ Skipping crop due to error: ${extractErr}`);
      // Continue without cropping
    }
  }

  // 3. MAGNIFY: Upscale for better OCR on small text
  // Optimal OCR is around 300 DPI, most phone screenshots are lower
  // Upscaling 1.5-2x helps with small text recognition
  const targetMinDimension = 2000;
  const currentMin = Math.min(width, cropHeight || height);
  const scaleFactor = currentMin < targetMinDimension ? targetMinDimension / currentMin : 1;

  if (scaleFactor > 1) {
    const newWidth = Math.round(width * Math.min(scaleFactor, 2));
    const newHeight = Math.round((cropHeight || height) * Math.min(scaleFactor, 2));
    pipeline = pipeline.resize(newWidth, newHeight, {
      kernel: sharp.kernel.lanczos3, // High-quality upscaling
      withoutEnlargement: false, // Allow upscaling
    });
    console.log(`  📐 Magnified image ${Math.round(scaleFactor * 100)}% for better text recognition`);
  }

  // 4. Limit max size for processing efficiency
  const maxDimension = 3000;
  pipeline = pipeline.resize(maxDimension, maxDimension, {
    fit: "inside",
    withoutEnlargement: true,
  });

  // 5. Enhanced preprocessing for text clarity
  pipeline = pipeline
    .normalize() // Stretch contrast to full range
    .sharpen({
      sigma: 1.5, // Increased for better edge definition
      m1: 2.0,    // Increase sharpening on darker areas
      m2: 1.0,    // Moderate sharpening on lighter areas
    })
    .modulate({
      brightness: 1.05, // Slight brightness boost
      saturation: 0.5,  // Reduce color for cleaner OCR
    })
    .gamma(1.15) // Gamma adjustment for better contrast
    .png({ quality: 100 });

  const processedBuffer = await pipeline.toBuffer();
  const processedMetadata = await sharp(processedBuffer).metadata();

  const outputFilename = `schedule_${hash}.png`;
  const outputPath = path.join(outputDir, outputFilename);
  fs.writeFileSync(outputPath, processedBuffer);

  console.log(`  ✅ Preprocessed: ${processedMetadata.width}x${processedMetadata.height}`);

  return {
    buffer: processedBuffer,
    width: processedMetadata.width || 0,
    height: processedMetadata.height || 0,
    hash,
    originalPath: imagePath,
    preprocessedPath: outputPath,
  };
}

/**
 * Create a high-contrast version for OCR
 * Useful for difficult-to-read text
 */
export async function createHighContrastVersion(
  imagePath: string,
  outputDir: string
): Promise<Buffer> {
  const buffer = fs.readFileSync(imagePath);

  const processed = await sharp(buffer)
    .rotate()
    .grayscale()
    .normalize()
    .threshold(128) // Binarize for maximum contrast
    .png()
    .toBuffer();

  return processed;
}

/**
 * Detect if image needs rotation based on text orientation
 * Returns suggested rotation in degrees
 */
export async function detectOrientation(imagePath: string): Promise<number> {
  const buffer = fs.readFileSync(imagePath);
  const metadata = await sharp(buffer).metadata();

  // Check EXIF orientation
  const orientation = metadata.orientation || 1;

  // Map EXIF orientation to rotation degrees
  const rotationMap: { [key: number]: number } = {
    1: 0,    // Normal
    2: 0,    // Flipped horizontally
    3: 180,  // Rotated 180
    4: 180,  // Flipped vertically
    5: 90,   // Rotated 90 CW + flipped
    6: 90,   // Rotated 90 CW
    7: 270,  // Rotated 90 CCW + flipped
    8: 270,  // Rotated 90 CCW
  };

  return rotationMap[orientation] || 0;
}
