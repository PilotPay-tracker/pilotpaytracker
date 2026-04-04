import { db } from "./src/db";

async function main() {
  try {
    const jobs = await db.uploadJob.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        status: true,
        currentStep: true,
        createdAt: true,
      },
    });

    console.log("=== UPLOAD JOBS ===");
    for (const j of jobs) {
      console.log(`${j.id}: ${j.status} - ${j.currentStep}`);
    }
  } catch (err) {
    console.error("DB Error:", err);
  } finally {
    await db.$disconnect();
  }
}

main();
