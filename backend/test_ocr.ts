import { performOCRWithRetry } from "./src/lib/ocr-engine";
import { detectTemplate } from "./src/lib/robust-schedule-parser";
import * as fs from "node:fs";
import * as path from "node:path";

const files = fs.readdirSync("./uploads")
  .filter(f => f.endsWith('.png') || f.endsWith('.jpg'))
  .map(f => ({ name: f, mtime: fs.statSync("./uploads/" + f).mtimeMs }))
  .sort((a, b) => b.mtime - a.mtime);

console.log("Latest:", files[0]?.name);
if (!files[0]) process.exit(1);

const filePath = path.join("./uploads", files[0].name);
const ocrResult = await performOCRWithRetry(filePath);
console.log("OCR confidence:", ocrResult.confidence);

const detection = detectTemplate(ocrResult.fullText);
console.log("Template:", detection.templateType, "conf:", detection.confidence.toFixed(2));

const hasTripIdLine = /Trip\s*(?:Id|1d)[:\s]+([A-Z]?\d{4,6})/i.test(ocrResult.fullText);
const hasLegRows = /\d\s*(?:Su|Mo|Tu|We|Th|Fr|Sa|8a|0u)\s+(?:DH\s+)?\d{3,5}?\s+[A-Z]{3}\s*[-–]\s*[A-Z]{3}/i.test(ocrResult.fullText);
const hasBlockColumn = /Block|BLK|\d:\d{2}\s+76[78WP]/i.test(ocrResult.fullText);
console.log("hasTripIdLine:", hasTripIdLine, "hasLegRows:", hasLegRows, "hasBlockColumn:", hasBlockColumn);

console.log("\n=== OCR TEXT ===");
console.log(ocrResult.fullText);
