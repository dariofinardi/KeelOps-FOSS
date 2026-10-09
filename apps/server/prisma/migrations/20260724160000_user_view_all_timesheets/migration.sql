-- Permesso solo-timesheet: vede i timesheet di tutti (default: no).
ALTER TABLE "User" ADD COLUMN "canViewAllTimesheets" BOOLEAN NOT NULL DEFAULT false;
