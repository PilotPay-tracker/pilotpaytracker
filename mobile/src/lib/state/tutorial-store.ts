/**
 * Tutorial State Store
 *
 * Manages tutorial seen states per-screen.
 * Persisted to AsyncStorage and scoped per user (cleared on logout).
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { BACKEND_URL } from "@/lib/api";

// Tutorial IDs for each screen/feature
export type TutorialId =
  | "dashboard" // Main Dashboard/Home tab
  | "primary_upload" // Crew Access (Primary Schedule)
  | "secondary_upload" // Trip Board (Secondary Schedule)
  | "bid_award" // Trip Board Browser (Bid Award Technique)
  | "pay_summary" // Pay Summary screen
  | "log_event" // Log Event screen/tab
  | "records" // Records / Audit Trail tab
  | "career" // Career Stats tab
  | "tools" // Tools tab
  | "calendar" // Calendar screen
  | "trips" // Trips tab
  | "profile_setup" // Profile Setup screen
  | "retirement" // Retirement Planning (flagship feature)
  | "pay_events" // Pay Events management screen
  | "evidence_notes" // Evidence Notes & photo documentation
  | "annual_pay_planner" // Annual Pay Planner
  | "career_benchmarks" // Career Benchmarks / peer comparison
  | "year_summary" // Year Summary
  | "pay_calculator" // Pay Calculator
  | "sick_tracker" // Sick Day Tracker
  | "per_diem" // Per Diem Calculator
  | "projections"; // Pay Projections

// Tutorial content for each screen
export interface TutorialContent {
  id: TutorialId;
  title: string;
  steps: TutorialStep[];
}

export interface TutorialStep {
  title: string;
  description: string;
  icon?: string; // lucide icon name
  image?: string; // optional image URL to display
}

// Pre-defined tutorial content
export const TUTORIALS: Record<TutorialId, TutorialContent> = {
  dashboard: {
    id: "dashboard",
    title: "Welcome to PilotPay",
    steps: [
      {
        title: "Your Pay Command Center",
        description:
          "Welcome! This is your Dashboard - the central hub for tracking your pay, schedule, and flying career. Everything you need at a glance, designed by a pilot for pilots.",
        icon: "LayoutDashboard",
      },
      {
        title: "Pay Summary Card",
        description:
          "See your current and upcoming pay estimates right here. Tap to view the full Pay Summary with detailed breakdowns of Advance Pay (Small Check) and Settlement Pay (Big Check).",
        icon: "Wallet",
      },
      {
        title: "Quick Stats",
        description:
          "Your month-to-date credit hours, trips flown, and earnings are always visible. These update automatically as you upload schedules and log events.",
        icon: "TrendingUp",
      },
      {
        title: "Upcoming Trips",
        description:
          "See your next few trips at a glance with dates, routes, and credit hours. Tap any trip for full details including hotels and transportation.",
        icon: "Plane",
      },
      {
        title: "Navigation Tabs",
        description:
          "Use the tabs at the bottom to navigate: Trips (manage schedule), Log Event (add pay events), Records (audit trail), Career (lifetime stats), and Tools (calculators).",
        icon: "Navigation",
      },
      {
        title: "Getting Started",
        description:
          "To start: Go to Trips tab → tap '+' → upload a screenshot from Crew Access. The app will parse your schedule and populate everything automatically. Let's get flying!",
        icon: "Rocket",
      },
    ],
  },
  primary_upload: {
    id: "primary_upload",
    title: "Primary Schedule: Crew Access",
    steps: [
      {
        title: "What is Crew Access?",
        description:
          "Crew Access is your OFFICIAL schedule source. Once your schedule is published here, it's the source of truth for hotels, transportation, and trip details. Always use this after the schedule is officially released.",
        icon: "FileText",
      },
      {
        title: "Step 1: Open Crew Access",
        description:
          "On your company device or approved browser, log into Crew Access. Navigate to 'My Schedule' or 'Trips' section where your published schedule appears.",
        icon: "Globe",
      },
      {
        title: "Step 2: Select Your Trip",
        description:
          "Find the trip you want to upload. Tap or click on it to open the trip details page. Make sure you can see the trip number, dates, and flight legs.",
        icon: "Plane",
      },
      {
        title: "Step 3: Capture Hotel & Transport Info",
        description:
          "Scroll to see hotel name, phone number, and transportation details. These are ONLY available in Crew Access - not Trip Board. This is why we need your Primary upload.",
        icon: "Building",
      },
      {
        title: "Step 4: Screenshot & Upload",
        description:
          "Take a screenshot of the full trip page. Return to PilotPay, tap '+' to import, select 'Crew Access (Primary)', and upload your screenshot. The app will parse and save all details.",
        icon: "Camera",
      },
      {
        title: "What You Get",
        description:
          "After uploading: Your calendar populates, 'Call Hotel' and 'Call Transportation' buttons activate, and your pay credit is calculated. This is your official baseline.",
        icon: "CheckCircle2",
      },
    ],
  },
  secondary_upload: {
    id: "secondary_upload",
    title: "Secondary Schedule: Trip Board",
    steps: [
      {
        title: "What is Trip Board?",
        description:
          "Trip Board shows leg-by-leg detail: departure/arrival times, flight numbers, aircraft types, and block times. Use it to VERIFY credit and catch any discrepancies.",
        icon: "List",
      },
      {
        title: "When to Use Trip Board",
        description:
          "After you've uploaded from Crew Access (Primary), use Trip Board as your Secondary source to double-check leg times and credit. Great for verifying block times match what you flew.",
        icon: "Search",
      },
      {
        title: "Step 1: Open Trip Board",
        description:
          "Access Trip Board on your company system. Find the trip you want to verify by trip number or date.",
        icon: "Globe",
      },
      {
        title: "Step 2: Expand Leg Details",
        description:
          "Click on your trip to expand all legs. You should see each flight's departure time, arrival time, and block/credit times. Scroll to capture all legs.",
        icon: "Clock",
      },
      {
        title: "Step 3: Screenshot & Upload",
        description:
          "Screenshot the leg details. In PilotPay, tap '+', select 'Trip Board (Secondary)', and upload. The app compares this to your Primary data and flags any differences.",
        icon: "Camera",
      },
      {
        title: "Verification Complete",
        description:
          "Trip Board data supplements your Primary schedule. If credit hours differ, you'll see it flagged. This helps catch scheduling system errors before they affect your pay.",
        icon: "Shield",
      },
    ],
  },
  bid_award: {
    id: "bid_award",
    title: "Bid Award Technique",
    steps: [
      {
        title: "Why Use This Technique?",
        description:
          "When bids close, you know your awarded trips BEFORE they appear in Crew Access. This technique lets you populate your calendar 2-4 days early so you can plan ahead.",
        icon: "Sparkles",
      },
      {
        title: "Perfect Timing",
        description:
          "Use this IMMEDIATELY after bid awards are announced, but BEFORE your Crew Access schedule updates. Once Crew Access publishes, switch to Primary uploads instead.",
        icon: "Clock",
      },
      {
        title: "Step 1: Open Trip Board in Browser",
        description:
          "Log into Trip Board using a web browser (not the app). Navigate to your awarded bid month. Look for your awarded trip numbers in the list.",
        icon: "Globe",
      },
      {
        title: "Step 2: Click Your Awarded Trip",
        description:
          "Find your trip line (e.g., 'Trip 118 - 3 days'). Click it to open. If you have multiple trips awarded, you'll do this for each one separately.",
        icon: "MousePointer",
      },
      {
        title: "Step 3: Screenshot Each Day",
        description:
          "Important: Screenshot EACH DAY of the trip separately. A 4-day trip = 4 screenshots. This ensures the app can parse dates correctly and populate your calendar.",
        icon: "Camera",
      },
      {
        title: "Step 4: Upload All Screenshots",
        description:
          "In PilotPay, tap '+', select 'Bid Award Technique', and upload all your screenshots. Your calendar now shows your awarded trips before official publish!",
        icon: "Upload",
      },
      {
        title: "What Happens Next",
        description:
          "When Crew Access finally publishes, upload from there as Primary. The app compares versions and notifies you of any changes between bid award and final publish.",
        icon: "RefreshCw",
      },
    ],
  },
  pay_summary: {
    id: "pay_summary",
    title: "Understanding Pay Summary",
    steps: [
      {
        title: "Your Pay Dashboard",
        description:
          "This screen shows your estimated earnings for the current pay period. All numbers are calculated from your uploaded schedules and logged events - it's YOUR data, verified by YOU.",
        icon: "LayoutDashboard",
      },
      {
        title: "Two Checks Per Month",
        description:
          "UPS pilots are paid twice monthly: Advance Pay (Small Check) around the 7th, and Settlement Pay (Big Check) around the 22nd. Each check has different components.",
        icon: "Wallet",
      },
      {
        title: "Advance Pay (Small Check)",
        description:
          "Your Small Check is half your monthly guarantee (~37.5 hours × your rate). NO premiums, NO per diem, NO adjustments. It's an advance on your minimum guarantee.",
        icon: "DollarSign",
      },
      {
        title: "Settlement Pay (Big Check)",
        description:
          "Your Big Check settles the month: remaining guarantee + credit ABOVE guarantee + ALL premium pay (JA, Junior Man, overrides) + per diem + any adjustments. This is usually your larger check.",
        icon: "BadgeDollarSign",
      },
      {
        title: "How Late Arrivals Work",
        description:
          "When you log a Late Arrival, the app calculates Trip Total impact automatically. This amount appears in your Settlement Pay. Log events in the 'Log Event' screen.",
        icon: "AlertCircle",
      },
      {
        title: "Estimated vs Actual",
        description:
          "Remember: This is an ESTIMATE based on your inputs. Tax withholdings are approximations. Always verify against your official pay stub. This tool helps you PLAN, not replace payroll.",
        icon: "Info",
      },
    ],
  },
  log_event: {
    id: "log_event",
    title: "Logging Pay Events",
    steps: [
      {
        title: "What Are Pay Events?",
        description:
          "Pay Events track things that affect your pay beyond normal schedule: Late Arrivals, Premium Pay, JA assignments, duty extensions, reassignments, and more.",
        icon: "Plus",
      },
      {
        title: "Late Arrival Events",
        description:
          "If you arrive late due to company scheduling (not your fault), log it here. Enter the delay time and the app calculates Trip Total impact for your Settlement Pay.",
        icon: "Clock",
      },
      {
        title: "Premium Pay Events",
        description:
          "JA (Junior Available), Junior Manning, Holiday Pay, Override assignments - all premium pay events that add to your Big Check. Log them here with amounts.",
        icon: "Star",
      },
      {
        title: "Auto-Calculation",
        description:
          "Many events auto-calculate impact. Late Arrivals compute Trip Total based on your schedule. The app does the math - you just provide the facts.",
        icon: "Calculator",
      },
      {
        title: "Attach Proof (Optional)",
        description:
          "For your records, you can attach screenshots of crew messages, delay notices, or other proof. This helps if you ever need to dispute a pay discrepancy.",
        icon: "Paperclip",
      },
      {
        title: "Events → Pay Summary",
        description:
          "All logged events automatically flow into your Pay Summary and appear in your Records audit trail. Nothing gets lost - everything is tracked.",
        icon: "ArrowRight",
      },
    ],
  },
  records: {
    id: "records",
    title: "Records & Audit Trail",
    steps: [
      {
        title: "Your Personal Audit Trail",
        description:
          "Records keeps a complete history of everything: schedule uploads, version changes, pay events, and calculations. Every number in Pay Summary has a source you can verify.",
        icon: "FileSearch",
      },
      {
        title: "Why This Matters",
        description:
          "If you ever question a paycheck, Records shows exactly what data you uploaded and when. No guessing - you have timestamped proof of your schedule and events.",
        icon: "Shield",
      },
      {
        title: "Filter Your Records",
        description:
          "Too much data? Filter by pay period, trip number, event type, or date range. Find exactly what you need quickly.",
        icon: "Filter",
      },
      {
        title: "Version History",
        description:
          "Schedule changed? Records shows every version: v1 (baseline), v2 (updated), etc. See exactly what changed and when the company modified your trip.",
        icon: "History",
      },
      {
        title: "Privacy Protected",
        description:
          "Your Records are 100% private - scoped only to YOUR account. No one else (not even us) can see your data. When you log out, your local data is cleared.",
        icon: "Lock",
      },
      {
        title: "Export for Disputes",
        description:
          "Need to file a grievance or dispute pay? Export your Records as a report showing your original schedule, changes, and events. Professional documentation ready.",
        icon: "Download",
      },
    ],
  },
  career: {
    id: "career",
    title: "Career Statistics",
    steps: [
      {
        title: "Your Flying Career",
        description:
          "Career Stats tracks your cumulative totals: lifetime flight hours, total credit hours, trips flown, and earnings. See your professional journey at a glance.",
        icon: "TrendingUp",
      },
      {
        title: "Year-to-Date Progress",
        description:
          "Track your current year's flying: hours flown, earnings, average per trip. Compare to previous years to see trends.",
        icon: "Calendar",
      },
      {
        title: "Monthly Breakdown",
        description:
          "See each month's contribution: which months were heavy, which were light. Helps with tax planning and understanding your earning patterns.",
        icon: "BarChart2",
      },
      {
        title: "Set Goals",
        description:
          "Want to hit a certain number of hours or earnings this year? Career Stats helps you track progress toward personal milestones.",
        icon: "Target",
      },
    ],
  },
  tools: {
    id: "tools",
    title: "Pilot Tools",
    steps: [
      {
        title: "Quick Reference Tools",
        description:
          "Access calculators, reference charts, and utilities designed for pilots. Save time with tools built specifically for your needs.",
        icon: "Wrench",
      },
      {
        title: "Pay Calculators",
        description:
          "Estimate pay for scenarios: What if I pick up this trip? How much is JA worth? Quick calculations without spreadsheets.",
        icon: "Calculator",
      },
      {
        title: "Contract References",
        description:
          "Quick access to pay rules, premium rates, and CBA references. Know your contract rates without digging through documents.",
        icon: "BookOpen",
      },
    ],
  },
  calendar: {
    id: "calendar",
    title: "Schedule Calendar",
    steps: [
      {
        title: "Your Schedule at a Glance",
        description:
          "The Calendar shows all your trips, duty days, and time off in a familiar monthly view. Color-coded for quick scanning: trips, reserves, vacation, etc.",
        icon: "Calendar",
      },
      {
        title: "Tap for Details",
        description:
          "Tap any day to see full trip details: flights, times, hotels, transportation. Everything from your uploaded schedules, accessible in one tap.",
        icon: "MousePointer",
      },
      {
        title: "Trip Flow Visualization",
        description:
          "Multi-day trips show as connected blocks so you can see your flow at a glance. No more wondering 'where am I on the 15th?'",
        icon: "GitBranch",
      },
      {
        title: "Sync Status",
        description:
          "Calendar shows when data was last updated. If your schedule changed, you'll see which trips need fresh uploads.",
        icon: "RefreshCw",
      },
    ],
  },
  trips: {
    id: "trips",
    title: "How to Import Your Schedule",
    steps: [
      {
        title: "Your Trip Hub",
        description:
          "This screen shows all your trips for the selected month. See trip numbers, dates, destinations, and credit hours at a glance. Let's learn how to import your schedule!",
        icon: "Plane",
      },
      {
        title: "Step 1: Screenshot Your Schedule",
        description:
          "Open Crew Access on your device. Navigate to your trip details page showing the trip number, dates, and flight legs. Take a screenshot of the full trip page.",
        icon: "Camera",
        image: `${BACKEND_URL}/images/image-1769235204.jpeg`,
      },
      {
        title: "Step 2: Tap the + Button",
        description:
          "Back in the app, tap the '+' button in the top right corner to start the import process. This opens the import screen where you'll upload your screenshot.",
        icon: "Plus",
        image: `${BACKEND_URL}/images/image-1769233953.png`,
      },
      {
        title: "Step 3: Select & Upload",
        description:
          "Choose your screenshot from your photo library. The app will scan and extract trip details automatically - trip number, dates, legs, and credit hours.",
        icon: "Upload",
        image: `${BACKEND_URL}/images/image-1769233936.jpeg`,
      },
      {
        title: "One Screenshot at a Time",
        description:
          "IMPORTANT: Upload ONE schedule screenshot at a time, then wait for it to finish processing. This ensures accurate parsing and prevents rate limiting. You can upload the next one after the first completes.",
        icon: "AlertCircle",
      },
      {
        title: "Pay Protection Active",
        description:
          "If the company changes your trip later, PilotPay remembers your original credit. You always get paid the HIGHER of original vs current schedule. Your pay is protected automatically!",
        icon: "Shield",
      },
    ],
  },
  profile_setup: {
    id: "profile_setup",
    title: "Profile Setup",
    steps: [
      {
        title: "Accurate Pay Calculations",
        description:
          "Your profile info powers all pay calculations. Enter accurate data so your estimates match reality. Takes 2 minutes, saves hours of confusion.",
        icon: "User",
      },
      {
        title: "Hourly Rate",
        description:
          "Enter your current hourly rate from the pay scale. This is used for all credit-based calculations. Update it when you get a raise!",
        icon: "DollarSign",
      },
      {
        title: "Position & Equipment",
        description:
          "Captain or First Officer? Which aircraft type? These affect pay rules and calculations specific to your seat.",
        icon: "Settings",
      },
      {
        title: "Tax Settings",
        description:
          "Set your state of residence and filing status for accurate net pay estimates. Remember: these are ESTIMATES, not tax advice.",
        icon: "Receipt",
      },
      {
        title: "Keep It Updated",
        description:
          "Change seat? New pay rate? Different base? Update your profile so calculations stay accurate. Settings are in the menu anytime.",
        icon: "RefreshCw",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────
  // FLAGSHIP: Retirement Planning
  // ─────────────────────────────────────────────────────────────
  retirement: {
    id: "retirement",
    title: "Retirement Planning",
    steps: [
      {
        title: "Your Retirement Command Center",
        description:
          "PilotPay's Retirement feature is the most comprehensive UPS pilot retirement calculator available. It uses the exact CBA 2023–2028 pension formulas to project your real numbers — not generic estimates.",
        icon: "TrendingUp",
      },
      {
        title: "Plan A Pension — Two Formulas",
        description:
          "Your Plan A pension is calculated two ways and you receive the HIGHER of the two: (1) 1% × Final Average Earnings × Years of Service, or (2) a flat dollar amount per year of service ($4,200/YOS for Captains, $3,360/YOS for FOs). PilotPay does both automatically.",
        icon: "Calculator",
      },
      {
        title: "Plan B — Money Purchase Pension",
        description:
          "UPS contributes 12% of your pensionable earnings into Plan B. PilotPay tracks this year by year, projects the balance growth, and converts it into a monthly income stream at your target retirement age.",
        icon: "PiggyBank",
      },
      {
        title: "VEBA / HRA Medical Benefit",
        description:
          "You accumulate $1/hour worked into your VEBA trust while flying, then receive $6,250/year in health reimbursement after retirement. PilotPay projects your VEBA balance and shows your post-retirement medical benefit.",
        icon: "Heart",
      },
      {
        title: "Retire at 60, 62, or 65?",
        description:
          "The multi-age forecast shows your pension income at three different retirement ages side by side. See exactly how much each additional year of flying adds to your monthly pension — a powerful tool for deciding WHEN to retire.",
        icon: "Calendar",
      },
      {
        title: "FO vs Captain Scenarios",
        description:
          "Should you upgrade? The dual-scenario comparison runs your full career two ways — staying FO vs upgrading to Captain — and shows the total lifetime income difference. Many pilots are surprised by the actual numbers.",
        icon: "ArrowUpRight",
      },
      {
        title: "Set Up Your Retirement Profile",
        description:
          "Tap 'Update Retirement Profile' to enter your Date of Hire, Date of Birth, seat type, and target retirement age. The more accurate your inputs, the more precise your forecast. Your data never leaves your device.",
        icon: "Settings",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────
  // Pay Events Management
  // ─────────────────────────────────────────────────────────────
  pay_events: {
    id: "pay_events",
    title: "Pay Events",
    steps: [
      {
        title: "All Your Pay Events",
        description:
          "This screen shows every pay event you've logged: late arrivals, premium pay, JA assignments, duty extensions, and more. It's a complete register of everything affecting your Settlement Pay.",
        icon: "List",
      },
      {
        title: "What Counts as a Pay Event?",
        description:
          "Anything that modifies pay beyond your base schedule: Late Arrivals (Trip Total impact), Junior Available (JA), Junior Manning, Holiday Pay, Override pay, and other contract-defined premiums.",
        icon: "DollarSign",
      },
      {
        title: "Edit or Resolve",
        description:
          "Tap any event to review details, update amounts, mark it as resolved, or attach evidence. Keeping events current ensures your Pay Summary stays accurate.",
        icon: "Edit3",
      },
      {
        title: "Evidence Attached",
        description:
          "Events with attached notes or photos show a paperclip badge. Evidence helps you document disputes and provides a paper trail if you need to file a grievance.",
        icon: "Paperclip",
      },
      {
        title: "Flows Into Pay Summary",
        description:
          "Every open event is factored into your Settlement Pay estimate automatically. Resolve events once they appear correctly on your paycheck so your running totals stay clean.",
        icon: "ArrowRight",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────
  // Evidence Notes
  // ─────────────────────────────────────────────────────────────
  evidence_notes: {
    id: "evidence_notes",
    title: "Evidence & Documentation",
    steps: [
      {
        title: "Document What Happened",
        description:
          "Write a clear narrative of the event: what occurred, when, who was involved, and what the pay impact was. Your notes are timestamped and stored securely with the associated pay event.",
        icon: "FileText",
      },
      {
        title: "Attach a Screenshot",
        description:
          "Photograph or upload a screenshot of the crew message, ACARS, delay notice, or any relevant documentation. A picture is worth a thousand words when disputing pay.",
        icon: "Camera",
      },
      {
        title: "Building a Grievance File",
        description:
          "If pay discrepancies become a pattern, your documented evidence makes a strong foundation for a grievance. Professional, timestamped records outperform memory every time.",
        icon: "Shield",
      },
      {
        title: "Private & Secure",
        description:
          "Evidence notes are stored privately in your account. Only you can see them. They travel with the pay event record so everything stays organized.",
        icon: "Lock",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────
  // Annual Pay Planner
  // ─────────────────────────────────────────────────────────────
  annual_pay_planner: {
    id: "annual_pay_planner",
    title: "Annual Pay Planner",
    steps: [
      {
        title: "Plan Your Year",
        description:
          "The Annual Pay Planner lets you set earning goals, plan vacation, and see how your year is tracking against your target. Build your financial plan month by month.",
        icon: "Calendar",
      },
      {
        title: "Set Your Annual Target",
        description:
          "Enter the gross pay you want to earn this year. The planner distributes your target across the remaining months and shows you exactly what each month needs to look like.",
        icon: "Target",
      },
      {
        title: "Actual vs Plan",
        description:
          "As months complete, your actual earnings populate automatically from your uploaded schedules. See at a glance whether you're ahead, behind, or on track for your annual goal.",
        icon: "BarChart2",
      },
      {
        title: "Adjust for Vacations & Leave",
        description:
          "Mark months where you'll take vacation, sick leave, or training. The planner recalculates your remaining monthly targets so you can plan realistically.",
        icon: "Plane",
      },
      {
        title: "Tax Planning Insight",
        description:
          "Seeing your full-year earnings projection helps you estimate tax liability, decide on retirement contributions, and avoid year-end surprises. Financial planning starts with knowing your number.",
        icon: "Receipt",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────
  // Career Benchmarks
  // ─────────────────────────────────────────────────────────────
  career_benchmarks: {
    id: "career_benchmarks",
    title: "Career Benchmarks",
    steps: [
      {
        title: "How Do You Compare?",
        description:
          "Career Benchmarks shows how your earnings and credit hours compare to peers at the same seniority level and seat type. Know exactly where you stand in the UPS pilot pay scale.",
        icon: "Award",
      },
      {
        title: "Benchmark Data",
        description:
          "Comparisons are based on the current CBA pay tables for your year of service and position. You see what a pilot at your step SHOULD be earning — useful for spotting underpayment.",
        icon: "BarChart2",
      },
      {
        title: "Upgrade Impact Modeling",
        description:
          "See the projected earnings difference between staying FO and upgrading to Captain at various seniority points. Quantify the upgrade decision with real contract rates — not guesswork.",
        icon: "ArrowUpRight",
      },
      {
        title: "Insight Cards",
        description:
          "The app generates personalized career insights based on your profile: break-even analysis for upgrading, senior FO viability assessment, and retirement impact of different career paths.",
        icon: "Lightbulb",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────
  // Year Summary
  // ─────────────────────────────────────────────────────────────
  year_summary: {
    id: "year_summary",
    title: "Year Summary",
    steps: [
      {
        title: "Your Annual Snapshot",
        description:
          "Year Summary compiles your full calendar year: total gross earnings, total credit hours, trips flown, and a month-by-month breakdown. The definitive record of your flying year.",
        icon: "BarChart2",
      },
      {
        title: "Month-by-Month Breakdown",
        description:
          "See which months were your highest earners and which were lighter. Understanding your earning patterns helps you bid smarter and plan finances more accurately.",
        icon: "Calendar",
      },
      {
        title: "Year-Over-Year Comparison",
        description:
          "Compare the current year against previous years. Track whether your career is growing, how raises have impacted total pay, and how many hours you typically fly per year.",
        icon: "TrendingUp",
      },
      {
        title: "Tax Reference",
        description:
          "Your Year Summary is a convenient reference for tax preparation, retirement contribution planning, and answering the perennial question: 'How much did I actually make this year?'",
        icon: "Receipt",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────
  // Pay Calculator
  // ─────────────────────────────────────────────────────────────
  pay_calculator: {
    id: "pay_calculator",
    title: "Pay Calculator",
    steps: [
      {
        title: "What-If Pay Scenarios",
        description:
          "The Pay Calculator lets you quickly estimate pay for any scenario: picking up a trip, adding JA hours, checking what a specific override would pay. Fast answers without spreadsheets.",
        icon: "Calculator",
      },
      {
        title: "Credit Hours → Dollars",
        description:
          "Enter credit hours and the calculator applies your current hourly rate, guaranteed minimums, and any applicable override rules. The result is what you'd see on your Settlement Pay.",
        icon: "DollarSign",
      },
      {
        title: "Premium Pay Included",
        description:
          "Toggle premium pay types — JA, Junior Manning, Holiday — to see how they stack with base credit. Know the total value of a pickup BEFORE you take it.",
        icon: "Star",
      },
      {
        title: "Gross vs Net Estimate",
        description:
          "See both gross pay and an estimated net after federal and state withholding. A helpful gut-check for planning monthly cash flow.",
        icon: "Wallet",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────
  // Sick Tracker
  // ─────────────────────────────────────────────────────────────
  sick_tracker: {
    id: "sick_tracker",
    title: "Sick Day Tracker",
    steps: [
      {
        title: "Track Your Sick Bank",
        description:
          "The Sick Tracker keeps a running log of your sick leave balance — hours accrued, hours used, and your current bank. Your sick balance has real financial value at retirement.",
        icon: "Heart",
      },
      {
        title: "Sick Leave & Retirement",
        description:
          "Under the UPS CBA, accumulated sick leave is paid out as a one-time lump sum when you retire. Every hour you preserve is money in your pocket at the end of your career. PilotPay tracks this for you.",
        icon: "TrendingUp",
      },
      {
        title: "Log Sick Events",
        description:
          "When you use sick leave, log it here with the date and hours. The tracker deducts from your balance and maintains an accurate history. Useful for verifying company records.",
        icon: "Plus",
      },
      {
        title: "Retirement Payout Projection",
        description:
          "The tracker shows an estimated sick leave payout value at retirement based on your current balance and projected accruals. A compelling reminder of why protecting your sick bank matters.",
        icon: "DollarSign",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────
  // Per Diem
  // ─────────────────────────────────────────────────────────────
  per_diem: {
    id: "per_diem",
    title: "Per Diem Calculator",
    steps: [
      {
        title: "Your Away-From-Base Pay",
        description:
          "Per diem is tax-advantaged pay for every hour away from your domicile. It adds up significantly over a career — PilotPay calculates it precisely from your actual schedule.",
        icon: "Utensils",
      },
      {
        title: "Automatic from Schedule",
        description:
          "When you upload your schedule, per diem is calculated automatically from your actual departure and arrival times at domicile. No manual tracking needed.",
        icon: "Clock",
      },
      {
        title: "Current Per Diem Rate",
        description:
          "The calculator uses the current CBA per diem rate. It applies the correct domicile-away logic: counting from actual report time out to release time back at base.",
        icon: "DollarSign",
      },
      {
        title: "Monthly & Annual Totals",
        description:
          "See your per diem broken down by trip, by month, and for the full year. Many pilots are surprised how much per diem contributes to total compensation — often $10,000–$20,000+ annually.",
        icon: "TrendingUp",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────
  // Pay Projections
  // ─────────────────────────────────────────────────────────────
  projections: {
    id: "projections",
    title: "Pay Projections",
    steps: [
      {
        title: "See Your Pay Future",
        description:
          "Pay Projections forecasts your earnings for upcoming months and years based on your current schedule, contract rates, and expected raises. Know what's coming before it lands.",
        icon: "TrendingUp",
      },
      {
        title: "Contract Step Progression",
        description:
          "As you gain years of service, your hourly rate increases. Projections models your pay at each future contract step so you can plan for the raises built into your career.",
        icon: "ArrowUpRight",
      },
      {
        title: "Scenario Comparison",
        description:
          "Compare 'stay FO' vs 'upgrade to Captain' projections side by side. See the breakeven point and the total 5-year, 10-year, and career earnings difference between paths.",
        icon: "BarChart2",
      },
      {
        title: "Retirement Integration",
        description:
          "Projections feed directly into the Retirement calculator. Higher projected earnings mean a higher Final Average Earnings (FAE), which directly increases your Plan A pension. It all connects.",
        icon: "Target",
      },
    ],
  },
};

interface TutorialState {
  // Map of tutorial ID to whether it's been seen
  seenTutorials: Record<string, boolean>;
  // Whether to show tutorials at all
  tutorialsEnabled: boolean;

  // Actions
  markTutorialSeen: (id: TutorialId) => void;
  markTutorialUnseen: (id: TutorialId) => void;
  resetAllTutorials: () => void;
  setTutorialsEnabled: (enabled: boolean) => void;
  hasSeen: (id: TutorialId) => boolean;
}

export const useTutorialStore = create<TutorialState>()(
  persist(
    (set, get) => ({
      seenTutorials: {},
      tutorialsEnabled: true,

      markTutorialSeen: (id) =>
        set((state) => ({
          seenTutorials: { ...state.seenTutorials, [id]: true },
        })),

      markTutorialUnseen: (id) =>
        set((state) => ({
          seenTutorials: { ...state.seenTutorials, [id]: false },
        })),

      resetAllTutorials: () =>
        set({
          seenTutorials: {},
        }),

      setTutorialsEnabled: (enabled) =>
        set({ tutorialsEnabled: enabled }),

      hasSeen: (id) => get().seenTutorials[id] === true,
    }),
    {
      name: "tutorial-state-storage",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        seenTutorials: state.seenTutorials,
        tutorialsEnabled: state.tutorialsEnabled,
      }),
    }
  )
);

// Selectors
export const useHasSeenTutorial = (id: TutorialId) =>
  useTutorialStore((s) => s.seenTutorials[id] === true);

export const useTutorialsEnabled = () =>
  useTutorialStore((s) => s.tutorialsEnabled);

export const useTutorialActions = () =>
  useTutorialStore((s) => ({
    markTutorialSeen: s.markTutorialSeen,
    markTutorialUnseen: s.markTutorialUnseen,
    resetAllTutorials: s.resetAllTutorials,
    setTutorialsEnabled: s.setTutorialsEnabled,
  }));
