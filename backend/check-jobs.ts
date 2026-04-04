import { db } from "./src/db";

async function main() {
  const jobs = await db.uploadJob.findMany({
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  console.log("=== UPLOAD JOBS ===");
  jobs.forEach(j => console.log(j.id + ": " + j.status + " - " + j.currentStep));

  const processing = await db.uploadJob.count({ where: { status: "processing" } });
  const pending = await db.uploadJob.count({ where: { status: "pending" } });
  console.log("\nProcessing: " + processing + ", Pending: " + pending);

  // Reset ALL stuck and pending jobs
  const reset = await db.uploadJob.updateMany({
    where: { status: { in: ["processing", "pending"] } },
    data: { status: "failed", errorMessage: "Reset - system restart" },
  });
  console.log("Reset " + reset.count + " jobs");
}

main().finally(() => db.$disconnect());
