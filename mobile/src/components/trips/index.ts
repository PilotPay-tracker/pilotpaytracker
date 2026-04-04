/**
 * Trips Components Barrel Export
 */

// Core components
export { CreateTripModal } from './CreateTripModal';
export { OOOIEditor } from './OOOIEditor';
export { OOOICapture } from './OOOICapture';
export { AddLegModal } from './AddLegModal';

// Header components
export { TripsScreenHeader, type ViewMode, type TripFilter } from './TripsScreenHeader';

// View components
export { CalendarView } from './CalendarView';

// Detail components
export { TripDetailDrawer } from './TripDetailDrawer';

// Import modals
export { SmartImportModal, type SelectedImage, type ScheduleSourceType } from './SmartImportModal';

// Card components
export { TripBreakdownCard } from './TripBreakdownCard';
export { MonthPaySummaryCard, calcTripPay, type TripTotals, type TripPayInfo } from './EstTripPayCard';

// Empty states
export { EmptyTripsState } from './EmptyTripsState';

// Premium Logging (Phase 4 - VibeCodes)
export { LegPremiumLogger, type LegPremiumLoggerProps } from './LegPremiumLogger';
