import { execFileSync } from "node:child_process";
import bcrypt from "bcryptjs";
import { getPrisma } from "./db.js";
import { getNodeEnv, getOwnerBootstrapConfig, maskEmail, readEnvValue } from "./env.js";

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
  const databaseUrl = readEnvValue(["DATABASE_URL"]);
  const url = databaseUrl.value;

  if (!url) {
    throw new Error("DATABASE_URL is required. FairCroft CoreOne only supports PostgreSQL persistence.");
  }

  if (!/^postgres(ql)?:\/\//i.test(url)) {
    throw new Error("DATABASE_URL must be a PostgreSQL connection string. SQLite, JSON, and file storage are not supported.");
  }

  if (process.env.DATABASE_URL !== url) {
    process.env.DATABASE_URL = url;
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
  const environment = readEnvValue(["RAILWAY_ENVIRONMENT"]).value || getNodeEnv();

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
      environment,
      value: {
        railwayEnvironment: readEnvValue(["RAILWAY_ENVIRONMENT"]).value || null,
        portManagedByEnvironment: true,
        persistence: "postgresql"
      }
    },
    create: {
      key: "startup_profile",
      environment,
      value: {
        railwayEnvironment: readEnvValue(["RAILWAY_ENVIRONMENT"]).value || null,
        portManagedByEnvironment: true,
        persistence: "postgresql"
      }
    }
  });
}

function splitOwnerName(name: string) {
  const parts = name.trim().split(/\s+/);
  return {
    firstName: parts[0] || "FairCroft",
    lastName: parts.slice(1).join(" ") || "Owner"
  };
}

async function ensureOwnerAccount() {
  const prisma = getPrisma();
  const owner = getOwnerBootstrapConfig();

  console.log("[database] Owner bootstrap environment:", {
    ownerEmail: maskEmail(owner.email),
    emailSource: owner.emailSource,
    passwordSource: owner.passwordSource,
    passwordAvailable: Boolean(owner.password),
    nameSource: owner.nameSource
  });

  if (!owner.password) {
    const existingOwner = await prisma.user.findFirst({ where: { role: "owner" } });
    if (!existingOwner) {
      console.warn("[database] Owner password is not set; owner bootstrap skipped because no safe password is available.");
    } else {
      console.warn("[database] Owner password is not set; existing owner account was left unchanged.");
    }
    return;
  }

  const passwordHash = await bcrypt.hash(owner.password, 12);
  const profileName = splitOwnerName(owner.name);

  const user = await prisma.user.upsert({
    where: { email: owner.email },
    update: {
      name: owner.name,
      role: "owner",
      passwordHash,
      suspended: false
    },
    create: {
      email: owner.email,
      name: owner.name,
      role: "owner",
      passwordHash,
      suspended: false
    }
  });

  await prisma.civilianProfile.upsert({
    where: { userId: user.id },
    update: {
      firstName: profileName.firstName,
      lastName: profileName.lastName,
      city: "FairCroft",
      state: "FC",
      verificationStatus: "verified"
    },
    create: {
      userId: user.id,
      firstName: profileName.firstName,
      lastName: profileName.lastName,
      city: "FairCroft",
      state: "FC",
      verificationStatus: "verified"
    }
  });

  const dispatchDepartment = await prisma.department.findUnique({ where: { code: "FCCD" } });
  if (dispatchDepartment) {
    const rank = await prisma.rank.findFirst({
      where: { departmentId: dispatchDepartment.id },
      orderBy: { level: "desc" }
    });

    await prisma.departmentMembership.upsert({
      where: {
        userId_departmentId: {
          userId: user.id,
          departmentId: dispatchDepartment.id
        }
      },
      update: {
        role: "owner",
        rankId: rank?.id,
        active: true,
        jobTitle: "Owner / System Oversight",
        division: "Executive",
        station: "CoreOne",
        callSign: "OWNER"
      },
      create: {
        userId: user.id,
        departmentId: dispatchDepartment.id,
        role: "owner",
        rankId: rank?.id,
        active: true,
        badgeNumber: "FC-000",
        jobTitle: "Owner / System Oversight",
        division: "Executive",
        station: "CoreOne",
        callSign: "OWNER"
      }
    });
  }

  await prisma.auditLog.create({
    data: {
      actorId: user.id,
      action: "system.owner.bootstrap",
      entity: "User",
      entityId: user.id,
      metadata: {
        email: owner.email,
        source: "startup_environment",
        passwordUpdatedFromEnvironment: true
      }
    }
  });

  console.log(`[database] Owner account ready for ${maskEmail(owner.email)}.`);
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
  await ensureOwnerAccount();
  const verifiedTables = "verifiedTables" in health ? health.verifiedTables : 0;
  console.log(`[database] PostgreSQL ready. Verified ${verifiedTables} required tables in ${health.latencyMs}ms.`);
}

export async function shutdownDatabase() {
  await getPrisma().$disconnect();
  console.log("[database] PostgreSQL connection pool closed.");
}
