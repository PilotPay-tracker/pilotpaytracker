/**
 * Import Trip S50558 with full details from the Crew Access screenshot
 * Trip: S50558 starting 11Jan2026
 * 8 Duty Days with full flight data, hotels, and layovers
 */

import { db } from "../src/db";

async function importTripS50558() {
  console.log("🛫 Starting import of Trip S50558...");

  // Get the user (should be only one for now)
  const user = await db.user.findFirst();
  if (!user) {
    console.error("❌ No user found!");
    return;
  }
  console.log(`👤 User: ${user.id}`);

  // Get user's hourly rate
  const profile = await db.profile.findUnique({
    where: { userId: user.id },
  });
  const hourlyRateCents = profile?.hourlyRateCents ?? 32500; // Default $325/hr

  // Delete existing trips to start fresh
  console.log("🗑️  Cleaning up existing trips...");
  await db.leg.deleteMany({ where: { dutyDay: { trip: { userId: user.id } } } });
  await db.dutyDay.deleteMany({ where: { trip: { userId: user.id } } });
  await db.tripEvent.deleteMany({ where: { trip: { userId: user.id } } });
  await db.trip.deleteMany({ where: { userId: user.id } });

  // Trip totals from screenshot
  const TRIP_TOTALS = {
    blockMinutes: 29 * 60 + 13,    // 29:13 = 1753 minutes
    creditMinutes: 43 * 60 + 42,   // 43:42 = 2622 minutes
    tafbMinutes: 163 * 60 + 53,    // 163:53 = 9833 minutes
    dutyDays: 8,
  };

  // Create the main trip
  console.log("✈️  Creating Trip S50558...");
  const trip = await db.trip.create({
    data: {
      userId: user.id,
      tripNumber: "S50558",
      pairingId: "S50558",
      startDate: "2026-01-11",
      endDate: "2026-01-19",
      baseFleet: "SDF 767",
      source: "import",
      status: "scheduled",
      totalBlockMinutes: TRIP_TOTALS.blockMinutes,
      totalCreditMinutes: TRIP_TOTALS.creditMinutes,
      totalTafbMinutes: TRIP_TOTALS.tafbMinutes,
      totalPayCents: Math.round((TRIP_TOTALS.creditMinutes / 60) * hourlyRateCents),
    },
  });
  console.log(`✅ Created trip: ${trip.id}`);

  // Duty Day data extracted from screenshot
  interface FlightData {
    flt: string;
    route: string;
    depZ: string;
    arrZ: string;
    block: number;
    equipment?: string;
    isDeadhead?: boolean;
    credit: number;
  }

  interface DutyDayData {
    date: string;
    dayNumber: number;
    dayOfWeek: string;
    dutyStartTime: string;
    dutyEndTime: string;
    dutyMinutes: number;
    blockMinutes: number;
    flights: FlightData[];
    restMinutes: number;
    hotel: { name: string; phone: string } | null;
  }

  const dutyDaysData: DutyDayData[] = [
    {
      // Day 1 - Sunday Jan 11
      date: "2026-01-11",
      dayNumber: 1,
      dayOfWeek: "Su",
      dutyStartTime: "19:37",
      dutyEndTime: "00:55",
      dutyMinutes: 5 * 60 + 18,
      blockMinutes: 0,
      flights: [
        { flt: "DH DL3195", route: "SDF-ATL", depZ: "20:37", arrZ: "22:09", block: 0, isDeadhead: true, credit: 56 },
        { flt: "DH DL2035", route: "ATL-MCO", depZ: "23:05", arrZ: "00:40", block: 0, isDeadhead: true, credit: 0 },
      ],
      restMinutes: 24 * 60 + 14,
      hotel: { name: "Florida Hotel & Conference Center", phone: "407-859-1500" },
    },
    {
      // Day 2 - Tuesday Jan 13
      date: "2026-01-13",
      dayNumber: 2,
      dayOfWeek: "Tu",
      dutyStartTime: "01:09",
      dutyEndTime: "05:06",
      dutyMinutes: 3 * 60 + 57,
      blockMinutes: 2 * 60 + 42,
      flights: [
        { flt: "1327", route: "MCO-RFD", depZ: "02:09", arrZ: "04:51", block: 162, equipment: "767", credit: 162 },
      ],
      restMinutes: 15 * 60 + 24,
      hotel: { name: "Radisson Hotel and Conference", phone: "815-226-2100" },
    },
    {
      // Day 3 - Tuesday/Wednesday Jan 14
      date: "2026-01-14",
      dayNumber: 3,
      dayOfWeek: "Tu",
      dutyStartTime: "20:30",
      dutyEndTime: "03:52",
      dutyMinutes: 7 * 60 + 22,
      blockMinutes: 4 * 60 + 32,
      flights: [
        { flt: "2846", route: "RFD-PHX", depZ: "21:30", arrZ: "00:55", block: 205, equipment: "767", credit: 95 },
        { flt: "9839", route: "PHX-ONT", depZ: "02:30", arrZ: "03:37", block: 67, equipment: "767", credit: 0 },
      ],
      restMinutes: 14 * 60 + 58,
      hotel: { name: "Ayres Suites Ontario Mills Mall", phone: "909-481-0703" },
    },
    {
      // Day 4 - Wednesday Jan 15
      date: "2026-01-15",
      dayNumber: 4,
      dayOfWeek: "We",
      dutyStartTime: "18:50",
      dutyEndTime: "00:36",
      dutyMinutes: 5 * 60 + 46,
      blockMinutes: 4 * 60 + 31,
      flights: [
        { flt: "2310", route: "ONT-MIA", depZ: "19:50", arrZ: "00:21", block: 271, equipment: "767", credit: 271 },
      ],
      restMinutes: 21 * 60 + 39,
      hotel: { name: "Courtyard by Marriott Miami Downtown", phone: "305-374-3000" },
    },
    {
      // Day 5 - Thursday Jan 16
      date: "2026-01-16",
      dayNumber: 5,
      dayOfWeek: "Th",
      dutyStartTime: "22:15",
      dutyEndTime: "02:43",
      dutyMinutes: 4 * 60 + 28,
      blockMinutes: 3 * 60 + 13,
      flights: [
        { flt: "9885", route: "MIA-DFW", depZ: "23:15", arrZ: "02:28", block: 193, equipment: "767", credit: 193 },
      ],
      restMinutes: 11 * 60 + 36,
      hotel: { name: "Sheraton Dallas Hotel", phone: "214-922-8000" },
    },
    {
      // Day 6 - Friday Jan 17
      date: "2026-01-17",
      dayNumber: 6,
      dayOfWeek: "Fr",
      dutyStartTime: "14:19",
      dutyEndTime: "02:00",
      dutyMinutes: 11 * 60 + 41,
      blockMinutes: 6 * 60 + 24,
      flights: [
        { flt: "5785", route: "DFW-SDF", depZ: "15:19", arrZ: "17:16", block: 117, equipment: "767", credit: 242 },
        { flt: "5900", route: "SDF-LAX", depZ: "21:18", arrZ: "01:45", block: 267, equipment: "767", credit: 0 },
      ],
      restMinutes: 11 * 60 + 0,
      hotel: { name: "Ayres Hotel Manhattan Beach-Hawthorne", phone: "310-536-0400" },
    },
    {
      // Day 7 - Saturday Jan 18
      date: "2026-01-18",
      dayNumber: 7,
      dayOfWeek: "Sa",
      dutyStartTime: "13:00",
      dutyEndTime: "01:01",
      dutyMinutes: 12 * 60 + 1,
      blockMinutes: 5 * 60 + 36,
      flights: [
        { flt: "5903", route: "LAX-SDF", depZ: "14:00", arrZ: "17:43", block: 223, equipment: "767", credit: 205 },
        { flt: "5076", route: "SDF-EWR", depZ: "21:08", arrZ: "23:01", block: 113, equipment: "767", credit: 15 },
        { flt: "GND", route: "EWR-JFK", depZ: "23:16", arrZ: "01:01", block: 0, isDeadhead: true, credit: 0 },
      ],
      restMinutes: 10 * 60 + 59,
      hotel: { name: "Hampton Inn and Suites Rockville Centre", phone: "516-599-1700" },
    },
    {
      // Day 8 - Sunday Jan 19 (end day)
      date: "2026-01-19",
      dayNumber: 8,
      dayOfWeek: "Su",
      dutyStartTime: "12:00",
      dutyEndTime: "15:30",
      dutyMinutes: 3 * 60 + 30,
      blockMinutes: 2 * 60 + 15,
      flights: [
        { flt: "5125", route: "JFK-SDF", depZ: "13:00", arrZ: "15:15", block: 135, equipment: "767", credit: 135 },
      ],
      restMinutes: 0,
      hotel: null,
    },
  ];

  // Create duty days and legs
  console.log("📅 Creating duty days and legs...");

  for (const dayData of dutyDaysData) {
    // Calculate pay for this duty day
    const dayCredit = dayData.flights.reduce((sum, f) => sum + (f.credit || 0), 0);
    const dayBlock = dayData.flights.reduce((sum, f) => sum + (f.block || 0), 0);
    const minCredit = Math.max(dayCredit, 360); // 6 hour minimum
    const dayPayCents = Math.round((minCredit / 60) * hourlyRateCents);

    const dutyDay = await db.dutyDay.create({
      data: {
        tripId: trip.id,
        dutyDate: dayData.date,
        dutyStartISO: `${dayData.date}T${dayData.dutyStartTime}:00.000Z`,
        dutyEndISO: dayData.dutyEndTime
          ? `${dayData.date}T${dayData.dutyEndTime}:00.000Z`
          : null,
        plannedCreditMinutes: dayCredit,
        actualBlockMinutes: dayBlock,
        actualCreditMinutes: dayCredit,
        finalCreditMinutes: minCredit,
        minCreditMinutes: 360,
        totalPayCents: dayPayCents,
      },
    });
    console.log(`  📅 Day ${dayData.dayNumber} (${dayData.date}): ${dutyDay.id}`);

    // Create legs for this duty day
    for (let i = 0; i < dayData.flights.length; i++) {
      const flight = dayData.flights[i];
      if (!flight) continue;

      const routeParts = flight.route.split("-");
      const origin = routeParts[0] || null;
      const destination = routeParts[1] || null;

      const leg = await db.leg.create({
        data: {
          dutyDayId: dutyDay.id,
          legIndex: i,
          flightNumber: flight.flt,
          origin,
          destination,
          equipment: flight.equipment || null,
          isDeadhead: flight.isDeadhead || false,
          scheduledOutISO: `${dayData.date}T${flight.depZ}:00.000Z`,
          scheduledInISO: `${dayData.date}T${flight.arrZ}:00.000Z`,
          plannedBlockMinutes: flight.block,
          plannedCreditMinutes: flight.credit,
          actualBlockMinutes: flight.block,
          creditMinutes: flight.credit,
          calculatedPayCents: Math.round((flight.credit / 60) * hourlyRateCents),
          source: "import",
        },
      });
      console.log(`    ✈️ ${flight.flt}: ${flight.route} (${flight.block}min block)`);
    }

    // Create hotel event if exists
    if (dayData.hotel) {
      const lastFlight = dayData.flights[dayData.flights.length - 1];
      const lastDestination = lastFlight ? lastFlight.route.split("-")[1] : null;

      await db.tripEvent.create({
        data: {
          tripId: trip.id,
          eventType: "HOTEL",
          hotelName: dayData.hotel.name,
          hotelPhone: dayData.hotel.phone,
          hotelBooked: true,
          station: lastDestination || null,
          sortOrder: dayData.dayNumber * 100,
        },
      });
      console.log(`    🏨 ${dayData.hotel.name}`);
    }

    // Create layover event if rest time exists
    if (dayData.restMinutes > 0) {
      const lastFlight = dayData.flights[dayData.flights.length - 1];
      const lastDestination = lastFlight ? lastFlight.route.split("-")[1] : null;

      await db.tripEvent.create({
        data: {
          tripId: trip.id,
          eventType: "LAYOVER",
          layoverMinutes: dayData.restMinutes,
          station: lastDestination || null,
          sortOrder: dayData.dayNumber * 100 + 50,
        },
      });
    }
  }

  console.log("\n✅ Trip S50558 imported successfully!");
  console.log(`   📊 Totals: Block ${TRIP_TOTALS.blockMinutes}min, Credit ${TRIP_TOTALS.creditMinutes}min`);
  console.log(`   💰 Est Pay: $${((TRIP_TOTALS.creditMinutes / 60) * hourlyRateCents / 100).toFixed(2)}`);

  // Verify
  const verifyTrip = await db.trip.findUnique({
    where: { id: trip.id },
    include: {
      dutyDays: {
        include: { legs: true },
        orderBy: { dutyDate: "asc" },
      },
      events: true,
    },
  });

  if (verifyTrip) {
    const totalLegs = verifyTrip.dutyDays.reduce((sum, dd) => sum + dd.legs.length, 0);
    console.log(`\n📋 Verification:`);
    console.log(`   Duty Days: ${verifyTrip.dutyDays.length}`);
    console.log(`   Total Legs: ${totalLegs}`);
    console.log(`   Events: ${verifyTrip.events.length}`);
  }
}

importTripS50558()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ Import failed:", err);
    process.exit(1);
  });
