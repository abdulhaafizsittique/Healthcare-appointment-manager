/**
 * Reminder Job
 * -------------
 * Two responsibilities, run on a schedule:
 *   1. Appointment reminders - email patient + doctor ~24h before a
 *      BOOKED appointment (once).
 *   2. Medication reminders - MedicationReminder rows (created when the
 *      doctor submits a prescription, one row per dose time derived from
 *      frequency) that are due get enqueued as EMAIL notifications.
 */

const prisma = require("../config/prisma");
const { enqueueEmail } = require("../services/notification.service");

async function sendAppointmentReminders() {
  const now = new Date();
  const windowStart = new Date(now.getTime() + 23 * 60 * 60000);
  const windowEnd = new Date(now.getTime() + 25 * 60 * 60000);

  const upcoming = await prisma.appointment.findMany({
    where: { status: "BOOKED", startTime: { gte: windowStart, lte: windowEnd } },
    include: { doctor: { include: { user: true } }, patient: { include: { user: true } } },
  });

  let count = 0;
  for (const appt of upcoming) {
    // Idempotency guard: skip if a reminder notification already exists for this appointment.
    const already = await prisma.notification.findFirst({
      where: { appointmentId: appt.id, type: "REMINDER_APPOINTMENT" },
    });
    if (already) continue;

    await enqueueEmail({
      appointmentId: appt.id,
      userId: appt.patient.user.id,
      type: "REMINDER_APPOINTMENT",
      payload: {
        to: appt.patient.user.email,
        recipientName: appt.patient.user.name,
        doctorName: appt.doctor.user.name,
        startTime: appt.startTime,
      },
    });
    await enqueueEmail({
      appointmentId: appt.id,
      userId: appt.doctor.user.id,
      type: "REMINDER_APPOINTMENT",
      payload: {
        to: appt.doctor.user.email,
        recipientName: appt.doctor.user.name,
        doctorName: appt.doctor.user.name,
        startTime: appt.startTime,
      },
    });
    count++;
  }
  return count;
}

async function sendMedicationReminders() {
  const now = new Date();
  const due = await prisma.medicationReminder.findMany({
    where: { sent: false, scheduledAt: { lte: now } },
    include: {
      appointment: { include: { patient: { include: { user: true } } } },
    },
    take: 100,
  });

  for (const reminder of due) {
    await enqueueEmail({
      appointmentId: reminder.appointmentId,
      userId: reminder.appointment.patient.user.id,
      type: "REMINDER_MEDICATION",
      payload: {
        to: reminder.appointment.patient.user.email,
        recipientName: reminder.appointment.patient.user.name,
        drugName: reminder.drugName,
        dosage: reminder.dosage,
      },
    });
    await prisma.medicationReminder.update({
      where: { id: reminder.id },
      data: { sent: true, sentAt: new Date() },
    });
  }
  return due.length;
}

/**
 * Given a structured prescription array and the appointment's completion
 * time, creates MedicationReminder rows. Frequency is interpreted as
 * times-per-day, spaced evenly starting 1 hour after the visit.
 * Example prescription item: { drug: "Amoxicillin", dosage: "500mg",
 * frequencyPerDay: 3, durationDays: 5 }
 */
async function scheduleMedicationReminders(appointmentId, prescriptionItems, startFrom = new Date()) {
  const created = [];
  for (const item of prescriptionItems) {
    const perDay = Math.max(1, Number(item.frequencyPerDay) || 1);
    const days = Math.max(1, Number(item.durationDays) || 1);
    const intervalHours = 24 / perDay;

    for (let day = 0; day < days; day++) {
      for (let dose = 0; dose < perDay; dose++) {
        const scheduledAt = new Date(
          startFrom.getTime() + day * 24 * 60 * 60000 + dose * intervalHours * 60 * 60000 + 60 * 60000
        );
        created.push(
          await prisma.medicationReminder.create({
            data: {
              appointmentId,
              drugName: item.drug,
              dosage: item.dosage || null,
              scheduledAt,
            },
          })
        );
      }
    }
  }
  return created;
}

module.exports = { sendAppointmentReminders, sendMedicationReminders, scheduleMedicationReminders };
