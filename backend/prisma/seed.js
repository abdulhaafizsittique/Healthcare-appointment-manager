require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

async function main() {
  const password = await bcrypt.hash("Password123!", 10);

  const admin = await prisma.user.upsert({
    where: { email: "admin@clinic.local" },
    update: {},
    create: { email: "admin@clinic.local", passwordHash: password, name: "Clinic Admin", role: "ADMIN" },
  });

  const doctorUser = await prisma.user.upsert({
    where: { email: "dr.rao@clinic.local" },
    update: {},
    create: {
      email: "dr.rao@clinic.local",
      passwordHash: password,
      name: "Dr. Anjali Rao",
      role: "DOCTOR",
      doctorProfile: {
        create: {
          specialisation: "General Medicine",
          slotDurationMin: 15,
          bio: "10+ years in general practice.",
          workingHours: {
            create: [
              { dayOfWeek: 1, startTime: "09:00", endTime: "13:00" },
              { dayOfWeek: 2, startTime: "09:00", endTime: "13:00" },
              { dayOfWeek: 3, startTime: "09:00", endTime: "13:00" },
              { dayOfWeek: 4, startTime: "09:00", endTime: "13:00" },
              { dayOfWeek: 5, startTime: "09:00", endTime: "13:00" },
            ],
          },
        },
      },
    },
  });

  const patientUser = await prisma.user.upsert({
    where: { email: "patient@demo.local" },
    update: {},
    create: {
      email: "patient@demo.local",
      passwordHash: password,
      name: "Demo Patient",
      role: "PATIENT",
      patientProfile: { create: {} },
    },
  });

  console.log("Seeded:");
  console.log("  Admin:   admin@clinic.local   / Password123!");
  console.log("  Doctor:  dr.rao@clinic.local  / Password123!");
  console.log("  Patient: patient@demo.local   / Password123!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
