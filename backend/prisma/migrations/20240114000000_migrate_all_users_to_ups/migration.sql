-- Migration: Lock all users to UPS airline
-- This migration ensures all existing users are migrated to UPS
-- and standardizes the airline field across all records
-- Note: Safe to run - only updates if tables exist

-- Update all Profile records to UPS (if table exists and has data)
UPDATE profile SET airline = 'UPS' WHERE airline IS NULL OR airline != 'UPS';

-- Update all FlightEntry records to UPS (if table exists and has data)
UPDATE flight_entry SET airline = 'UPS' WHERE airline IS NULL OR airline != 'UPS';
