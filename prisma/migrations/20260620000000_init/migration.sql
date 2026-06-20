-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('civilian', 'pending_department', 'police', 'sheriff', 'fire', 'ems', 'dispatcher', 'department_supervisor', 'site_admin', 'owner');

-- CreateEnum
CREATE TYPE "DepartmentType" AS ENUM ('police', 'sheriff', 'fire', 'ems', 'dispatch');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('pending', 'approved', 'denied');

-- CreateEnum
CREATE TYPE "UnitStatus" AS ENUM ('TEN_8_AVAILABLE', 'TEN_6_BUSY', 'TEN_7_OUT_OF_SERVICE', 'TEN_23_ON_SCENE', 'TEN_97_EN_ROUTE', 'TEN_15_TRANSPORTING', 'CODE_4_CLEAR', 'PRIORITY_RESPONSE');

-- CreateEnum
CREATE TYPE "Call911Status" AS ENUM ('queued', 'accepted', 'converted', 'closed', 'cancelled');

-- CreateEnum
CREATE TYPE "CadCallStatus" AS ENUM ('pending', 'active', 'assigned', 'on_scene', 'closed', 'cancelled');

-- CreateEnum
CREATE TYPE "PriorityLevel" AS ENUM ('low', 'routine', 'priority', 'emergency');

-- CreateEnum
CREATE TYPE "RecordStatus" AS ENUM ('active', 'inactive', 'expired', 'revoked', 'closed', 'voided');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('draft', 'submitted', 'approved', 'voided');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "username" TEXT,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'civilian',
    "suspended" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CivilianProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "dateOfBirth" TIMESTAMP(3),
    "address" TEXT,
    "city" TEXT DEFAULT 'FairCroft',
    "state" TEXT DEFAULT 'FC',
    "postalCode" TEXT,
    "phone" TEXT,
    "notes" TEXT,
    "recordFlags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CivilianProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "DepartmentType" NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DepartmentApplication" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "desiredRole" "UserRole",
    "statement" TEXT NOT NULL,
    "experience" TEXT,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'pending',
    "decisionReason" TEXT,
    "reviewedById" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "DepartmentApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DepartmentMembership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "rankId" TEXT,
    "role" "UserRole" NOT NULL,
    "badgeNumber" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DepartmentMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rank" (
    "id" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "permissions" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "Rank_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "color" TEXT NOT NULL,
    "plate" TEXT NOT NULL,
    "vin" TEXT,
    "registrationStatus" "RecordStatus" NOT NULL DEFAULT 'active',
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "License" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "class" TEXT NOT NULL DEFAULT 'D',
    "status" "RecordStatus" NOT NULL DEFAULT 'active',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "restrictions" TEXT,

    CONSTRAINT "License_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'active',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "Permit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Warrant" (
    "id" TEXT NOT NULL,
    "warrantNumber" TEXT NOT NULL,
    "subjectId" TEXT,
    "subjectName" TEXT NOT NULL,
    "dateOfBirth" TIMESTAMP(3),
    "charges" TEXT NOT NULL,
    "issuingCourt" TEXT NOT NULL DEFAULT 'FairCroft Municipal Court',
    "status" "RecordStatus" NOT NULL DEFAULT 'active',
    "severity" "PriorityLevel" NOT NULL DEFAULT 'routine',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Warrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Citation" (
    "id" TEXT NOT NULL,
    "citationNumber" TEXT NOT NULL,
    "userId" TEXT,
    "subjectName" TEXT NOT NULL,
    "officerId" TEXT,
    "statute" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "fineCents" INTEGER NOT NULL DEFAULT 0,
    "status" "RecordStatus" NOT NULL DEFAULT 'active',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "location" TEXT,

    CONSTRAINT "Citation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentReport" (
    "id" TEXT NOT NULL,
    "cadCallId" TEXT,
    "authorId" TEXT NOT NULL,
    "departmentId" TEXT,
    "reportNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "narrative" TEXT NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'submitted',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncidentReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArrestReport" (
    "id" TEXT NOT NULL,
    "cadCallId" TEXT,
    "arrestingOfficerId" TEXT NOT NULL,
    "subjectName" TEXT NOT NULL,
    "charges" TEXT NOT NULL,
    "narrative" TEXT NOT NULL,
    "bookingNumber" TEXT NOT NULL,
    "reportNumber" TEXT NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'submitted',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArrestReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FireReport" (
    "id" TEXT NOT NULL,
    "cadCallId" TEXT,
    "authorId" TEXT NOT NULL,
    "reportNumber" TEXT NOT NULL,
    "incidentType" TEXT NOT NULL,
    "cause" TEXT,
    "actions" TEXT NOT NULL,
    "narrative" TEXT NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'submitted',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FireReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EMSReport" (
    "id" TEXT NOT NULL,
    "cadCallId" TEXT,
    "authorId" TEXT NOT NULL,
    "reportNumber" TEXT NOT NULL,
    "patientName" TEXT NOT NULL,
    "patientAge" INTEGER,
    "chiefComplaint" TEXT NOT NULL,
    "careProvided" TEXT NOT NULL,
    "disposition" TEXT NOT NULL,
    "roleplayOnly" BOOLEAN NOT NULL DEFAULT true,
    "status" "ReportStatus" NOT NULL DEFAULT 'submitted',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EMSReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Call911" (
    "id" TEXT NOT NULL,
    "callNumber" TEXT NOT NULL,
    "callerId" TEXT,
    "emergencyType" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "callerName" TEXT NOT NULL,
    "callbackNumber" TEXT NOT NULL,
    "status" "Call911Status" NOT NULL DEFAULT 'queued',
    "priority" "PriorityLevel" NOT NULL DEFAULT 'emergency',
    "acceptedById" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Call911_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CadCall" (
    "id" TEXT NOT NULL,
    "call911Id" TEXT,
    "departmentId" TEXT,
    "callNumber" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priority" "PriorityLevel" NOT NULL DEFAULT 'routine',
    "status" "CadCallStatus" NOT NULL DEFAULT 'active',
    "createdById" TEXT,
    "acceptedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "CadCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CadUnit" (
    "id" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "userId" TEXT,
    "unitNumber" TEXT NOT NULL,
    "status" "UnitStatus" NOT NULL DEFAULT 'TEN_8_AVAILABLE',
    "currentLocation" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CadUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnitAssignment" (
    "id" TEXT NOT NULL,
    "cadCallId" TEXT NOT NULL,
    "cadUnitId" TEXT NOT NULL,
    "departmentId" TEXT,
    "assignedById" TEXT,
    "status" TEXT NOT NULL DEFAULT 'assigned',
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clearedAt" TIMESTAMP(3),

    CONSTRAINT "UnitAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bolo" (
    "id" TEXT NOT NULL,
    "boloNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "plate" TEXT,
    "personName" TEXT,
    "vehicleDescription" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'active',
    "createdById" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bolo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DispatchMessage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'dispatch',
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DispatchMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'system',
    "read" BOOLEAN NOT NULL DEFAULT false,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CadCallNote" (
    "id" TEXT NOT NULL,
    "cadCallId" TEXT NOT NULL,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CadCallNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CadStatusHistory" (
    "id" TEXT NOT NULL,
    "cadCallId" TEXT NOT NULL,
    "fromStatus" "CadCallStatus",
    "toStatus" "CadCallStatus" NOT NULL,
    "actorId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CadStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DispatchLog" (
    "id" TEXT NOT NULL,
    "cadCallId" TEXT,
    "call911Id" TEXT,
    "dispatcherId" TEXT,
    "action" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DispatchLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GovernmentAnnouncement" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "audience" TEXT NOT NULL DEFAULT 'all',
    "priority" "PriorityLevel" NOT NULL DEFAULT 'routine',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "authorId" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GovernmentAnnouncement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DepartmentBulletin" (
    "id" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "authorId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "priority" "PriorityLevel" NOT NULL DEFAULT 'routine',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DepartmentBulletin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "departmentId" TEXT,
    "assignedById" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'assigned',
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RadioLog" (
    "id" TEXT NOT NULL,
    "departmentId" TEXT,
    "cadCallId" TEXT,
    "unitId" TEXT,
    "userId" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'dispatch',
    "code" TEXT,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RadioLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "departmentId" TEXT,
    "unitId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'on_duty',
    "clockInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clockOutAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShiftLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL DEFAULT '{}',
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServerConfiguration" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL DEFAULT '{}',
    "environment" TEXT NOT NULL DEFAULT 'all',
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServerConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_username_idx" ON "User"("username");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_suspended_idx" ON "User"("suspended");

-- CreateIndex
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CivilianProfile_userId_key" ON "CivilianProfile"("userId");

-- CreateIndex
CREATE INDEX "CivilianProfile_lastName_firstName_idx" ON "CivilianProfile"("lastName", "firstName");

-- CreateIndex
CREATE INDEX "CivilianProfile_city_state_idx" ON "CivilianProfile"("city", "state");

-- CreateIndex
CREATE UNIQUE INDEX "Department_code_key" ON "Department"("code");

-- CreateIndex
CREATE INDEX "Department_type_idx" ON "Department"("type");

-- CreateIndex
CREATE INDEX "Department_isActive_idx" ON "Department"("isActive");

-- CreateIndex
CREATE INDEX "DepartmentApplication_status_idx" ON "DepartmentApplication"("status");

-- CreateIndex
CREATE INDEX "DepartmentApplication_submittedAt_idx" ON "DepartmentApplication"("submittedAt");

-- CreateIndex
CREATE INDEX "DepartmentApplication_departmentId_status_idx" ON "DepartmentApplication"("departmentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DepartmentApplication_userId_departmentId_status_key" ON "DepartmentApplication"("userId", "departmentId", "status");

-- CreateIndex
CREATE INDEX "DepartmentMembership_departmentId_active_idx" ON "DepartmentMembership"("departmentId", "active");

-- CreateIndex
CREATE INDEX "DepartmentMembership_userId_active_idx" ON "DepartmentMembership"("userId", "active");

-- CreateIndex
CREATE INDEX "DepartmentMembership_role_idx" ON "DepartmentMembership"("role");

-- CreateIndex
CREATE UNIQUE INDEX "DepartmentMembership_userId_departmentId_key" ON "DepartmentMembership"("userId", "departmentId");

-- CreateIndex
CREATE INDEX "Rank_departmentId_level_idx" ON "Rank"("departmentId", "level");

-- CreateIndex
CREATE UNIQUE INDEX "Rank_departmentId_name_key" ON "Rank"("departmentId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_plate_key" ON "Vehicle"("plate");

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_vin_key" ON "Vehicle"("vin");

-- CreateIndex
CREATE INDEX "Vehicle_ownerId_idx" ON "Vehicle"("ownerId");

-- CreateIndex
CREATE INDEX "Vehicle_plate_idx" ON "Vehicle"("plate");

-- CreateIndex
CREATE INDEX "Vehicle_registrationStatus_idx" ON "Vehicle"("registrationStatus");

-- CreateIndex
CREATE INDEX "Vehicle_expiresAt_idx" ON "Vehicle"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "License_number_key" ON "License"("number");

-- CreateIndex
CREATE INDEX "License_userId_idx" ON "License"("userId");

-- CreateIndex
CREATE INDEX "License_number_idx" ON "License"("number");

-- CreateIndex
CREATE INDEX "License_status_idx" ON "License"("status");

-- CreateIndex
CREATE INDEX "License_expiresAt_idx" ON "License"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Permit_number_key" ON "Permit"("number");

-- CreateIndex
CREATE INDEX "Permit_userId_idx" ON "Permit"("userId");

-- CreateIndex
CREATE INDEX "Permit_number_idx" ON "Permit"("number");

-- CreateIndex
CREATE INDEX "Permit_status_idx" ON "Permit"("status");

-- CreateIndex
CREATE INDEX "Permit_type_idx" ON "Permit"("type");

-- CreateIndex
CREATE UNIQUE INDEX "Warrant_warrantNumber_key" ON "Warrant"("warrantNumber");

-- CreateIndex
CREATE INDEX "Warrant_warrantNumber_idx" ON "Warrant"("warrantNumber");

-- CreateIndex
CREATE INDEX "Warrant_subjectName_idx" ON "Warrant"("subjectName");

-- CreateIndex
CREATE INDEX "Warrant_status_idx" ON "Warrant"("status");

-- CreateIndex
CREATE INDEX "Warrant_severity_idx" ON "Warrant"("severity");

-- CreateIndex
CREATE INDEX "Warrant_issuedAt_idx" ON "Warrant"("issuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Citation_citationNumber_key" ON "Citation"("citationNumber");

-- CreateIndex
CREATE INDEX "Citation_citationNumber_idx" ON "Citation"("citationNumber");

-- CreateIndex
CREATE INDEX "Citation_userId_idx" ON "Citation"("userId");

-- CreateIndex
CREATE INDEX "Citation_officerId_idx" ON "Citation"("officerId");

-- CreateIndex
CREATE INDEX "Citation_subjectName_idx" ON "Citation"("subjectName");

-- CreateIndex
CREATE INDEX "Citation_status_idx" ON "Citation"("status");

-- CreateIndex
CREATE INDEX "Citation_issuedAt_idx" ON "Citation"("issuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "IncidentReport_reportNumber_key" ON "IncidentReport"("reportNumber");

-- CreateIndex
CREATE INDEX "IncidentReport_reportNumber_idx" ON "IncidentReport"("reportNumber");

-- CreateIndex
CREATE INDEX "IncidentReport_cadCallId_idx" ON "IncidentReport"("cadCallId");

-- CreateIndex
CREATE INDEX "IncidentReport_authorId_idx" ON "IncidentReport"("authorId");

-- CreateIndex
CREATE INDEX "IncidentReport_departmentId_idx" ON "IncidentReport"("departmentId");

-- CreateIndex
CREATE INDEX "IncidentReport_status_idx" ON "IncidentReport"("status");

-- CreateIndex
CREATE INDEX "IncidentReport_createdAt_idx" ON "IncidentReport"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ArrestReport_bookingNumber_key" ON "ArrestReport"("bookingNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ArrestReport_reportNumber_key" ON "ArrestReport"("reportNumber");

-- CreateIndex
CREATE INDEX "ArrestReport_reportNumber_idx" ON "ArrestReport"("reportNumber");

-- CreateIndex
CREATE INDEX "ArrestReport_bookingNumber_idx" ON "ArrestReport"("bookingNumber");

-- CreateIndex
CREATE INDEX "ArrestReport_cadCallId_idx" ON "ArrestReport"("cadCallId");

-- CreateIndex
CREATE INDEX "ArrestReport_arrestingOfficerId_idx" ON "ArrestReport"("arrestingOfficerId");

-- CreateIndex
CREATE INDEX "ArrestReport_subjectName_idx" ON "ArrestReport"("subjectName");

-- CreateIndex
CREATE INDEX "ArrestReport_status_idx" ON "ArrestReport"("status");

-- CreateIndex
CREATE UNIQUE INDEX "FireReport_reportNumber_key" ON "FireReport"("reportNumber");

-- CreateIndex
CREATE INDEX "FireReport_reportNumber_idx" ON "FireReport"("reportNumber");

-- CreateIndex
CREATE INDEX "FireReport_cadCallId_idx" ON "FireReport"("cadCallId");

-- CreateIndex
CREATE INDEX "FireReport_authorId_idx" ON "FireReport"("authorId");

-- CreateIndex
CREATE INDEX "FireReport_incidentType_idx" ON "FireReport"("incidentType");

-- CreateIndex
CREATE INDEX "FireReport_status_idx" ON "FireReport"("status");

-- CreateIndex
CREATE UNIQUE INDEX "EMSReport_reportNumber_key" ON "EMSReport"("reportNumber");

-- CreateIndex
CREATE INDEX "EMSReport_reportNumber_idx" ON "EMSReport"("reportNumber");

-- CreateIndex
CREATE INDEX "EMSReport_cadCallId_idx" ON "EMSReport"("cadCallId");

-- CreateIndex
CREATE INDEX "EMSReport_authorId_idx" ON "EMSReport"("authorId");

-- CreateIndex
CREATE INDEX "EMSReport_status_idx" ON "EMSReport"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Call911_callNumber_key" ON "Call911"("callNumber");

-- CreateIndex
CREATE INDEX "Call911_callNumber_idx" ON "Call911"("callNumber");

-- CreateIndex
CREATE INDEX "Call911_callerId_idx" ON "Call911"("callerId");

-- CreateIndex
CREATE INDEX "Call911_status_idx" ON "Call911"("status");

-- CreateIndex
CREATE INDEX "Call911_priority_idx" ON "Call911"("priority");

-- CreateIndex
CREATE INDEX "Call911_createdAt_idx" ON "Call911"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CadCall_call911Id_key" ON "CadCall"("call911Id");

-- CreateIndex
CREATE UNIQUE INDEX "CadCall_callNumber_key" ON "CadCall"("callNumber");

-- CreateIndex
CREATE INDEX "CadCall_callNumber_idx" ON "CadCall"("callNumber");

-- CreateIndex
CREATE INDEX "CadCall_departmentId_idx" ON "CadCall"("departmentId");

-- CreateIndex
CREATE INDEX "CadCall_status_idx" ON "CadCall"("status");

-- CreateIndex
CREATE INDEX "CadCall_priority_idx" ON "CadCall"("priority");

-- CreateIndex
CREATE INDEX "CadCall_createdAt_idx" ON "CadCall"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CadUnit_unitNumber_key" ON "CadUnit"("unitNumber");

-- CreateIndex
CREATE INDEX "CadUnit_departmentId_idx" ON "CadUnit"("departmentId");

-- CreateIndex
CREATE INDEX "CadUnit_userId_idx" ON "CadUnit"("userId");

-- CreateIndex
CREATE INDEX "CadUnit_unitNumber_idx" ON "CadUnit"("unitNumber");

-- CreateIndex
CREATE INDEX "CadUnit_status_idx" ON "CadUnit"("status");

-- CreateIndex
CREATE INDEX "CadUnit_active_idx" ON "CadUnit"("active");

-- CreateIndex
CREATE INDEX "UnitAssignment_departmentId_idx" ON "UnitAssignment"("departmentId");

-- CreateIndex
CREATE INDEX "UnitAssignment_cadUnitId_idx" ON "UnitAssignment"("cadUnitId");

-- CreateIndex
CREATE INDEX "UnitAssignment_status_idx" ON "UnitAssignment"("status");

-- CreateIndex
CREATE INDEX "UnitAssignment_assignedAt_idx" ON "UnitAssignment"("assignedAt");

-- CreateIndex
CREATE UNIQUE INDEX "UnitAssignment_cadCallId_cadUnitId_key" ON "UnitAssignment"("cadCallId", "cadUnitId");

-- CreateIndex
CREATE UNIQUE INDEX "Bolo_boloNumber_key" ON "Bolo"("boloNumber");

-- CreateIndex
CREATE INDEX "Bolo_boloNumber_idx" ON "Bolo"("boloNumber");

-- CreateIndex
CREATE INDEX "Bolo_plate_idx" ON "Bolo"("plate");

-- CreateIndex
CREATE INDEX "Bolo_personName_idx" ON "Bolo"("personName");

-- CreateIndex
CREATE INDEX "Bolo_status_idx" ON "Bolo"("status");

-- CreateIndex
CREATE INDEX "Bolo_createdAt_idx" ON "Bolo"("createdAt");

-- CreateIndex
CREATE INDEX "DispatchMessage_channel_idx" ON "DispatchMessage"("channel");

-- CreateIndex
CREATE INDEX "DispatchMessage_createdAt_idx" ON "DispatchMessage"("createdAt");

-- CreateIndex
CREATE INDEX "DispatchMessage_userId_idx" ON "DispatchMessage"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_read_idx" ON "Notification"("userId", "read");

-- CreateIndex
CREATE INDEX "Notification_type_idx" ON "Notification"("type");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenId_key" ON "Session"("tokenId");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_tokenId_idx" ON "Session"("tokenId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "CadCallNote_cadCallId_idx" ON "CadCallNote"("cadCallId");

-- CreateIndex
CREATE INDEX "CadCallNote_authorId_idx" ON "CadCallNote"("authorId");

-- CreateIndex
CREATE INDEX "CadCallNote_createdAt_idx" ON "CadCallNote"("createdAt");

-- CreateIndex
CREATE INDEX "CadStatusHistory_cadCallId_idx" ON "CadStatusHistory"("cadCallId");

-- CreateIndex
CREATE INDEX "CadStatusHistory_toStatus_idx" ON "CadStatusHistory"("toStatus");

-- CreateIndex
CREATE INDEX "CadStatusHistory_actorId_idx" ON "CadStatusHistory"("actorId");

-- CreateIndex
CREATE INDEX "CadStatusHistory_createdAt_idx" ON "CadStatusHistory"("createdAt");

-- CreateIndex
CREATE INDEX "DispatchLog_cadCallId_idx" ON "DispatchLog"("cadCallId");

-- CreateIndex
CREATE INDEX "DispatchLog_call911Id_idx" ON "DispatchLog"("call911Id");

-- CreateIndex
CREATE INDEX "DispatchLog_dispatcherId_idx" ON "DispatchLog"("dispatcherId");

-- CreateIndex
CREATE INDEX "DispatchLog_action_idx" ON "DispatchLog"("action");

-- CreateIndex
CREATE INDEX "DispatchLog_createdAt_idx" ON "DispatchLog"("createdAt");

-- CreateIndex
CREATE INDEX "GovernmentAnnouncement_audience_idx" ON "GovernmentAnnouncement"("audience");

-- CreateIndex
CREATE INDEX "GovernmentAnnouncement_active_idx" ON "GovernmentAnnouncement"("active");

-- CreateIndex
CREATE INDEX "GovernmentAnnouncement_priority_idx" ON "GovernmentAnnouncement"("priority");

-- CreateIndex
CREATE INDEX "GovernmentAnnouncement_publishedAt_idx" ON "GovernmentAnnouncement"("publishedAt");

-- CreateIndex
CREATE INDEX "DepartmentBulletin_departmentId_active_idx" ON "DepartmentBulletin"("departmentId", "active");

-- CreateIndex
CREATE INDEX "DepartmentBulletin_priority_idx" ON "DepartmentBulletin"("priority");

-- CreateIndex
CREATE INDEX "DepartmentBulletin_createdAt_idx" ON "DepartmentBulletin"("createdAt");

-- CreateIndex
CREATE INDEX "TrainingRecord_userId_idx" ON "TrainingRecord"("userId");

-- CreateIndex
CREATE INDEX "TrainingRecord_departmentId_idx" ON "TrainingRecord"("departmentId");

-- CreateIndex
CREATE INDEX "TrainingRecord_status_idx" ON "TrainingRecord"("status");

-- CreateIndex
CREATE INDEX "TrainingRecord_createdAt_idx" ON "TrainingRecord"("createdAt");

-- CreateIndex
CREATE INDEX "RadioLog_departmentId_idx" ON "RadioLog"("departmentId");

-- CreateIndex
CREATE INDEX "RadioLog_cadCallId_idx" ON "RadioLog"("cadCallId");

-- CreateIndex
CREATE INDEX "RadioLog_unitId_idx" ON "RadioLog"("unitId");

-- CreateIndex
CREATE INDEX "RadioLog_userId_idx" ON "RadioLog"("userId");

-- CreateIndex
CREATE INDEX "RadioLog_channel_idx" ON "RadioLog"("channel");

-- CreateIndex
CREATE INDEX "RadioLog_createdAt_idx" ON "RadioLog"("createdAt");

-- CreateIndex
CREATE INDEX "ShiftLog_userId_idx" ON "ShiftLog"("userId");

-- CreateIndex
CREATE INDEX "ShiftLog_departmentId_idx" ON "ShiftLog"("departmentId");

-- CreateIndex
CREATE INDEX "ShiftLog_unitId_idx" ON "ShiftLog"("unitId");

-- CreateIndex
CREATE INDEX "ShiftLog_status_idx" ON "ShiftLog"("status");

-- CreateIndex
CREATE INDEX "ShiftLog_clockInAt_idx" ON "ShiftLog"("clockInAt");

-- CreateIndex
CREATE UNIQUE INDEX "SystemSetting_key_key" ON "SystemSetting"("key");

-- CreateIndex
CREATE INDEX "SystemSetting_key_idx" ON "SystemSetting"("key");

-- CreateIndex
CREATE UNIQUE INDEX "ServerConfiguration_key_key" ON "ServerConfiguration"("key");

-- CreateIndex
CREATE INDEX "ServerConfiguration_key_idx" ON "ServerConfiguration"("key");

-- CreateIndex
CREATE INDEX "ServerConfiguration_environment_idx" ON "ServerConfiguration"("environment");

-- AddForeignKey
ALTER TABLE "CivilianProfile" ADD CONSTRAINT "CivilianProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepartmentApplication" ADD CONSTRAINT "DepartmentApplication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepartmentApplication" ADD CONSTRAINT "DepartmentApplication_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepartmentApplication" ADD CONSTRAINT "DepartmentApplication_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepartmentMembership" ADD CONSTRAINT "DepartmentMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepartmentMembership" ADD CONSTRAINT "DepartmentMembership_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepartmentMembership" ADD CONSTRAINT "DepartmentMembership_rankId_fkey" FOREIGN KEY ("rankId") REFERENCES "Rank"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rank" ADD CONSTRAINT "Rank_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "License" ADD CONSTRAINT "License_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Permit" ADD CONSTRAINT "Permit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Warrant" ADD CONSTRAINT "Warrant_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Citation" ADD CONSTRAINT "Citation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Citation" ADD CONSTRAINT "Citation_officerId_fkey" FOREIGN KEY ("officerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentReport" ADD CONSTRAINT "IncidentReport_cadCallId_fkey" FOREIGN KEY ("cadCallId") REFERENCES "CadCall"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentReport" ADD CONSTRAINT "IncidentReport_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentReport" ADD CONSTRAINT "IncidentReport_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArrestReport" ADD CONSTRAINT "ArrestReport_cadCallId_fkey" FOREIGN KEY ("cadCallId") REFERENCES "CadCall"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArrestReport" ADD CONSTRAINT "ArrestReport_arrestingOfficerId_fkey" FOREIGN KEY ("arrestingOfficerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FireReport" ADD CONSTRAINT "FireReport_cadCallId_fkey" FOREIGN KEY ("cadCallId") REFERENCES "CadCall"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FireReport" ADD CONSTRAINT "FireReport_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EMSReport" ADD CONSTRAINT "EMSReport_cadCallId_fkey" FOREIGN KEY ("cadCallId") REFERENCES "CadCall"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EMSReport" ADD CONSTRAINT "EMSReport_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Call911" ADD CONSTRAINT "Call911_callerId_fkey" FOREIGN KEY ("callerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Call911" ADD CONSTRAINT "Call911_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CadCall" ADD CONSTRAINT "CadCall_call911Id_fkey" FOREIGN KEY ("call911Id") REFERENCES "Call911"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CadCall" ADD CONSTRAINT "CadCall_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CadCall" ADD CONSTRAINT "CadCall_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CadCall" ADD CONSTRAINT "CadCall_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CadUnit" ADD CONSTRAINT "CadUnit_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CadUnit" ADD CONSTRAINT "CadUnit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitAssignment" ADD CONSTRAINT "UnitAssignment_cadCallId_fkey" FOREIGN KEY ("cadCallId") REFERENCES "CadCall"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitAssignment" ADD CONSTRAINT "UnitAssignment_cadUnitId_fkey" FOREIGN KEY ("cadUnitId") REFERENCES "CadUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitAssignment" ADD CONSTRAINT "UnitAssignment_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitAssignment" ADD CONSTRAINT "UnitAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bolo" ADD CONSTRAINT "Bolo_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchMessage" ADD CONSTRAINT "DispatchMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CadCallNote" ADD CONSTRAINT "CadCallNote_cadCallId_fkey" FOREIGN KEY ("cadCallId") REFERENCES "CadCall"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CadCallNote" ADD CONSTRAINT "CadCallNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CadStatusHistory" ADD CONSTRAINT "CadStatusHistory_cadCallId_fkey" FOREIGN KEY ("cadCallId") REFERENCES "CadCall"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CadStatusHistory" ADD CONSTRAINT "CadStatusHistory_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchLog" ADD CONSTRAINT "DispatchLog_cadCallId_fkey" FOREIGN KEY ("cadCallId") REFERENCES "CadCall"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchLog" ADD CONSTRAINT "DispatchLog_call911Id_fkey" FOREIGN KEY ("call911Id") REFERENCES "Call911"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchLog" ADD CONSTRAINT "DispatchLog_dispatcherId_fkey" FOREIGN KEY ("dispatcherId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GovernmentAnnouncement" ADD CONSTRAINT "GovernmentAnnouncement_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepartmentBulletin" ADD CONSTRAINT "DepartmentBulletin_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepartmentBulletin" ADD CONSTRAINT "DepartmentBulletin_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingRecord" ADD CONSTRAINT "TrainingRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingRecord" ADD CONSTRAINT "TrainingRecord_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingRecord" ADD CONSTRAINT "TrainingRecord_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RadioLog" ADD CONSTRAINT "RadioLog_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RadioLog" ADD CONSTRAINT "RadioLog_cadCallId_fkey" FOREIGN KEY ("cadCallId") REFERENCES "CadCall"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RadioLog" ADD CONSTRAINT "RadioLog_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "CadUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RadioLog" ADD CONSTRAINT "RadioLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftLog" ADD CONSTRAINT "ShiftLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftLog" ADD CONSTRAINT "ShiftLog_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftLog" ADD CONSTRAINT "ShiftLog_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "CadUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemSetting" ADD CONSTRAINT "SystemSetting_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServerConfiguration" ADD CONSTRAINT "ServerConfiguration_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
