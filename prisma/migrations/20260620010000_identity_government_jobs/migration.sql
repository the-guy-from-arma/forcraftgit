-- FairCroft CoreOne identity, DMV, passport, and assigned-job workflow.
-- PostgreSQL only. Safe for Railway migrate deploy.

ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'unverified_civ';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'government_employee';
ALTER TYPE "DepartmentType" ADD VALUE IF NOT EXISTS 'government';

ALTER TABLE "CivilianProfile"
  ADD COLUMN IF NOT EXISTS "characterPhotoUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "characterPhotoNoticeAccepted" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "verificationStatus" TEXT NOT NULL DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS "passportNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "passportStatus" "RecordStatus" NOT NULL DEFAULT 'inactive';

ALTER TABLE "DepartmentMembership"
  ADD COLUMN IF NOT EXISTS "jobTitle" TEXT,
  ADD COLUMN IF NOT EXISTS "division" TEXT,
  ADD COLUMN IF NOT EXISTS "station" TEXT,
  ADD COLUMN IF NOT EXISTS "callSign" TEXT;

CREATE TABLE IF NOT EXISTS "GovernmentApplication" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "status" "ApplicationStatus" NOT NULL DEFAULT 'pending',
  "payload" JSONB NOT NULL DEFAULT '{}',
  "decisionReason" TEXT,
  "reviewedById" TEXT,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),

  CONSTRAINT "GovernmentApplication_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CivilianProfile_passportNumber_key" ON "CivilianProfile"("passportNumber");
CREATE INDEX IF NOT EXISTS "CivilianProfile_verificationStatus_idx" ON "CivilianProfile"("verificationStatus");
CREATE INDEX IF NOT EXISTS "CivilianProfile_passportNumber_idx" ON "CivilianProfile"("passportNumber");
CREATE INDEX IF NOT EXISTS "DepartmentMembership_jobTitle_idx" ON "DepartmentMembership"("jobTitle");
CREATE INDEX IF NOT EXISTS "GovernmentApplication_userId_idx" ON "GovernmentApplication"("userId");
CREATE INDEX IF NOT EXISTS "GovernmentApplication_type_idx" ON "GovernmentApplication"("type");
CREATE INDEX IF NOT EXISTS "GovernmentApplication_status_idx" ON "GovernmentApplication"("status");
CREATE INDEX IF NOT EXISTS "GovernmentApplication_submittedAt_idx" ON "GovernmentApplication"("submittedAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'GovernmentApplication_userId_fkey'
  ) THEN
    ALTER TABLE "GovernmentApplication"
      ADD CONSTRAINT "GovernmentApplication_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'GovernmentApplication_reviewedById_fkey'
  ) THEN
    ALTER TABLE "GovernmentApplication"
      ADD CONSTRAINT "GovernmentApplication_reviewedById_fkey"
      FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
