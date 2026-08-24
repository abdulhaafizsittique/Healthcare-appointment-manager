const express = require("express");
const bcrypt = require("bcryptjs");
const { z } = require("zod");
const prisma = require("../config/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const { handleDoctorLeaveConflicts } = require("../services/booking.service");

const router = express.Router();
router.use(requireAuth, requireRole("ADMIN"));

// ---- Create a doctor (account + profile + optional working hours) ----
const createDoctorSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().min(1),
  phone: z.string().optional(),
  specialisation: z.string().min(1),
  slotDurationMin: z.number().int().min(5).max(180).default(15),
  bio: z.string().optional(),
  workingHours: z
    .array(
      z.object({
        dayOfWeek: z.number().int().min(0).max(6),
        startTime: z.string().regex(/^\d{2}:\d{2}$/),
        endTime: z.string().regex(/^\d{2}:\d{2}$/),
      })
    )
    .optional(),
});

router.post("/doctors", async (req, res) => {
  const parsed = createDoctorSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { email, password, name, phone, specialisation, slotDurationMin, bio, workingHours } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return res.status(409).json({ error: "Email already registered" });

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      name,
      phone,
      role: "DOCTOR",
      doctorProfile: {
        create: {
          specialisation,
          slotDurationMin,
          bio,
          workingHours: workingHours ? { create: workingHours } : undefined,
        },
      },
    },
    include: { doctorProfile: { include: { workingHours: true } } },
  });

  const { passwordHash: _, ...safeUser } = user;
  res.status(201).json(safeUser);
});

router.get("/doctors", async (req, res) => {
  const doctors = await prisma.doctor.findMany({
    include: { user: { select: { id: true, name: true, email: true, phone: true } }, workingHours: true, leaves: true },
  });
  res.json(doctors);
});

router.put("/doctors/:doctorId", async (req, res) => {
  const schema = z.object({
    specialisation: z.string().optional(),
    slotDurationMin: z.number().int().min(5).max(180).optional(),
    bio: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const doctor = await prisma.doctor.update({ where: { id: req.params.doctorId }, data: parsed.data });
  res.json(doctor);
});

// ---- Working hours ----
router.put("/doctors/:doctorId/working-hours", async (req, res) => {
  const schema = z.array(
    z.object({
      dayOfWeek: z.number().int().min(0).max(6),
      startTime: z.string().regex(/^\d{2}:\d{2}$/),
      endTime: z.string().regex(/^\d{2}:\d{2}$/),
    })
  );
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const doctorId = req.params.doctorId;
  await prisma.$transaction([
    prisma.workingHour.deleteMany({ where: { doctorId } }),
    prisma.workingHour.createMany({ data: parsed.data.map((h) => ({ ...h, doctorId })) }),
  ]);
  const hours = await prisma.workingHour.findMany({ where: { doctorId } });
  res.json(hours);
});

// ---- Leave days (triggers patient notification for conflicts) ----
const leaveSchema = z.object({
  startDate: z.string(), // "YYYY-MM-DD"
  endDate: z.string(),
  reason: z.string().optional(),
});

router.post("/doctors/:doctorId/leave", async (req, res) => {
  const parsed = leaveSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const doctorId = req.params.doctorId;
  const { startDate, endDate, reason } = parsed.data;

  const leave = await prisma.doctorLeave.create({
    data: { doctorId, startDate: new Date(startDate), endDate: new Date(endDate), reason },
  });

  // Requirement: patients with existing bookings in this range must be notified.
  const cancelled = await handleDoctorLeaveConflicts({ doctorId, startDate, endDate });

  res.status(201).json({ leave, affectedAppointments: cancelled.length });
});

router.get("/doctors/:doctorId/leave", async (req, res) => {
  const leaves = await prisma.doctorLeave.findMany({ where: { doctorId: req.params.doctorId } });
  res.json(leaves);
});

router.delete("/leave/:leaveId", async (req, res) => {
  await prisma.doctorLeave.delete({ where: { id: req.params.leaveId } });
  res.status(204).end();
});

// ---- Dashboard / oversight ----
router.get("/appointments", async (req, res) => {
  const appointments = await prisma.appointment.findMany({
    include: {
      doctor: { include: { user: { select: { name: true } } } },
      patient: { include: { user: { select: { name: true } } } },
    },
    orderBy: { startTime: "desc" },
    take: 200,
  });
  res.json(appointments);
});

router.get("/notifications", async (req, res) => {
  const { status } = req.query;
  const notifications = await prisma.notification.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  res.json(notifications);
});

module.exports = router;
