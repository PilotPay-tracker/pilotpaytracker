/**
 * OCR Engine Module
 * Tesseract.js wrapper with confidence scoring and multi-pass processing
 */

import Tesseract from "tesseract.js";
import * as fs from "node:fs";
import * as path from "node:path";

// ============================================
// Types
// ============================================

export interface OCRWord {
  text: string;
  confidence: number;
  bbox: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  };
  line: number;
}

export interface OCRLine {
  text: string;
  confidence: number;
  words: OCRWord[];
  bbox: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  };
}

export interface OCRBlock {
  text: string;
  confidence: number;
  lines: OCRLine[];
  blockType: "text" | "table" | "unknown";
}

export interface OCRResult {
  fullText: string;
  confidence: number;
  blocks: OCRBlock[];
  lines: OCRLine[];
  words: OCRWord[];
  processingTime: number;
}

// ============================================
// OCR Engine Class
// ============================================

class OCREngine {
  private worker: Tesseract.Worker | null = null;
  private isInitialized = false;

  /**
   * Initialize the Tesseract worker
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    console.log("🔤 [OCR] Initializing Tesseract.js worker...");

    this.worker = await Tesseract.createWorker("eng", Tesseract.OEM.LSTM_ONLY, {
      logger: (m) => {
        if (m.status === "recognizing text") {
          // Progress logging can be added here if needed
        }
      },
    });

    // Set optimal parameters for schedule screenshots
    // Use SINGLE_BLOCK mode which treats entire image as one text block
    // This preserves row integrity for tabular data like flight schedules
    await this.worker.setParameters({
      tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK,
      preserve_interword_spaces: "1",
      // Expanded whitelist to include all characters commonly found in airline schedules
      tessedit_char_whitelist:
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789:.-/ ()[]#&+@_,'\"<>|\\*=",
    });

    this.isInitialized = true;
    console.log("✅ [OCR] Tesseract.js worker initialized");
  }

  /**
   * Terminate the worker
   */
  async terminate(): Promise<void> {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
      this.isInitialized = false;
    }
  }

  /**
   * Perform OCR on an image
   */
  async recognize(imagePath: string): Promise<OCRResult> {
    await this.initialize();

    if (!this.worker) {
      throw new Error("OCR worker not initialized");
    }

    const startTime = Date.now();

    console.log(`🔍 [OCR] Processing image: ${path.basename(imagePath)}`);

    const result = await this.worker.recognize(imagePath);

    const processingTime = Date.now() - startTime;

    // Parse result into structured format
    const ocrResult = this.parseResult(result, processingTime);

    console.log(
      `✅ [OCR] Completed in ${processingTime}ms, confidence: ${ocrResult.confidence.toFixed(1)}%`
    );

    return ocrResult;
  }

  /**
   * Perform OCR with multiple passes for better accuracy
   */
  async recognizeWithRetry(
    imagePath: string,
    highContrastPath?: string
  ): Promise<OCRResult> {
    // First pass: normal image
    const result1 = await this.recognize(imagePath);

    // If confidence is good enough, return
    if (result1.confidence >= 80) {
      return result1;
    }

    // Second pass with high contrast if available
    if (highContrastPath && fs.existsSync(highContrastPath)) {
      console.log("🔄 [OCR] Low confidence, trying high-contrast version...");
      const result2 = await this.recognize(highContrastPath);

      // Return better result
      if (result2.confidence > result1.confidence) {
        return result2;
      }
    }

    // Third pass: try with SPARSE_TEXT mode for tables
    if (result1.confidence < 60 && this.worker) {
      console.log("🔄 [OCR] Trying sparse text mode for tables...");
      await this.worker.setParameters({
        tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT,
      });

      const result3 = await this.recognize(imagePath);

      // Reset to SINGLE_BLOCK mode
      await this.worker.setParameters({
        tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK,
      });

      if (result3.confidence > result1.confidence) {
        return result3;
      }
    }

    return result1;
  }

  /**
   * Parse Tesseract result into structured OCRResult
   */
  private parseResult(
    result: Tesseract.RecognizeResult,
    processingTime: number
  ): OCRResult {
    const page = result.data;

    // Extract all words, lines, and blocks from the nested structure
    const allWords: OCRWord[] = [];
    const allLines: OCRLine[] = [];
    const allBlocks: OCRBlock[] = [];

    let lineIndex = 0;

    if (page.blocks) {
      for (const block of page.blocks) {
        const blockLines: OCRLine[] = [];

        for (const paragraph of block.paragraphs || []) {
          for (const line of paragraph.lines || []) {
            const lineWords: OCRWord[] = [];

            for (const word of line.words || []) {
              const ocrWord: OCRWord = {
                text: word.text,
                confidence: word.confidence,
                bbox: {
                  x0: word.bbox.x0,
                  y0: word.bbox.y0,
                  x1: word.bbox.x1,
                  y1: word.bbox.y1,
                },
                line: lineIndex,
              };
              lineWords.push(ocrWord);
              allWords.push(ocrWord);
            }

            const ocrLine: OCRLine = {
              text: line.text.trim(),
              confidence: line.confidence,
              words: lineWords,
              bbox: {
                x0: line.bbox.x0,
                y0: line.bbox.y0,
                x1: line.bbox.x1,
                y1: line.bbox.y1,
              },
            };
            blockLines.push(ocrLine);
            allLines.push(ocrLine);
            lineIndex++;
          }
        }

        const ocrBlock: OCRBlock = {
          text: block.text.trim(),
          confidence: block.confidence,
          lines: blockLines,
          blockType: this.classifyBlockType(block.text),
        };
        allBlocks.push(ocrBlock);
      }
    }

    return {
      fullText: page.text,
      confidence: page.confidence,
      blocks: allBlocks,
      lines: allLines,
      words: allWords,
      processingTime,
    };
  }

  /**
   * Classify block type (text vs table)
   */
  private classifyBlockType(text: string): "text" | "table" | "unknown" {
    // Tables often have aligned columns with spaces
    const lines = text.split("\n");
    if (lines.length < 2) return "text";

    // Check for consistent spacing patterns (table indicator)
    let spacingPatterns = 0;
    for (const line of lines) {
      const spaces = (line.match(/\s{2,}/g) || []).length;
      if (spaces >= 2) spacingPatterns++;
    }

    if (spacingPatterns >= lines.length * 0.5) {
      return "table";
    }

    return "text";
  }
}

// Singleton instance
let ocrEngineInstance: OCREngine | null = null;

/**
 * Get or create OCR engine instance
 */
export function getOCREngine(): OCREngine {
  if (!ocrEngineInstance) {
    ocrEngineInstance = new OCREngine();
  }
  return ocrEngineInstance;
}

/**
 * Convenience function for one-off OCR
 */
export async function performOCR(imagePath: string): Promise<OCRResult> {
  const engine = getOCREngine();
  return engine.recognize(imagePath);
}

/**
 * Convenience function for OCR with retry
 */
export async function performOCRWithRetry(
  imagePath: string,
  highContrastPath?: string
): Promise<OCRResult> {
  const engine = getOCREngine();
  return engine.recognizeWithRetry(imagePath, highContrastPath);
}
