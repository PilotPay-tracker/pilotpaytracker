import { db } from "./src/db";

const trips = await db.trip.findMany({
  orderBy: { createdAt: 'desc' },
  take: 1,
  include: {
    tripDutyDays: {
      include: { legs: { orderBy: { legIndex: 'asc' } } },
      orderBy: { dutyDayIndex: 'asc' }
    }
  }
});

const t = trips[0] as any;
if (t) {
  console.log("Trip:", t.tripNumber, "start:", t.startDate, "end:", t.endDate);
  console.log("totalCreditMinutes:", t.totalCreditMinutes, "(", Math.floor(t.totalCreditMinutes/60)+":"+String(t.totalCreditMinutes%60).padStart(2,'0'), ")");
  console.log("totalBlockMinutes:", t.totalBlockMinutes, "(", Math.floor(t.totalBlockMinutes/60)+":"+String(t.totalBlockMinutes%60).padStart(2,'0'), ")");
  console.log("totalTafbMinutes:", t.totalTafbMinutes);
  console.log("dutyDays:", t.tripDutyDays.length);
  for (const dd of t.tripDutyDays) {
    console.log("  Day " + dd.dutyDayIndex + " (" + dd.dutyDate + "): credit=" + dd.creditMinutes + " block=" + dd.blockMinutes + " duty=" + dd.dutyMinutes + " report=" + dd.reportTimeISO + " release=" + dd.releaseTimeISO);
    for (const leg of dd.legs) {
      const blk = Math.floor(leg.plannedBlockMinutes/60)+":"+String(leg.plannedBlockMinutes%60).padStart(2,'0');
      const cr = Math.floor(leg.plannedCreditMinutes/60)+":"+String(leg.plannedCreditMinutes%60).padStart(2,'0');
      console.log("    " + (leg.isDeadhead?"DH ":"") + leg.flightNumber + " " + leg.origin + "-" + leg.destination + " dep=" + leg.scheduledOutISO + " arr=" + leg.scheduledInISO + " blk=" + blk + " cr=" + cr + " equip=" + leg.equipment);
    }
  }
}
