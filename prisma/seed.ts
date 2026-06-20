import "dotenv/config";

import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const ownerEmail = process.env.OWNER_EMAIL || "owner@faircroft.local";
const ownerPassword = process.env.OWNER_PASSWORD || "ChangeMe123!";
const ownerName = process.env.OWNER_NAME || "FairCroft Owner";

async function upsertUser(input: {
  email: string;
  password: string;
  name: string;
  role: any;
  phone?: string;
  firstName: string;
  lastName: string;
}) {
  const passwordHash = await bcrypt.hash(input.password, 12);

  return prisma.user.upsert({
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
      role: input.role,
      profile: {
        create: {
          firstName: input.firstName,
          lastName: input.lastName,
          city: "FairCroft",
          state: "FC",
          phone: input.phone,
          address: "100 Civic Plaza"
        }
      }
    },
    include: { profile: true }
  });
}

async function main() {
  const departments = await Promise.all([
    prisma.department.upsert({
      where: { code: "FCPD" },
      update: {},
      create: {
        name: "FairCroft Police Department",
        code: "FCPD",
        type: "police",
        description: "Municipal law enforcement and patrol services for FairCroft."
      }
    }),
    prisma.department.upsert({
      where: { code: "FCSO" },
      update: {},
      create: {
        name: "FairCroft Sheriff Office",
        code: "FCSO",
        type: "sheriff",
        description: "County-level patrol, courts, and corrections roleplay operations."
      }
    }),
    prisma.department.upsert({
      where: { code: "FCFD" },
      update: {},
      create: {
        name: "FairCroft Fire Department",
        code: "FCFD",
        type: "fire",
        description: "Fire suppression, rescue, and public safety response."
      }
    }),
    prisma.department.upsert({
      where: { code: "FCEMS" },
      update: {},
      create: {
        name: "FairCroft EMS",
        code: "FCEMS",
        type: "ems",
        description: "Roleplay-only emergency medical response and transport."
      }
    }),
    prisma.department.upsert({
      where: { code: "FCCD" },
      update: {},
      create: {
        name: "FairCroft Communications Dispatch",
        code: "FCCD",
        type: "dispatch",
        description: "Communications center for 911 intake, CAD management, and radio logs."
      }
    })
  ]);

  for (const department of departments) {
    await prisma.rank.upsert({
      where: { departmentId_name: { departmentId: department.id, name: "Member" } },
      update: {},
      create: {
        departmentId: department.id,
        name: "Member",
        level: 10,
        permissions: { cad: true, records: true }
      }
    });

    await prisma.rank.upsert({
      where: { departmentId_name: { departmentId: department.id, name: "Supervisor" } },
      update: {},
      create: {
        departmentId: department.id,
        name: "Supervisor",
        level: 90,
        permissions: { cad: true, records: true, roster: true, unitManagement: true }
      }
    });
  }

  const owner = await upsertUser({
    email: ownerEmail,
    password: ownerPassword,
    name: ownerName,
    role: "owner",
    phone: "555-0100",
    firstName: ownerName.split(" ")[0] || "FairCroft",
    lastName: ownerName.split(" ").slice(1).join(" ") || "Owner"
  });

  const dispatcher = await upsertUser({
    email: "dispatcher@faircroft.local",
    password: "Password123!",
    name: "Avery Dispatch",
    role: "dispatcher",
    phone: "555-0111",
    firstName: "Avery",
    lastName: "Dispatch"
  });

  const officer = await upsertUser({
    email: "officer@faircroft.local",
    password: "Password123!",
    name: "Jordan Pike",
    role: "police",
    phone: "555-0121",
    firstName: "Jordan",
    lastName: "Pike"
  });

  const civilian = await upsertUser({
    email: "civilian@faircroft.local",
    password: "Password123!",
    name: "Riley Stone",
    role: "civilian",
    phone: "555-0199",
    firstName: "Riley",
    lastName: "Stone"
  });

  const dispatchDept = departments.find((department) => department.code === "FCCD")!;
  const policeDept = departments.find((department) => department.code === "FCPD")!;
  const dispatchRank = await prisma.rank.findFirst({ where: { departmentId: dispatchDept.id, name: "Supervisor" } });
  const policeRank = await prisma.rank.findFirst({ where: { departmentId: policeDept.id, name: "Member" } });

  await prisma.departmentMembership.upsert({
    where: { userId_departmentId: { userId: owner.id, departmentId: dispatchDept.id } },
    update: { active: true, role: "owner", rankId: dispatchRank?.id },
    create: {
      userId: owner.id,
      departmentId: dispatchDept.id,
      role: "owner",
      rankId: dispatchRank?.id,
      badgeNumber: "FC-000"
    }
  });

  await prisma.departmentMembership.upsert({
    where: { userId_departmentId: { userId: dispatcher.id, departmentId: dispatchDept.id } },
    update: { active: true, role: "dispatcher", rankId: dispatchRank?.id },
    create: {
      userId: dispatcher.id,
      departmentId: dispatchDept.id,
      role: "dispatcher",
      rankId: dispatchRank?.id,
      badgeNumber: "D-104"
    }
  });

  await prisma.departmentMembership.upsert({
    where: { userId_departmentId: { userId: officer.id, departmentId: policeDept.id } },
    update: { active: true, role: "police", rankId: policeRank?.id },
    create: {
      userId: officer.id,
      departmentId: policeDept.id,
      role: "police",
      rankId: policeRank?.id,
      badgeNumber: "P-214"
    }
  });

  await prisma.cadUnit.upsert({
    where: { unitNumber: "DISP-1" },
    update: { userId: dispatcher.id, departmentId: dispatchDept.id, active: true },
    create: {
      unitNumber: "DISP-1",
      userId: dispatcher.id,
      departmentId: dispatchDept.id,
      status: "TEN_8_AVAILABLE",
      currentLocation: "FairCroft Communications Center"
    }
  });

  await prisma.cadUnit.upsert({
    where: { unitNumber: "2L-14" },
    update: { userId: officer.id, departmentId: policeDept.id, active: true },
    create: {
      unitNumber: "2L-14",
      userId: officer.id,
      departmentId: policeDept.id,
      status: "TEN_8_AVAILABLE",
      currentLocation: "Downtown Sector"
    }
  });

  await prisma.license.upsert({
    where: { number: "FC-DL-100245" },
    update: {},
    create: {
      userId: civilian.id,
      number: "FC-DL-100245",
      class: "D",
      status: "active",
      expiresAt: new Date("2030-12-31")
    }
  });

  await prisma.vehicle.upsert({
    where: { plate: "FCX742" },
    update: {},
    create: {
      ownerId: civilian.id,
      make: "Karin",
      model: "Asterope",
      year: 2020,
      color: "Graphite",
      plate: "FCX742",
      vin: "FCROLEPLAYVIN742",
      registrationStatus: "active",
      expiresAt: new Date("2027-06-30")
    }
  });

  await prisma.permit.upsert({
    where: { number: "FC-FP-4419" },
    update: {},
    create: {
      userId: civilian.id,
      type: "Firearm Permit",
      number: "FC-FP-4419",
      status: "active",
      expiresAt: new Date("2028-03-15"),
      notes: "Fictional roleplay permit. No real-world validity."
    }
  });

  const pending = await prisma.departmentApplication.findFirst({
    where: { userId: civilian.id, departmentId: policeDept.id, status: "pending" }
  });

  if (!pending) {
    await prisma.departmentApplication.create({
      data: {
        userId: civilian.id,
        departmentId: policeDept.id,
        desiredRole: "police",
        statement: "I would like to join patrol operations and learn FairCroft radio procedures.",
        experience: "Prior civilian ride-along roleplay."
      }
    });
  }

  await prisma.bolo.create({
    data: {
      title: "Training BOLO: Red Compact",
      description: "Fictional seed BOLO for MDT demonstration. Red compact last seen near Market Street.",
      plate: "TRAIN1",
      vehicleDescription: "Red compact sedan",
      createdById: dispatcher.id
    }
  });

  await prisma.serverSetting.upsert({
    where: { key: "disclaimer" },
    update: {
      value: {
        text: "FairCroft CoreOne is a fictional roleplay CAD/MDT. It is not affiliated with any real government, NCIC, CJIS, or emergency service."
      }
    },
    create: {
      key: "disclaimer",
      value: {
        text: "FairCroft CoreOne is a fictional roleplay CAD/MDT. It is not affiliated with any real government, NCIC, CJIS, or emergency service."
      }
    }
  });

  console.log("FairCroft CoreOne seed complete.");
  console.log(`Owner: ${ownerEmail} / ${ownerPassword}`);
  console.log("Demo dispatcher: dispatcher@faircroft.local / Password123!");
  console.log("Demo officer: officer@faircroft.local / Password123!");
  console.log("Demo civilian: civilian@faircroft.local / Password123!");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
