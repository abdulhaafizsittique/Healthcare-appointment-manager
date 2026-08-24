const express = require("express");
const { z } = require("zod");
const prisma = require("../config/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const { generatePostVisitSummary } = require("../services/llm.service");
const { scheduleMedicationReminders } = require("../jobs/reminder.job");

const router = express.Router();
router.use(requireAuth, requireRole("DOCTOR"));

async function getDoctorId(userId) {
  const doctor = await prisma.doctor.findUnique({ where: { userId } });
  return doctor?.id;
}

router.get("/me/profile", async (req, res) => {
  const doctor = await prisma.doctor.findUnique({
    where: { userId: req.user.id },
    include: { workingHours: true, leaves: true, user: { select: { name: true, email: true } } },
  });
  res.json(doctor);
});

// Doctor's upcoming/past appointments, with the AI pre-visit summary
// surfaced for quick review before each visit.
router.get("/me/appointments", async (req, res) => {
  const doctorId = await getDoctorId(req.user.id);
  const { status } = req.query;
  const appointments = await prisma.appointment.findMany({
    where: { doctorId, status: status ? status : { not: "HELD" } },
    include: { patient: { include: { user: { select: { name: true, email: true, phone: true } } } } },
    orderBy: { startTime: "asc" },
  });

  const withParsedSummary = appointments.map((a) => ({
    ...a,
    preVisitSummary: a.preVisitSummary ? JSON.parse(a.preVisitSummary) : null,
  }));
  res.json(withParsedSummary);
});

router.get("/me/appointments/:id", async (req, res) => {
  const doctorId = await getDoctorId(req.user.id);
  const appt = await prisma.appointment.findFirst({
    where: { id: req.params.id, doctorId },
    include: { patient: { include: { user: { select: { name: true, email: true, phone: true } } } } },
  });
  if (!appt) return res.status(404).json({ error: "Not found" });
  res.json({ ...appt, preVisitSummary: appt.preVisitSummary ? JSON.parse(appt.preVisitSummary) : null });
});

// ---- Post-visit notes + prescription -> AI patient-friendly summary ----
const postVisitSchema = z.object({
  doctorNotes: z.string().min(1),
  prescription: z
    .array(
      z.object({
        drug: z.string(),
        dosage: z.string().optional(),
        frequencyPerDay: z.number().int().min(1).max(6).default(1),
        durationDays: z.number().int().min(1).max(90).default(5),
      })
    )
    .default([]),
});

router.post("/me/appointments/:id/complete", async (req, res) => {
  const doctorId = await getDoctorId(req.user.id);
  const parsed = postVisitSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const appt = await prisma.appointment.findFirst({ where: { id: req.params.id, doctorId } });
  if (!appt) return res.status(404).json({ error: "Not found" });
  if (appt.status !== "BOOKED") return res.status(409).json({ error: "Only booked appointments can be completed" });

  const { doctorNotes, prescription } = parsed.data;
  const prescriptionText = prescription
    .map((p) => `${p.drug} ${p.dosage || ""} - ${p.frequencyPerDay}x/day for ${p.durationDays} days`)
    .join("; ");

  const llmResult = await generatePostVisitSummary(doctorNotes, prescriptionText);

  const updated = await prisma.appointment.update({
    where: { id: appt.id },
    data: {
      status: "COMPLETED",
      doctorNotes,
      prescription: JSON.stringify(prescription),
      postVisitSummary: llmResult.summary,
      postVisitLlmError: llmResult.ok ? null : llmResult.error,
    },
  });

  if (prescription.length > 0) {
    await scheduleMedicationReminders(appt.id, prescription, new Date());
  }

  res.json({ appointment: updated, llmOk: llmResult.ok, llmError: llmResult.ok ? null : llmResult.error });
});

router.post("/me/appointments/:id/no-show", async (req, res) => {
  const doctorId = await getDoctorId(req.user.id);
  const appt = await prisma.appointment.findFirst({ where: { id: req.params.id, doctorId } });
  if (!appt) return res.status(404).json({ error: "Not found" });
  const updated = await prisma.appointment.update({ where: { id: appt.id }, data: { status: "NO_SHOW" } });
  res.json(updated);
});

module.exports = router;
