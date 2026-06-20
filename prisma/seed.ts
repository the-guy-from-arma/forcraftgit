import "dotenv/config";

import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const ownerEmail = process.env.OWNER_EMAIL || "owner@faircroft.local";
const ownerPassword = process.env.OWNER_PASSWORD || "ChangeMe123!";
const ownerName = process.env.OWNER_NAME || "FairCroft Owner";

const demoPassword = "Password123!";

const departmentSeed = [
  {
    name: "FairCroft Department of Motor Vehicles",
    code: "FCDMV",
    type: "government" as const,
    description: "Civilian identity, passport, driver licensing, vehicle registration, and government service approvals."
  },
  {
    name: "FairCroft Police Department",
    code: "FCPD",
    type: "police" as const,
    description: "Municipal patrol, investigations, traffic enforcement, and public-safety records."
  },
  {
    name: "FairCroft Sheriff Office",
    code: "FCSO",
    type: "sheriff" as const,
    description: "County law enforcement, court services, and interagency roleplay operations."
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
    description: "Roleplay-only emergency medical response, transport, and patient-care reports."
  },
  {
    name: "FairCroft Communications Dispatch",
    code: "FCCD",
    type: "dispatch" as const,
    description: "911 intake, CAD call-taking, radio traffic, and resource assignment."
  }
];

function splitName(name: string) {
  const parts = name.trim().split(/\s+/);
  return {
    firstName: parts[0] || "FairCroft",
    lastName: parts.slice(1).join(" ") || "Resident"
  };
}

async function upsertUser(input: {
  email: string;
  password: string;
  name: string;
  role: any;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  characterPhotoUrl?: string;
  verificationStatus?: string;
}) {
  const passwordHash = await bcrypt.hash(input.password, 12);
  const profileName = splitName(input.name);

  const user = await prisma.user.upsert({
    where: { email: input.email },
    update: {
      name: input.name,
      role: input.role,
      phone: input.phone,
      passwordHash,
      suspended: false
    },
    create: {
      email: input.email,
      passwordHash,
      name: input.name,
      phone: input.phone,
      role: input.role
    }
  });

  await prisma.civilianProfile.upsert({
    where: { userId: user.id },
    update: {
      firstName: profileName.firstName,
      lastName: profileName.lastName,
      phone: input.phone,
      address: input.address || "100 Civic Plaza",
      city: input.city || "FairCroft",
      state: input.state || "FC",
      postalCode: input.postalCode || "00001",
      characterPhotoUrl: input.characterPhotoUrl,
      characterPhotoNoticeAccepted: Boolean(input.characterPhotoUrl),
      verificationStatus: input.verificationStatus || (input.role === "unverified_civ" ? "unverified" : "verified")
    },
    create: {
      userId: user.id,
      firstName: profileName.firstName,
      lastName: profileName.lastName,
      phone: input.phone,
      address: input.address || "100 Civic Plaza",
      city: input.city || "FairCroft",
      state: input.state || "FC",
      postalCode: input.postalCode || "00001",
      characterPhotoUrl: input.characterPhotoUrl,
      characterPhotoNoticeAccepted: Boolean(input.characterPhotoUrl),
      verificationStatus: input.verificationStatus || (input.role === "unverified_civ" ? "unverified" : "verified")
    }
  });

  return user;
}

async function upsertMembership(input: {
  userId: string;
  departmentId: string;
  role: any;
  rankName: string;
  badgeNumber: string;
  jobTitle?: string;
  division?: string;
  station?: string;
  callSign?: string;
}) {
  const rank = await prisma.rank.findFirst({
    where: { departmentId: input.departmentId, name: input.rankName }
  });

  return prisma.departmentMembership.upsert({
    where: { userId_departmentId: { userId: input.userId, departmentId: input.departmentId } },
    update: {
      active: true,
      role: input.role,
      rankId: rank?.id,
      badgeNumber: input.badgeNumber,
      jobTitle: input.jobTitle,
      division: input.division,
      station: input.station,
      callSign: input.callSign
    },
    create: {
      userId: input.userId,
      departmentId: input.departmentId,
      role: input.role,
      rankId: rank?.id,
      badgeNumber: input.badgeNumber,
      jobTitle: input.jobTitle,
      division: input.division,
      station: input.station,
      callSign: input.callSign,
      active: true
    }
  });
}

async function ensureBulletin(input: {
  departmentId: string;
  authorId: string;
  title: string;
  body: string;
  priority?: any;
}) {
  const existing = await prisma.departmentBulletin.findFirst({
    where: { departmentId: input.departmentId, title: input.title }
  });

  if (existing) {
    return prisma.departmentBulletin.update({
      where: { id: existing.id },
      data: { body: input.body, priority: input.priority || "routine", active: true }
    });
  }

  return prisma.departmentBulletin.create({
    data: {
      departmentId: input.departmentId,
      authorId: input.authorId,
      title: input.title,
      body: input.body,
      priority: input.priority || "routine"
    }
  });
}

async function ensureAnnouncement(input: { title: string; body: string; authorId: string; priority?: any }) {
  const existing = await prisma.governmentAnnouncement.findFirst({ where: { title: input.title } });
  if (existing) {
    return prisma.governmentAnnouncement.update({
      where: { id: existing.id },
      data: { body: input.body, authorId: input.authorId, active: true, priority: input.priority || "routine" }
    });
  }

  return prisma.governmentAnnouncement.create({
    data: {
      title: input.title,
      body: input.body,
      authorId: input.authorId,
      priority: input.priority || "routine"
    }
  });
}

async function main() {
  const departments = new Map<string, Awaited<ReturnType<typeof prisma.department.upsert>>>();

  for (const department of departmentSeed) {
    const saved = await prisma.department.upsert({
      where: { code: department.code },
      update: { ...department, isActive: true },
      create: department
    });
    departments.set(department.code, saved);

    for (const rank of [
      { name: "Member", level: 10, permissions: { cad: true, records: true } },
      { name: "Senior Member", level: 30, permissions: { cad: true, records: true, reports: true } },
      { name: "Supervisor", level: 70, permissions: { cad: true, records: true, roster: true, unitManagement: true } },
      { name: "Command", level: 100, permissions: { cad: true, records: true, roster: true, unitManagement: true, adminAssist: true } }
    ]) {
      await prisma.rank.upsert({
        where: { departmentId_name: { departmentId: saved.id, name: rank.name } },
        update: { level: rank.level, permissions: rank.permissions },
        create: {
          departmentId: saved.id,
          name: rank.name,
          level: rank.level,
          permissions: rank.permissions
        }
      });
    }
  }

  const owner = await upsertUser({
    email: ownerEmail,
    password: ownerPassword,
    name: ownerName,
    role: "owner",
    phone: "555-0100",
    address: "1 Government Plaza"
  });

  const admin = await upsertUser({
    email: "admin@faircroft.local",
    password: demoPassword,
    name: "Morgan Vale",
    role: "site_admin",
    phone: "555-0101",
    address: "2 Government Plaza"
  });

  const dispatcher = await upsertUser({
    email: "dispatcher@faircroft.local",
    password: demoPassword,
    name: "Avery Dispatch",
    role: "dispatcher",
    phone: "555-0111",
    address: "10 Communications Way"
  });

  const dmvClerk = await upsertUser({
    email: "dmv@faircroft.local",
    password: demoPassword,
    name: "Quinn Mercer",
    role: "government_employee",
    phone: "555-0107",
    address: "4 Civic Services Hall"
  });

  const police = await upsertUser({
    email: "police@faircroft.local",
    password: demoPassword,
    name: "Jordan Pike",
    role: "police",
    phone: "555-0121",
    address: "42 Patrol Lane"
  });

  const sheriff = await upsertUser({
    email: "sheriff@faircroft.local",
    password: demoPassword,
    name: "Casey Rowan",
    role: "sheriff",
    phone: "555-0122",
    address: "70 County Road"
  });

  const fire = await upsertUser({
    email: "fire@faircroft.local",
    password: demoPassword,
    name: "Taylor Ember",
    role: "fire",
    phone: "555-0131",
    address: "8 Station Street"
  });

  const ems = await upsertUser({
    email: "ems@faircroft.local",
    password: demoPassword,
    name: "Reese Medic",
    role: "ems",
    phone: "555-0141",
    address: "22 Mercy Avenue"
  });

  const civilian = await upsertUser({
    email: "civilian@faircroft.local",
    password: demoPassword,
    name: "Riley Stone",
    role: "civilian",
    phone: "555-0199",
    address: "117 Market Street"
  });

  const civilianTwo = await upsertUser({
    email: "civilian2@faircroft.local",
    password: demoPassword,
    name: "Jamie Cross",
    role: "unverified_civ",
    phone: "555-0188",
    address: "318 Harbor Road",
    verificationStatus: "unverified"
  });

  const dmvDept = departments.get("FCDMV")!;
  const dispatchDept = departments.get("FCCD")!;
  const policeDept = departments.get("FCPD")!;
  const sheriffDept = departments.get("FCSO")!;
  const fireDept = departments.get("FCFD")!;
  const emsDept = departments.get("FCEMS")!;

  await upsertMembership({ userId: owner.id, departmentId: dispatchDept.id, role: "owner", rankName: "Command", badgeNumber: "FC-000", jobTitle: "Owner / System Oversight", division: "Executive", station: "CoreOne", callSign: "OWNER" });
  await upsertMembership({ userId: admin.id, departmentId: dispatchDept.id, role: "site_admin", rankName: "Command", badgeNumber: "ADM-101", jobTitle: "Site Administrator", division: "Administration", station: "CoreOne", callSign: "ADMIN" });
  await upsertMembership({ userId: dmvClerk.id, departmentId: dmvDept.id, role: "government_employee", rankName: "Member", badgeNumber: "DMV-107", jobTitle: "DMV Records Clerk", division: "Identity and Vehicle Services", station: "Civic Services Hall", callSign: "DMV-7" });
  await upsertMembership({ userId: dispatcher.id, departmentId: dispatchDept.id, role: "dispatcher", rankName: "Supervisor", badgeNumber: "D-104", jobTitle: "Communications Dispatcher", division: "911 Communications", station: "Dispatch Center", callSign: "DISP-1" });
  await upsertMembership({ userId: police.id, departmentId: policeDept.id, role: "police", rankName: "Member", badgeNumber: "P-214", jobTitle: "Police Officer", division: "Patrol", station: "Central Precinct", callSign: "2L-14" });
  await upsertMembership({ userId: sheriff.id, departmentId: sheriffDept.id, role: "sheriff", rankName: "Senior Member", badgeNumber: "S-122", jobTitle: "Deputy Sheriff", division: "County Patrol", station: "Sheriff Office", callSign: "SO-22" });
  await upsertMembership({ userId: fire.id, departmentId: fireDept.id, role: "fire", rankName: "Member", badgeNumber: "F-331", jobTitle: "Firefighter", division: "Suppression", station: "Station 1", callSign: "E-1" });
  await upsertMembership({ userId: ems.id, departmentId: emsDept.id, role: "ems", rankName: "Member", badgeNumber: "M-441", jobTitle: "Paramedic", division: "Medical Response", station: "Medic Post 3", callSign: "M-3" });

  const units = await Promise.all([
    prisma.cadUnit.upsert({
      where: { unitNumber: "DISP-1" },
      update: { userId: dispatcher.id, departmentId: dispatchDept.id, active: true },
      create: { unitNumber: "DISP-1", userId: dispatcher.id, departmentId: dispatchDept.id, status: "TEN_8_AVAILABLE", currentLocation: "FairCroft Communications Center" }
    }),
    prisma.cadUnit.upsert({
      where: { unitNumber: "2L-14" },
      update: { userId: police.id, departmentId: policeDept.id, active: true },
      create: { unitNumber: "2L-14", userId: police.id, departmentId: policeDept.id, status: "TEN_8_AVAILABLE", currentLocation: "Downtown Sector" }
    }),
    prisma.cadUnit.upsert({
      where: { unitNumber: "SO-22" },
      update: { userId: sheriff.id, departmentId: sheriffDept.id, active: true },
      create: { unitNumber: "SO-22", userId: sheriff.id, departmentId: sheriffDept.id, status: "TEN_6_BUSY", currentLocation: "County Courthouse" }
    }),
    prisma.cadUnit.upsert({
      where: { unitNumber: "E-1" },
      update: { userId: fire.id, departmentId: fireDept.id, active: true },
      create: { unitNumber: "E-1", userId: fire.id, departmentId: fireDept.id, status: "TEN_8_AVAILABLE", currentLocation: "Station 1" }
    }),
    prisma.cadUnit.upsert({
      where: { unitNumber: "M-3" },
      update: { userId: ems.id, departmentId: emsDept.id, active: true },
      create: { unitNumber: "M-3", userId: ems.id, departmentId: emsDept.id, status: "TEN_8_AVAILABLE", currentLocation: "Medic Post 3" }
    })
  ]);

  await prisma.license.upsert({
    where: { number: "FC-DL-100245" },
    update: {},
    create: { userId: civilian.id, number: "FC-DL-100245", class: "D", status: "active", expiresAt: new Date("2030-12-31") }
  });

  await prisma.license.upsert({
    where: { number: "FC-DL-100884" },
    update: {},
    create: { userId: civilianTwo.id, number: "FC-DL-100884", class: "C", status: "active", expiresAt: new Date("2029-09-30") }
  });

  await prisma.vehicle.upsert({
    where: { plate: "FCX742" },
    update: {},
    create: { ownerId: civilian.id, make: "Karin", model: "Asterope", year: 2020, color: "Graphite", plate: "FCX742", vin: "FCROLEPLAYVIN742", registrationStatus: "active", expiresAt: new Date("2027-06-30") }
  });

  await prisma.vehicle.upsert({
    where: { plate: "HBR318" },
    update: {},
    create: { ownerId: civilianTwo.id, make: "Vapid", model: "Stanier", year: 2018, color: "White", plate: "HBR318", vin: "FCROLEPLAYVIN318", registrationStatus: "active", expiresAt: new Date("2027-04-30") }
  });

  await prisma.permit.upsert({
    where: { number: "FC-FP-4419" },
    update: {},
    create: { userId: civilian.id, type: "Firearm Permit", number: "FC-FP-4419", status: "active", expiresAt: new Date("2028-03-15"), notes: "Fictional roleplay permit. No real-world validity." }
  });

  await prisma.permit.upsert({
    where: { number: "FC-BL-2012" },
    update: {},
    create: { userId: civilianTwo.id, type: "Business License", number: "FC-BL-2012", status: "active", expiresAt: new Date("2027-12-31"), notes: "FairCroft Harbor Deliveries, roleplay business license." }
  });

  const warrant = await prisma.warrant.upsert({
    where: { warrantNumber: "FC-WAR-SEED-0001" },
    update: { status: "active" },
    create: { warrantNumber: "FC-WAR-SEED-0001", subjectId: civilianTwo.id, subjectName: civilianTwo.name, charges: "Failure to appear - fictional municipal citation docket.", severity: "priority", createdById: police.id }
  });

  await prisma.citation.upsert({
    where: { citationNumber: "FC-CIT-SEED-0001" },
    update: {},
    create: { citationNumber: "FC-CIT-SEED-0001", userId: civilian.id, subjectName: civilian.name, officerId: police.id, statute: "FC 12.04", description: "Fictional improper parking citation.", fineCents: 8500, location: "Market Street" }
  });

  await prisma.bolo.upsert({
    where: { boloNumber: "FC-BOLO-SEED-0001" },
    update: { status: "active" },
    create: { boloNumber: "FC-BOLO-SEED-0001", title: "Training BOLO: Red Compact", description: "Fictional seed BOLO for MDT demonstration. Red compact last seen near Market Street.", plate: "TRAIN1", vehicleDescription: "Red compact sedan", createdById: dispatcher.id }
  });

  const call911 = await prisma.call911.upsert({
    where: { callNumber: "FC-911-SEED-0001" },
    update: {},
    create: {
      callNumber: "FC-911-SEED-0001",
      callerId: civilian.id,
      emergencyType: "Traffic Collision",
      location: "Vespucci Boulevard & FairCroft Avenue",
      description: "Two-vehicle fictional roleplay collision, no real emergency.",
      callerName: civilian.name,
      callbackNumber: civilian.phone || "555-0199",
      status: "converted",
      acceptedById: dispatcher.id,
      acceptedAt: new Date()
    }
  });

  const cadCall = await prisma.cadCall.upsert({
    where: { callNumber: "FC-CAD-SEED-0001" },
    update: { status: "assigned" },
    create: {
      call911Id: call911.id,
      departmentId: policeDept.id,
      callNumber: "FC-CAD-SEED-0001",
      type: "Traffic Collision",
      location: call911.location,
      description: call911.description,
      priority: "priority",
      status: "assigned",
      createdById: dispatcher.id,
      acceptedById: dispatcher.id
    }
  });

  await prisma.unitAssignment.upsert({
    where: { cadCallId_cadUnitId: { cadCallId: cadCall.id, cadUnitId: units[1].id } },
    update: { status: "assigned", departmentId: policeDept.id },
    create: { cadCallId: cadCall.id, cadUnitId: units[1].id, departmentId: policeDept.id, assignedById: dispatcher.id, status: "assigned" }
  });

  if (!(await prisma.cadStatusHistory.findFirst({ where: { cadCallId: cadCall.id, toStatus: "assigned" } }))) {
    await prisma.cadStatusHistory.create({ data: { cadCallId: cadCall.id, toStatus: "assigned", actorId: dispatcher.id, note: "Seed incident assigned to 2L-14." } });
  }

  if (!(await prisma.cadCallNote.findFirst({ where: { cadCallId: cadCall.id } }))) {
    await prisma.cadCallNote.create({ data: { cadCallId: cadCall.id, authorId: dispatcher.id, body: "Seed CAD note: roleplay demonstration incident.", isSystem: true } });
  }

  if (!(await prisma.dispatchLog.findFirst({ where: { cadCallId: cadCall.id, action: "seed.dispatch" } }))) {
    await prisma.dispatchLog.create({ data: { cadCallId: cadCall.id, call911Id: call911.id, dispatcherId: dispatcher.id, action: "seed.dispatch", message: "Seed CAD incident created for demo operations." } });
  }

  await prisma.incidentReport.upsert({
    where: { reportNumber: "FC-IR-SEED-0001" },
    update: {},
    create: { cadCallId: cadCall.id, authorId: police.id, departmentId: policeDept.id, reportNumber: "FC-IR-SEED-0001", title: "Seed Traffic Collision", narrative: "Fictional roleplay report narrative for FairCroft CoreOne demo data." }
  });

  await prisma.arrestReport.upsert({
    where: { reportNumber: "FC-AR-SEED-0001" },
    update: {},
    create: { cadCallId: cadCall.id, arrestingOfficerId: police.id, subjectName: "Training Subject", charges: "Fictional obstruction charge for demo data.", narrative: "Roleplay-only arrest report sample.", bookingNumber: "FC-BOOK-SEED-0001", reportNumber: "FC-AR-SEED-0001" }
  });

  await prisma.fireReport.upsert({
    where: { reportNumber: "FC-FR-SEED-0001" },
    update: {},
    create: { cadCallId: cadCall.id, authorId: fire.id, reportNumber: "FC-FR-SEED-0001", incidentType: "Vehicle Hazard", cause: "Fictional collision", actions: "Engine company secured scene hazards.", narrative: "Roleplay fire report sample." }
  });

  await prisma.eMSReport.upsert({
    where: { reportNumber: "FC-EMS-SEED-0001" },
    update: {},
    create: { cadCallId: cadCall.id, authorId: ems.id, reportNumber: "FC-EMS-SEED-0001", patientName: "Roleplay Patient", patientAge: 34, chiefComplaint: "Fictional minor pain after collision.", careProvided: "Roleplay assessment and transport documentation only.", disposition: "Released to roleplay hospital staff.", roleplayOnly: true }
  });

  const pending = await prisma.departmentApplication.findFirst({
    where: { userId: civilianTwo.id, departmentId: policeDept.id, status: "pending" }
  });
  if (!pending) {
    await prisma.departmentApplication.create({
      data: {
        userId: civilianTwo.id,
        departmentId: policeDept.id,
        desiredRole: "police",
        statement: "I would like to join patrol operations and learn FairCroft radio procedures.",
        experience: "Prior civilian ride-along roleplay."
      }
    });
  }

  if (!(await prisma.governmentApplication.findFirst({ where: { userId: civilianTwo.id, type: "passport", status: "pending" } }))) {
    await prisma.governmentApplication.create({
      data: {
        userId: civilianTwo.id,
        type: "passport",
        payload: {
          label: "FairCroft Passport / Civilian ID",
          legalName: civilianTwo.name,
          address: "318 Harbor Road",
          city: "FairCroft",
          state: "FC",
          photoNoticeAccepted: true,
          passportReason: "Initial civilian verification for roleplay server access."
        }
      }
    });
  }

  if (!(await prisma.governmentApplication.findFirst({ where: { userId: civilian.id, type: "vehicle_registration", status: "pending" } }))) {
    await prisma.governmentApplication.create({
      data: {
        userId: civilian.id,
        type: "vehicle_registration",
        payload: {
          label: "Vehicle Registration",
          make: "Bravado",
          model: "Buffalo",
          year: 2022,
          color: "Blue",
          plate: "NEW742",
          notes: "Seed pending DMV queue item."
        }
      }
    });
  }

  await ensureAnnouncement({
    title: "Welcome to FairCroft Government Services",
    body: "FairCroft CoreOne is a fictional roleplay government operating system. Do not use it for real emergencies.",
    authorId: owner.id,
    priority: "priority"
  });

  await ensureBulletin({
    departmentId: policeDept.id,
    authorId: admin.id,
    title: "Patrol Briefing",
    body: "Training patrols should monitor Market Street and Harbor Road. All activity remains fictional and roleplay-only.",
    priority: "routine"
  });

  if (!(await prisma.trainingRecord.findFirst({ where: { userId: police.id, title: "CoreOne MDT Orientation" } }))) {
    await prisma.trainingRecord.create({
      data: {
        userId: police.id,
        departmentId: policeDept.id,
        assignedById: admin.id,
        title: "CoreOne MDT Orientation",
        description: "Review CAD call handling, BOLO lookup, citation writing, and report filing.",
        status: "completed",
        completedAt: new Date()
      }
    });
  }

  if (!(await prisma.radioLog.findFirst({ where: { message: "DISP-1 to all units, seed radio log active." } }))) {
    await prisma.radioLog.create({
      data: {
        departmentId: dispatchDept.id,
        unitId: units[0].id,
        userId: dispatcher.id,
        channel: "dispatch",
        code: "INFO",
        message: "DISP-1 to all units, seed radio log active."
      }
    });
  }

  if (!(await prisma.dispatchMessage.findFirst({ where: { body: "Seed dispatch channel initialized." } }))) {
    await prisma.dispatchMessage.create({
      data: {
        userId: dispatcher.id,
        channel: "dispatch",
        body: "Seed dispatch channel initialized."
      }
    });
  }

  if (!(await prisma.shiftLog.findFirst({ where: { userId: dispatcher.id, clockOutAt: null } }))) {
    await prisma.shiftLog.create({
      data: {
        userId: dispatcher.id,
        departmentId: dispatchDept.id,
        unitId: units[0].id,
        status: "on_duty",
        notes: "Seed active dispatch shift."
      }
    });
  }

  for (const notification of [
    { userId: civilian.id, title: "License Active", body: "Your fictional FairCroft driver license is active.", type: "civilian_record" },
    { userId: civilianTwo.id, title: "Application Pending", body: "Your FairCroft Police Department application is awaiting admin review.", type: "application" },
    { userId: police.id, title: "Assigned CAD Call", body: `${cadCall.callNumber} is assigned to your unit.`, type: "cad_assignment" }
  ]) {
    const existing = await prisma.notification.findFirst({
      where: { userId: notification.userId, title: notification.title, body: notification.body }
    });
    if (!existing) {
      await prisma.notification.create({ data: notification });
    }
  }

  await prisma.systemSetting.upsert({
    where: { key: "disclaimer" },
    update: {
      value: {
        text: "FairCroft CoreOne is a fictional roleplay CAD/MDT. It is not affiliated with any real government, NCIC, CJIS, or emergency service."
      },
      updatedById: owner.id
    },
    create: {
      key: "disclaimer",
      updatedById: owner.id,
      value: {
        text: "FairCroft CoreOne is a fictional roleplay CAD/MDT. It is not affiliated with any real government, NCIC, CJIS, or emergency service."
      }
    }
  });

  await prisma.serverConfiguration.upsert({
    where: { key: "seed_profile" },
    update: {
      environment: process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV || "development",
      value: { seededAt: new Date().toISOString(), sampleWarrantNumber: warrant.warrantNumber }
    },
    create: {
      key: "seed_profile",
      environment: process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV || "development",
      value: { seededAt: new Date().toISOString(), sampleWarrantNumber: warrant.warrantNumber },
      updatedById: owner.id
    }
  });

  await prisma.auditLog.create({
    data: {
      actorId: owner.id,
      action: "system.seed",
      entity: "Database",
      metadata: { demoAccounts: true, persistence: "postgresql" }
    }
  });

  console.log("FairCroft CoreOne PostgreSQL seed complete.");
  console.log(`Owner: ${ownerEmail} / ${ownerPassword}`);
  console.log(`Admin: admin@faircroft.local / ${demoPassword}`);
  console.log(`DMV Clerk: dmv@faircroft.local / ${demoPassword}`);
  console.log(`Dispatcher: dispatcher@faircroft.local / ${demoPassword}`);
  console.log(`Police: police@faircroft.local / ${demoPassword}`);
  console.log(`Sheriff: sheriff@faircroft.local / ${demoPassword}`);
  console.log(`Fire: fire@faircroft.local / ${demoPassword}`);
  console.log(`EMS: ems@faircroft.local / ${demoPassword}`);
  console.log(`Civilian: civilian@faircroft.local / ${demoPassword}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
