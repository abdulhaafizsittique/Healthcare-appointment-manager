const express = require("express");
const prisma = require("../config/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth, requireRole("PATIENT"));

async function getPatientId(userId) {
  const patient = await prisma.patient.findUnique({ where: { userId } });
  return patient?.id;
}

// Search doctors by specialisation (case-insensitive partial match) or list all.
router.get("/doctors", async (req, res) => {
  const { specialisation } = req.query;
  const doctors = await prisma.doctor.findMany({
    where: specialisation
      ? { specialisation: { contains: String(specialisation) } }
      : undefined,
    include: {
      user: { select: { name: true, email: true } },
      workingHours: true,
    },
  });
  res.json(doctors);
});

router.get("/me/appointments", async (req, res) => {
  const patientId = await getPatientId(req.user.id);
  const appointments = await prisma.appointment.findMany({
    where: { patientId, status: { not: "HELD" } },
    include: { doctor: { include: { user: { select: { name: true, email: true } } } } },
    orderBy: { startTime: "desc" },
  });
  res.json(appointments);
});

router.get("/me/appointments/:id", async (req, res) => {
  const patientId = await getPatientId(req.user.id);
  const appt = await prisma.appointment.findFirst({
    where: { id: req.params.id, patientId },
    include: { doctor: { include: { user: { select: { name: true, email: true } } } } },
  });
  if (!appt) return res.status(404).json({ error: "Not found" });
  res.json(appt);
});

module.exports = router;
