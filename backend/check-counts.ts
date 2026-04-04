import { db } from "./src/db";

async function main() {
  const pending = await db.uploadJob.count({ where: { status: "pending" } });
  const processing = await db.uploadJob.count({ where: { status: "processing" } });
  const completed = await db.uploadJob.count({ where: { status: "completed" } });
  const failed = await db.uploadJob.count({ where: { status: "failed" } });

  console.log("=== JOB COUNTS ===");
  console.log("Pending:", pending);
  console.log("Processing:", processing);
  console.log("Completed:", completed);
  console.log("Failed:", failed);
}

main();
