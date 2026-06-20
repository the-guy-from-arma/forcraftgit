import { execFileSync } from "node:child_process";
import { getPrisma } from "./db.js";

const REQUIRED_TABLES = [
  "User",
  "Session",
  "Notification",
  "AuditLog",
  "Department",
  "DepartmentApplication",
  "GovernmentApplication",
  "DepartmentMembership",
  "Rank",
  "CivilianProfile",
  "Vehicle",
  "License",
  "Permit",
  "Warrant",
  "Citation",
  "Call911",
  "CadCall",
  "CadUnit",
  "UnitAssignment",
  "Bolo",
  "IncidentReport",
  "ArrestReport",
  "FireReport",
  "EMSReport",
  "GovernmentAnnouncement",
  "SystemSetting",
  "TrainingRecord",
  "DepartmentBulletin",
  "RadioLog",
  "ShiftLog",
  "ServerConfiguration"
] as const;

const CORE_DEPARTMENTS = [
  {
    name: "FairCroft Department of Motor Vehicles",
    code: "FCDMV",
    type: "government" as const,
    description: "Civilian identity, passport, driver licensing, vehicle registration, and government-services approvals."
  },
  {
    name: "FairCroft Police Department",
    code: "FCPD",
    type: "police" as const,
    description: "Municipal patrol, investigations, traffic, and public-safety records."
  },
  {
    name: "FairCroft Sheriff Office",
    code: "FCSO",
    type: "sheriff" as const,
    description: "County law enforcement, court services, and interagency support."
  },
  {
    name: "FairCroft Fire Department",
    code: "FCFD",
    type: "fire" as const,
    description: "Fire suppression, rescue, prevention, and incident command roleplay."
  },
  {
    name: "FairCroft EMS",
    code: "FCEMS",
    type: "ems" as const,
    description: "Roleplay-only emergency medical response and patient-care documentation."
  },
  {
    name: "FairCroft Communications Dispatch",
    code: "FCCD",
    type: "dispatch" as const,
    description: "911 intake, CAD call-taking, radio traffic, and unit assignment."
  }
];

function assertPostgresConfigured() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is required. FairCroft CoreOne only supports PostgreSQL persistence.");
  }

  if (!/^postgres(ql)?:\/\//i.test(url)) {
    throw new Error("DATABASE_URL must be a PostgreSQL connection string. SQLite, JSON, and file storage are not supported.");
  }
}

function maybeRunMigrations() {
  if (process.env.RUN_MIGRATIONS_ON_START !== "true") return;

  const command = process.platform === "win32" ? "npx.cmd" : "npx";
  console.log("[database] RUN_MIGRATIONS_ON_START=true; running prisma migrate deploy.");
  execFileSync(command, ["prisma", "migrate", "deploy"], {
    stdio: "inherit",
    env: process.env
  });
}

export async function verifyRequiredTables() {
  const prisma = getPrisma();
  const rows = await prisma.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
  `;
  const present = new Set(rows.map((row) => row.table_name));
  const missing = REQUIRED_TABLES.filter((table) => !present.has(table));

  return {
    tablesReady: missing.length === 0,
    missingTables: missing,
    verifiedTables: REQUIRED_TABLES.length - missing.length
  };
}

export async function checkDatabaseHealth() {
  const started = Date.now();

  try {
    assertPostgresConfigured();
    const prisma = getPrisma();
    await prisma.$queryRaw`SELECT 1`;
    const tableStatus = await verifyRequiredTables();

    return {
      ok: tableStatus.tablesReady,
      provider: "postgresql",
      latencyMs: Date.now() - started,
      ...tableStatus
    };
  } catch (error) {
    return {
      ok: false,
      provider: "postgresql",
      latencyMs: Date.now() - started,
      tablesReady: false,
      missingTables: REQUIRED_TABLES,
      error: error instanceof Error ? error.message : "Unknown database health error."
    };
  }
}

export async function ensureCoreDefaults() {
  const prisma = getPrisma();

  for (const department of CORE_DEPARTMENTS) {
    const saved = await prisma.department.upsert({
      where: { code: department.code },
      update: {
        name: department.name,
        type: department.type,
        description: department.description,
        isActive: true
      },
      create: department
    });

    await prisma.rank.upsert({
      where: { departmentId_name: { departmentId: saved.id, name: "Member" } },
      update: {},
      create: {
        departmentId: saved.id,
        name: "Member",
        level: 10,
        permissions: { cad: true, records: true }
      }
    });

    await prisma.rank.upsert({
      where: { departmentId_name: { departmentId: saved.id, name: "Supervisor" } },
      update: {},
      create: {
        departmentId: saved.id,
        name: "Supervisor",
        level: 90,
        permissions: { cad: true, records: true, roster: true, unitManagement: true }
      }
    });
  }

  await prisma.systemSetting.upsert({
    where: { key: "roleplay_disclaimer" },
    update: {
      value: {
        text: "FairCroft CoreOne is a fictional roleplay CAD/MDT. It is not a real emergency, CJIS, NCIC, medical, or government system."
      }
    },
    create: {
      key: "roleplay_disclaimer",
      value: {
        text: "FairCroft CoreOne is a fictional roleplay CAD/MDT. It is not a real emergency, CJIS, NCIC, medical, or government system."
      }
    }
  });

  await prisma.serverConfiguration.upsert({
    where: { key: "startup_profile" },
    update: {
      environment: process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV || "development",
      value: {
        railwayEnvironment: process.env.RAILWAY_ENVIRONMENT || null,
        portManagedByEnvironment: true,
        persistence: "postgresql"
      }
    },
    create: {
      key: "startup_profile",
      environment: process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV || "development",
      value: {
        railwayEnvironment: process.env.RAILWAY_ENVIRONMENT || null,
        portManagedByEnvironment: true,
        persistence: "postgresql"
      }
    }
  });
}

export async function initializeDatabase() {
  assertPostgresConfigured();
  maybeRunMigrations();

  const health = await checkDatabaseHealth();
  if (!health.ok) {
    const missing = health.missingTables.length ? ` Missing tables: ${health.missingTables.join(", ")}.` : "";
    throw new Error(`PostgreSQL startup check failed.${missing}`);
  }

  await ensureCoreDefaults();
  const verifiedTables = "verifiedTables" in health ? health.verifiedTables : 0;
  console.log(`[database] PostgreSQL ready. Verified ${verifiedTables} required tables in ${health.latencyMs}ms.`);
}

export async function shutdownDatabase() {
  await getPrisma().$disconnect();
  console.log("[database] PostgreSQL connection pool closed.");
}
