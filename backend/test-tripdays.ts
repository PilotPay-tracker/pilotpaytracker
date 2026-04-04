import { performOCRWithRetry } from "./src/lib/ocr-engine";
import { parseCrewAccessTripInfo } from "./src/lib/robust-schedule-parser";

const filePath = "./uploads/f5731c8d-53e3-4bcc-af58-71c21c7de050.jpg";

async function main() {
  const ocrResult = await performOCRWithRetry(filePath);
  const parseResult = parseCrewAccessTripInfo(ocrResult.fullText);
  
  console.log("=== AUTHORITATIVE VALUES TEST ===");
  console.log("Trip ID:", parseResult.tripId);
  
  console.log("\n--- TRIP DAYS ---");
  console.log("Parsed tripDays:", parseResult.tripDays);
  console.log("Parsed totals.dutyDaysCount:", parseResult.totals.dutyDaysCount);
  console.log("Computed duty periods:", parseResult.dutyDays.length);
  console.log("Expected Trip Days: 3 (from Crew Access)");
  console.log(parseResult.tripDays === 3 ? "✅ Trip Days correct" : "❌ Trip Days wrong");
  
  console.log("\n--- TOTALS ---");
  console.log("Block:", parseResult.totals.blockMinutes + " min (expected 567)");
  console.log("Credit:", parseResult.totals.creditMinutes + " min (expected 778)");
  console.log("TAFB:", parseResult.totals.tafbMinutes + " min (expected 2919)");
  
  console.log("\n--- ALL CHECKS ---");
  console.log(parseResult.tripDays === 3 ? "✅" : "❌", "Trip Days =", parseResult.tripDays, "(expected 3)");
  console.log(parseResult.totals.dutyDaysCount === 3 ? "✅" : "❌", "Duty Days Count =", parseResult.totals.dutyDaysCount, "(expected 3)");
  console.log(parseResult.totals.blockMinutes === 567 ? "✅" : "❌", "Block =", parseResult.totals.blockMinutes, "(expected 567)");
  console.log(parseResult.totals.creditMinutes === 778 ? "✅" : "❌", "Credit =", parseResult.totals.creditMinutes, "(expected 778)");
  console.log(parseResult.totals.tafbMinutes === 2919 ? "✅" : "❌", "TAFB =", parseResult.totals.tafbMinutes, "(expected 2919)");
  console.log(parseResult.dutyDays.length === 2 ? "✅" : "❌", "Duty Periods =", parseResult.dutyDays.length, "(expected 2 - correct grouping)");
}

main().catch(console.error);
