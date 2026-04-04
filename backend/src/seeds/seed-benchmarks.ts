/**
 * Seed Pay Benchmarks
 * Run with: bun run src/seeds/seed-benchmarks.ts
 */

import { db } from "../db";
import { getBenchmarksForSeeding } from "./ups-benchmarks-2025";

async function seedBenchmarks() {
  console.log("🌱 Seeding pay benchmarks...");

  const benchmarks = getBenchmarksForSeeding();
  console.log(`📊 Found ${benchmarks.length} benchmark records to seed`);

  let created = 0;
  let updated = 0;

  for (const benchmark of benchmarks) {
    const existing = await db.payBenchmark.findFirst({
      where: {
        airline: benchmark.airline,
        effectiveDate: benchmark.effectiveDate,
        seat: benchmark.seat,
        yearOfService: benchmark.yearOfService,
      },
    });

    if (existing) {
      await db.payBenchmark.update({
        where: { id: existing.id },
        data: benchmark,
      });
      updated++;
    } else {
      await db.payBenchmark.create({
        data: benchmark,
      });
      created++;
    }
  }

  console.log(`✅ Seeding complete: ${created} created, ${updated} updated`);

  // Verify
  const count = await db.payBenchmark.count();
  console.log(`📊 Total benchmark records in database: ${count}`);

  await db.$disconnect();
}

seedBenchmarks().catch((e) => {
  console.error("❌ Seeding failed:", e);
  process.exit(1);
});
