-- Add payYear and hourlyRateSource to Profile
ALTER TABLE "profile" ADD COLUMN "payYear" INTEGER;
ALTER TABLE "profile" ADD COLUMN "hourlyRateSource" TEXT;
