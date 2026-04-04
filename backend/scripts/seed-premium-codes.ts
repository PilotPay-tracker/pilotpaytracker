/**
 * PHASE 7 — Seed Premium Codes Script
 *
 * Run this script to populate the PremiumCodes table with all UPS premium codes.
 * Usage: bun run scripts/seed-premium-codes.ts
 */

import { seedPremiumCodes } from '../src/lib/premium-codes-seed';

async function main() {
  console.log('🚀 Seeding UPS Premium Codes...');
  console.log('');

  try {
    const result = await seedPremiumCodes();

    console.log('');
    console.log('✅ Premium Codes Seeded Successfully!');
    console.log('────────────────────────────────────');
    console.log(`   Created: ${result.created} new codes`);
    console.log(`   Updated: ${result.updated} existing codes`);
    console.log('────────────────────────────────────');
    console.log('');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding premium codes:', error);
    process.exit(1);
  }
}

main();
