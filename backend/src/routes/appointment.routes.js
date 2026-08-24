const express = require("express");
const { z } = require("zod");
const prisma = require("../config/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const {
  getAvailableSlots,
  holdSlot,
  confirmBooking,
  cancelAppointment,
  HttpError,
} = require("../services/booking.service");
const { generatePreVisitSummary } = require("../services/llm.service");

const router = express.Router();

function handleServiceError(res, err) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  console.error(err);
  return res.status(500).json({ error: "Internal server error" });
}

// GET /api/appointments/availability?doctorId=...&date=YYYY-MM-DD
router.get("/availability", requireAuth, async (req, res) => {
  const { doctorId, date } = req.query;
  if (!doctorId || !date) return res.status(400).json({ error: "doctorId and date are required" });
  try {
    const slots = await getAvailableSlots(String(doctorId), String(date));
    res.json({ doctorId, date, slots });
  } catch (err) {
    handleServiceError(res, err);
  }
});

// Phase 1: patient holds a slot (before filling the symptom form)
router.post("/hold", requireAuth, requireRole("PATIENT"), async (req, res) => {
  const schema = z.object({ doctorId: z.string(), startTime: z.string() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  try {
    const patient = await prisma.patient.findUnique({ where: { userId: req.user.id } });
    const appt = await holdSlot({ doctorId: parsed.data.doctorId, patientId: patient.id, startTime: parsed.data.startTime });
    res.status(201).json(appt);
  } catch (err) {
    handleServiceError(res, err);
  }
});

// Phase 2: patient submits symptoms and confirms the held slot
router.post("/:id/confirm", requireAuth, requireRole("PATIENT"), async (req, res) => {
  const schema = z.object({ symptomsText: z.string().min(3) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  try {
    const patient = await prisma.patient.findUnique({ where: { userId: req.user.id } });
    const result = await confirmBooking({
      appointmentId: req.params.id,
      patientId: patient.id,
      symptomsText: parsed.data.symptomsText,
    });
    res.json(result);
  } catch (err) {
    handleServiceError(res, err);
  }
});

// Regenerate the pre-visit AI summary (e.g. after an earlier LLM failure)
router.post("/:id/regenerate-previsit-summary", requireAuth, async (req, res) => {
  const appt = await prisma.appointment.findUnique({ where: { id: req.params.id } });
  if (!appt) return res.status(404).json({ error: "Not found" });

  const result = await generatePreVisitSummary(appt.symptomsText || "");
  const updated = await prisma.appointment.update({
    where: { id: appt.id },
    data: {
      urgency: result.summary.urgency.toUpperCase(),
      preVisitSummary: JSON.stringify(result.summary),
      preVisitLlmError: result.ok ? null : result.error,
    },
  });
  res.json({ appointment: updated, llmOk: result.ok, llmError: result.ok ? null : result.error });
});

// Cancel (patient, doctor, or admin)
router.post("/:id/cancel", requireAuth, async (req, res) => {
  const schema = z.object({ reason: z.string().optional() });
  const parsed = schema.safeParse(req.body || {});

  try {
    const updated = await cancelAppointment({
      appointmentId: req.params.id,
      actorUserId: req.user.id,
      actorRole: req.user.role,
      reason: parsed.success ? parsed.data.reason : undefined,
    });
    res.json(updated);
  } catch (err) {
    handleServiceError(res, err);
  }
});

module.exports = router;
