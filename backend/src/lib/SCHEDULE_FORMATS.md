# Airline Schedule Image Format Specifications

This document details the three primary schedule image formats supported by the OCR parsing system. These specifications ensure 100% accurate parsing of pilot schedules.

---

## Format 1: Crew Access Trip Information (image-1769245145.png)

### Overview
This is the traditional Crew Access schedule format showing a multi-day trip pairing with detailed flight information, hotel details, and trip totals.

### Header Information
- **Title**: "Trip Information"
- **Date**: Format `DDMmmYYYY` (e.g., "08Mar2026")
- **Trip ID**: Format `Trip Id: S##### DDMmmYYYY` (e.g., "Trip Id: S51924 08Mar2026")

### Main Table Columns (Left to Right)
| Column | Header | Description | Example |
|--------|--------|-------------|---------|
| 1 | Day | Day number + day code (1 Su, 2 Mo, etc.) | `1 Su`, `3 Tu`, `4 We` |
| 2 | Flight | Flight number with airline code | `DH AA5644`, `795`, `892` |
| 3 | Departure-Arrival | Route as airport pair | `SDF-DFW`, `MFE-SDF`, `LAS-SDF` |
| 4 | Start | Departure time (ZULU) HH:MM | `19:00`, `01:16`, `14:30` |
| 5 | Start(LT) | Departure time (LOCAL) HH:MM - **USE THIS** | `14:00`, `17:16`, `06:30` |
| 6 | End | Arrival time (ZULU) HH:MM | `23:41`, `02:08`, `18:24` |
| 7 | End(LT) | Arrival time (LOCAL) HH:MM - **USE THIS** | `15:41`, `18:08`, `13:24` |
| 8 | Block | Block time HH:MM | `-`, `02:33`, `03:29` |
| 9 | A/C | Aircraft type | `-`, `757`, `767` |
| 10 | Cnx | Connection code | `-`, `02:46`, `02:15` |
| 11 | PNR | Passenger Name Record | `01:01`, blank |
| 12 | DH Remark | Deadhead remarks | Blank typically |

**IMPORTANT**: For domestic flights, always use LOCAL times (columns 5 and 7) not ZULU times (columns 4 and 6).
The LOCAL times are what pilots see on their watches at the airport.

### Special Row Types
1. **Duty start**: Shows duty period start time
2. **Duty end**: Shows duty period end time
3. **Duty totals**: Contains `Time: HH:MM`, `Block: H:MM`, `Rest: HH:MM`
4. **Hotel details**: `Status: BOOKED`, `Hotel: [Name] [Phone]`, `Hotel Transport: [Phone]`

### Duty Day Structure
Each duty day contains:
- Duty start row
- One or more flight rows
- Duty end row
- Duty totals row
- Hotel details row (if layover)

### Footer/Totals Section
- **Crew**: `Crew: 1F/O`
- **Base**: Base airport code (e.g., `SDF`)
- **Duty Time**: Total duty time `HH:MM`
- **Block Time**: Total block time `HH:MM` - Sum of all flight block times
- **Credit Time**: Total credit time `HH:MM` - **Often different from Block due to daily minimums, rig rules, and guarantees**
- **Trip Days**: Number of duty days
- **TAFB**: Time Away From Base `HHH:MM`
- **Crew on trip**: Position, Seniority, Crew ID, Name

**IMPORTANT**: Credit Time is typically greater than or equal to Block Time because:
- Daily minimum guarantees (e.g., 6:00 minimum credit per duty day)
- Duty rig rules (duty time × multiplier)
- Trip rig rules (trip length minimums)
- Deadhead credit (positioning flights often credit but don't add block time)

### Hotel Information Format
```
Hotel details  Status: BOOKED  Hotel: [Hotel Name] [Phone: ###-###-####]
               Hotel Transport: [Company Name] [Phone: ###-###-####]
```

### Key Parsing Rules
1. Day codes: `Su`=Sunday, `Mo`=Monday, `Tu`=Tuesday, `We`=Wednesday, `Th`=Thursday, `Fr`=Friday, `Sa`=Saturday
2. `DH` prefix on flight number indicates deadhead (non-revenue positioning flight)
3. Block time of `-` indicates deadhead (no block time recorded)
4. Route format is always `DEP-ARR` (3-letter IATA codes)

---

## Format 2: Trip Board Browser/PBS Format (image-1769245171.jpg)

### Overview
This is the Trip Board Browser view showing a pairing in a dark-themed mobile interface. Uses day codes (FR13, SA14) instead of dates.

### Header Information
- **Close Button**: Blue "Close" button (top left)
- **Trip Number**: `Trip ####` (e.g., "Trip 1362")
- **Report Time**: `Report at (DD) HH:MM` (e.g., "Report at (02) 07:29")
- **Navigation**: Clipboard icon, left/right arrows (top right)

### Main Table Columns (Left to Right)
| Column | Header | Description | Example |
|--------|--------|-------------|---------|
| 1 | DAY | Day code + date number | `FR13`, `SA14`, `MO16`, `TU17` |
| 2 | DH | Deadhead indicator | Blank or `DH` |
| 3 | FLT | Flight number | `956`, `5961`, `2755` |
| 4 | EQP | Equipment type | `76P`, `76W` |
| 5 | DEP | Departure airport | `SDF`, `MHR`, `DFW` |
| 6 | (L)Z | Departure time with day code | `(FR03)08:29` |
| 7 | M | Minutes portion (sometimes separate) | Part of time |
| 8 | ARR | Arrival airport | `MHR`, `ONT`, `RFD` |
| 9 | (L)Z | Arrival time with day code | `(05)13:05` |
| 10 | M | Minutes portion | Part of time |
| 11 | [TOG] | Time On Ground (optional) | `[03:03]`, `[04:52]` |
| 12 | BLK | Block time | `04:36`, `01:20`, `02:02` |
| 13 | DUTY | Duty time (per day total) | `05:51`, `08:22`, `12:03` |
| 14 | CR | Credit time with suffix | `04:36L`, `04:11D`, `06:01D` |
| 15 | L/O | Layover time | `025:27`, `037:51`, `010:27` |
| 16 | Cat. | Category code | `C` |

### Time Format Specifics
- **Departure time**: `(DayCode)HH:MM` where DayCode is 2-letter day + date number
  - Example: `(FR03)08:29` = Friday the 3rd at 08:29
  - Example: `(SA07)15:47` = Saturday the 7th at 15:47
- **Arrival time**: `(DD)HH:MM` where DD is just the date number
  - Example: `(05)13:05` = 5th day at 13:05

### Duty Day Grouping
- Multiple flights on same day share the same DAY code
- Duty/Credit/L/O totals appear after each duty day's flights
- Example structure:
  ```
  FR13  956  76P  SDF  (FR03)08:29  MHR(05)13:05        04:36
                                            04:36  05:51  04:36L  025:27  C
  SA14  5961 76P  MHR  (SA07)15:47  ONT(09)17:07  [03:03]  01:20
  SA14  2756 76P  ONT  (SA12)20:10  DFW(16)22:54        02:44
                                            04:04  08:22  04:11D  037:51
  ```

### Footer Totals
- **Credit**: Total credit time `HHH:MM` (e.g., "Credit: 027:59")
- **Blk**: Total block time `HHH:MM` (e.g., "Blk: 018:16")
- **Ldgs**: Number of landings (e.g., "Ldgs: 6.0")
- **TAFB**: Time Away From Base `HHH:MM` (e.g., "TAFB: 104:56")

### Credit Time Suffixes
- `L` = Leg credit
- `D` = Duty credit (daily minimum guarantee)
- `M` = Monthly/Minimum guarantee

### Key Parsing Rules
1. Day codes: `FR`=Friday, `SA`=Saturday, `SU`=Sunday, `MO`=Monday, `TU`=Tuesday, `WE`=Wednesday, `TH`=Thursday
2. Date numbers follow day code (FR13 = Friday the 13th)
3. Equipment codes: `76P`=767 Passenger, `76W`=767 Freighter, `75P`=757
4. Times in parentheses include day context for overnight flights
5. `[TOG]` in brackets is optional Time On Ground between connections

---

## Format 3: Trip Board Trip Details (image-1769245239.jpg)

### Overview
This is the detailed Trip Details modal view showing complete trip information with dates, pairings, and comprehensive time breakdowns.

### Header Information
- **Title**: `Trip Details - S#### - ### ###` (Trip ID - Base - Equipment)
  - Example: "Trip Details - S5055 - SDF 757"
- **Close Button**: Green "Close" button (top right)

### Main Table Columns (Left to Right)
| Column | Header | Description | Example |
|--------|--------|-------------|---------|
| 1 | Eqp | Equipment type | `DH` for deadhead, blank otherwise |
| 2 | Date | Date in M/DD/YY format | `1/11/26`, `1/13/26` |
| 3 | Pairing | Pairing ID | `S50558` |
| 4 | Flt | Flight number or `CML` | `CML`, `1327`, `2846` |
| 5 | Pos | Position (F/O, CA) | `F/O` |
| 6 | Dep | Departure airport | `SDF`, `ATL`, `MCO` |
| 7 | (L) | Departure day code | `(SU15)`, `(MO21)`, `(TU15)` |
| 8 | Z | Departure time | `20:37`, `02:09`, `21:30` |
| 9 | Arr | Arrival airport | `ATL`, `MCO`, `RFD` |
| 10 | (L) | Arrival day code | `(17)`, `(22)`, `(17)` |
| 11 | Z | Arrival time | `22:09`, `04:51`, `00:55` |
| 12 | Blk | Block time | `0:00`, `2:42`, `3:25` |
| 13 | Duty | Duty time (daily total) | `5:18`, `3:57`, `7:22` |
| 14 | Cr | Credit time | `4:00M`, `4:00M`, `4:32L` |
| 15 | L/O | Layover time | `24:14`, `15:24`, `14:58` |

### Time Format Specifics

**CRITICAL**: The time format is `(DayCode + LocalHour)ZuluTime` where:
- The number **inside the parentheses** is the **LOCAL hour**
- The time **after the parentheses** is the **ZULU time**
- Minutes are the same for both Local and Zulu

**How to extract LOCAL time:**
- Take the **hour from inside ()** + **minutes from the Zulu time**

**Examples:**
| Raw Format | Local Hour | Zulu Time | → LOCAL Time |
|------------|------------|-----------|--------------|
| `(FR14)19:00` | 14 | 19:00 | **14:00** |
| `(15)23:41` | 15 | 23:41 | **15:41** |
| `(FR17)01:16` | 17 | 01:16 | **17:16** |
| `(18)02:08` | 18 | 02:08 | **18:08** |
| `(SU06)14:30` | 06 | 14:30 | **06:30** |
| `(13)18:24` | 13 | 18:24 | **13:24** |

**Day Codes (optional, may be omitted on arrival times):**
- `SU` = Sunday, `MO` = Monday, `TU` = Tuesday, `WE` = Wednesday
- `TH` = Thursday, `FR` = Friday, `SA` = Saturday

### Special Rows
1. **DH (Deadhead) rows**: Have `DH` in Eqp column, `CML` as flight number, `0:00` block time
2. **Duty day summary rows**: Show totals after each duty day's flights
3. **Multi-leg days**: Multiple flight rows with same date, totals at end

### Footer Totals
- **Credit**: `HH:MMT` (e.g., "Credit: 43:42T") - T suffix for Total
- **Out Credit**: `H:MM` (e.g., "Out Credit: 0:00")
- **Blk**: `HH:MM` (e.g., "Blk: 29:13")
- **Prem**: Premium pay (e.g., "Prem: $0.00")
- **PDiem**: Per diem amount (e.g., "PDiem: $565.40")
- **TAFB**: Time Away From Base (e.g., "TAFB: 163:53")
- **Duty Days**: Number of duty days (e.g., "Duty Days: 7")

### Flight Type Indicators
- `CML` = Commercial/Deadhead flight (positioning, no block time)
- Regular flight numbers = Revenue flights
- `DH` prefix in Eqp column = Deadhead

### Credit Time Suffixes
- `M` = Minimum guarantee (e.g., "4:00M")
- `L` = Leg credit (e.g., "4:32L")
- `D` = Duty credit
- No suffix or `T` = Total/actual

### Key Parsing Rules
1. Date format is M/DD/YY (single digit month, 2-digit year)
2. Pairing ID stays constant throughout trip (S#####)
3. Position (F/O = First Officer, CA = Captain) stays constant
4. CML flights with DH are deadheads - no block time
5. Duty/Cr/L/O appear only on summary rows after each duty day
6. Parse times by extracting digits after day code parentheses

---

## Common Parsing Challenges

### OCR Variations
1. Day codes may be misread: `l4` instead of `14`, `I4` instead of `14`
2. Times may lose colons: `0829` instead of `08:29`
3. Table columns may fragment across lines
4. Parentheses may be misread as brackets

### Airport Code Filtering
Exclude these 3-letter codes that are NOT airports:
```
THE, AND, FOR, ARE, BUT, NOT, YOU, ALL, CAN, HAD, HER, WAS, ONE, OUR, OUT,
DAY, GET, HAS, HIM, HIS, HOW, ITS, LET, MAY, NEW, NOW, OLD, SEE, WAY, WHO,
BOY, DID, EQP, BLK, CRE, FLT, POS, ACT, EST, REP, WED, THU, FRI, SAT, SUN,
MON, TUE, JAN, FEB, MAR, APR, JUN, JUL, AUG, SEP, OCT, NOV, DEC, CRD, DHD,
TTL, TOT, MIN, MAX, AVG, DIS, CON, END, CML, DEP, ARR, TOG, CAT, LDG, LDGS,
CNX, PNR
```

### Common Valid Airport Codes
```
SDF, ATL, MCO, RFD, PHX, ONT, MIA, DFW, LAX, EWR, JFK, ORD, DEN, SFO, SEA,
BOS, IAD, IAH, MSP, DTW, PHL, CLT, LGA, FLL, BWI, SLC, SAN, TPA, AUS, HNL,
PDX, STL, BNA, OAK, SMF, SNA, MCI, RDU, CLE, IND, CMH, SAT, PIT, CVG, MKE,
OMA, ABQ, TUS, OKC, MEM, BUF, RNO, ANC, SJU, BOI, RSW, PBI, JAX, RIC, SYR,
ALB, BDL, PWM, MHT, PVD, MHR
```

---

## Detection Strategy

To classify which format an image is:

### Crew Access Trip Information
- Contains "Trip Information" or "Trip Id:"
- Has "Hotel details" and "Status: BOOKED"
- Uses full day names (Sunday, Monday) or abbreviations (Su, Mo)
- Route format: `XXX-YYY`

### Trip Board Browser
- Contains "Trip" followed by 4-digit number
- Contains "Report at" with time
- Has dark background theme
- Day codes: `FR13`, `SA14` format
- Times in `(DayNN)HH:MM` format

### Trip Board Trip Details
- Contains "Trip Details - S####"
- Has date column in M/DD/YY format
- Has Pairing column with S##### format
- Times in `(DayCodeDD)HH:MM` format
- Contains "Credit:", "Blk:", "TAFB:" footer

---

## Extracted Data Structure

### ParsedEvent
```typescript
{
  eventType: "FLIGHT" | "DEADHEAD" | "LAYOVER" | "HOTEL" | "TRANSPORT" | "REPORT" | "RELEASE"
  date?: string           // YYYY-MM-DD
  startTime?: string      // HH:MM
  endTime?: string        // HH:MM
  depAirport?: string     // 3-letter IATA code
  arrAirport?: string     // 3-letter IATA code
  flightNumber?: string   // 3-4 digits
  equipment?: string      // Aircraft type
  blockMinutes?: number   // Block time in minutes
  creditMinutes?: number  // Credit time in minutes
  dutyMinutes?: number    // Duty time in minutes
  layoverMinutes?: number // Layover time in minutes
  hotelName?: string
  hotelPhone?: string
  hotelBooked?: boolean
  transportNotes?: string
  transportPhone?: string
  isDeadhead?: boolean
}
```

### ParsedTotals
```typescript
{
  creditMinutes?: number    // Total credit time
  blockMinutes?: number     // Total block time
  tafbMinutes?: number      // Time Away From Base
  dutyDays?: number         // Number of duty days
  restMinutes?: number      // Total rest time
  perDiemCents?: number     // Per diem in cents
}
```
