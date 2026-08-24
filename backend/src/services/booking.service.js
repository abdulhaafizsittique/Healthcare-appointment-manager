/**
 * Booking Service
 * ----------------
 * Core slot-conflict-safe booking logic. See SYSTEM_DESIGN.md for the
 * full write-up; short version:
 *
 * 1. SLOT GENERATION: derived on the fly from Doctor.workingHours +
 *    Doctor.slotDurationMin for a given date, minus slots that clash with
 *    an existing HELD(unexpired)/BOOKED appointment or a DoctorLeave.
 *
 * 2. HOLD MECHANISM: booking is two-phase. `holdSlot()` creates a row with
 *    status=HELD and holdExpiresAt = now + SLOT_HOLD_TTL_MINUTES. This
 *    reserves the slot while the patient fills the symptom form, without
 *    permanently consuming it if they abandon the flow. Expired holds are
 *    treated as free (and opportunistically deleted) by any subsequent
 *    read/write against that slot, plus a cron sweep for hygiene.
 *
 * 3. CONCURRENCY SAFETY: the DB has a UNIQUE index on
 *    (doctorId, startTime) covering ALL statuses. Two simultaneous
 *    `holdSlot`/`confirmBooking` calls for the same slot will race in the
 *    app layer, but only one `prisma.appointment.create` can succeed -
 *    the loser gets a Prisma P2002 unique-constraint error, which we
 *    catch and turn into a clean 409 Conflict. This means correctness
 *    does not depend on application-level locking; the DB is the
 *    source of truth even under concurrent requests / multiple server
 *    instances.
 */

const prisma = require("../config/prisma");
const { generatePreVisitSummary } = require("./llm.service");
const { enqueueEmail, enqueueCalendarSync } = require("./notification.service");

const HOLD_TTL_MIN = Number(process.env.SLOT_HOLD_TTL_MINUTES || 5);

function addMinutes(date, mins) {
  return new Date(date.getTime() + mins * 60000);
}

function toDateOnly(d) {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

/**
 * Returns available slot start times (ISO strings) for a doctor on a
 * given calendar date, respecting working hours, slot duration, leave
 * days, and currently occupied (BOOKED or live HELD) slots.
 */
async function getAvailableSlots(doctorId, dateStr) {
  const doctor = await prisma.doctor.findUnique({
    where: { id: doctorId },
    include: { workingHours: true, leaves: true },
  });
  if (!doctor) throw new HttpError(404, "Doctor not found");

  const date = new Date(dateStr + "T00:00:00.000Z");
  const dayOfWeek = date.getUTCDay();

  // Leave check (inclusive date range)
  const onLeave = doctor.leaves.some((l) => toDateOnly(l.startDate) <= date && date <= toDateOnly(l.endDate));
  if (onLeave) return [];

  const hours = doctor.workingHours.filter((h) => h.dayOfWeek === dayOfWeek);
  if (hours.length === 0) return [];

  // Existing occupied slots for the day (BOOKED, or HELD and not yet expired)
  const dayStart = date;
  const dayEnd = addMinutes(date, 24 * 60);
  const now = new Date();

  const occupied = await prisma.appointment.findMany({
    where: {
      doctorId,
      startTime: { gte: dayStart, lt: dayEnd },
      OR: [{ status: "BOOKED" }, { status: "HELD", holdExpiresAt: { gt: now } }],
    },
    select: { startTime: true },
  });
  const occupiedSet = new Set(occupied.map((o) => o.startTime.toISOString()));

  const slots = [];
  for (const wh of hours) {
    const [startH, startM] = wh.startTime.split(":").map(Number);
    const [endH, endM] = wh.endTime.split(":").map(Number);
    let cursor = new Date(date);
    cursor.setUTCHours(startH, startM, 0, 0);
    const end = new Date(date);
    end.setUTCHours(endH, endM, 0, 0);

    while (addMinutes(cursor, doctor.slotDurationMin) <= end) {
      if (cursor > now && !occupiedSet.has(cursor.toISOString())) {
        slots.push(new Date(cursor).toISOString());
      }
      cursor = addMinutes(cursor, doctor.slotDurationMin);
    }
  }
  return slots.sort();
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * Phase 1: reserve a slot for a patient while they fill the symptom form.
 */
async function holdSlot({ doctorId, patientId, startTime }) {
  const doctor = await prisma.doctor.findUnique({ where: { id: doctorId } });
  if (!doctor) throw new HttpError(404, "Doctor not found");

  const start = new Date(startTime);
  const end = addMinutes(start, doctor.slotDurationMin);
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const existing = await tx.appointment.findUnique({
      where: { doctorId_startTime: { doctorId, startTime: start } },
    });

    if (existing) {
      const isLiveHold = existing.status === "HELD" && existing.holdExpiresAt && existing.holdExpiresAt > now;
      if (existing.status === "BOOKED" || isLiveHold) {
        if (existing.patientId === patientId && isLiveHold) {
          // Same patient re-requesting their own live hold: just extend it.
          return tx.appointment.update({
            where: { id: existing.id },
            data: { holdExpiresAt: addMinutes(now, HOLD_TTL_MIN) },
          });
        }
        throw new HttpError(409, "This slot is no longer available. Please pick another slot.");
      }
      // Expired hold (or stale row) -> reclaim it for this patient.
      return tx.appointment.update({
        where: { id: existing.id },
        data: {
          patientId,
          status: "HELD",
          holdExpiresAt: addMinutes(now, HOLD_TTL_MIN),
          symptomsText: null,
          preVisitSummary: null,
          urgency: null,
          preVisitLlmError: null,
        },
      });
    }

    try {
      return await tx.appointment.create({
        data: {
          doctorId,
          patientId,
          startTime: start,
          endTime: end,
          status: "HELD",
          holdExpiresAt: addMinutes(now, HOLD_TTL_MIN),
        },
      });
    } catch (err) {
      // P2002 = unique constraint violation -> another request won the race.
      if (err.code === "P2002") {
        throw new HttpError(409, "This slot was just booked by someone else. Please pick another slot.");
      }
      throw err;
    }
  });
}

/**
 * Phase 2: patient submits symptoms and confirms. Generates the AI
 * pre-visit summary (gracefully degrading on LLM failure), flips the
 * appointment to BOOKED, and enqueues email + calendar notifications.
 */
async function confirmBooking({ appointmentId, patientId, symptomsText }) {
  const now = new Date();

  const appt = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: { doctor: { include: { user: true } }, patient: { include: { user: true } } },
  });
  if (!appt) throw new HttpError(404, "Appointment hold not found");
  if (appt.patientId !== patientId) throw new HttpError(403, "Not your appointment");
  if (appt.status !== "HELD") throw new HttpError(409, "This hold is no longer valid");
  if (appt.holdExpiresAt && appt.holdExpiresAt < now) {
    throw new HttpError(410, "Your slot hold has expired. Please select a slot again.");
  }

  // LLM call happens outside the DB transaction (it's slow/network-bound);
  // failures are captured, not thrown, per the graceful-degradation requirement.
  const llmResult = await generatePreVisitSummary(symptomsText);

  const updated = await prisma.appointment.update({
    where: { id: appointmentId },
    data: {
      status: "BOOKED",
      holdExpiresAt: null,
      symptomsText,
      urgency: llmResult.summary.urgency.toUpperCase(),
      preVisitSummary: JSON.stringify(llmResult.summary),
      preVisitLlmError: llmResult.ok ? null : llmResult.error,
    },
  });

  await notifyBookingConfirmed(updated, appt.doctor, appt.patient);

  return { appointment: updated, llmOk: llmResult.ok, llmError: llmResult.ok ? null : llmResult.error };
}

async function notifyBookingConfirmed(appointment, doctor, patient) {
  const doctorUser = doctor.user;
  const patientUser = patient.user;

  await enqueueEmail({
    appointmentId: appointment.id,
    userId: patientUser.id,
    type: "BOOKING_CONFIRMATION",
    payload: {
      to: patientUser.email,
      recipientName: patientUser.name,
      doctorName: doctorUser.name,
      startTime: appointment.startTime,
      isDoctor: false,
    },
  });
  await enqueueEmail({
    appointmentId: appointment.id,
    userId: doctorUser.id,
    type: "BOOKING_CONFIRMATION",
    payload: {
      to: doctorUser.email,
      recipientName: doctorUser.name,
      otherPartyName: patientUser.name,
      startTime: appointment.startTime,
      isDoctor: true,
    },
  });

  await enqueueCalendarSync({
    appointmentId: appointment.id,
    userId: patientUser.id,
    type: "BOOKING_CONFIRMATION",
    payload: {
      forUserId: patientUser.id,
      summary: `Appointment with Dr. ${doctorUser.name}`,
      description: "Booked via Clinic Appointments",
      startTime: appointment.startTime,
      endTime: appointment.endTime,
      attendeeEmail: doctorUser.email,
      role: "patient",
    },
  });
  await enqueueCalendarSync({
    appointmentId: appointment.id,
    userId: doctorUser.id,
    type: "BOOKING_CONFIRMATION",
    payload: {
      forUserId: doctorUser.id,
      summary: `Appointment with ${patientUser.name}`,
      description: "Booked via Clinic Appointments",
      startTime: appointment.startTime,
      endTime: appointment.endTime,
      attendeeEmail: patientUser.email,
      role: "doctor",
    },
  });
}

/**
 * Cancels a booked (or held) appointment, releasing the slot, and enqueues
 * cancellation email + calendar-delete for both parties.
 */
async function cancelAppointment({ appointmentId, actorUserId, actorRole, reason }) {
  const appt = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: { doctor: { include: { user: true } }, patient: { include: { user: true } } },
  });
  if (!appt) throw new HttpError(404, "Appointment not found");

  const isOwner =
    (actorRole === "PATIENT" && appt.patient.userId === actorUserId) ||
    (actorRole === "DOCTOR" && appt.doctor.userId === actorUserId) ||
    actorRole === "ADMIN";
  if (!isOwner) throw new HttpError(403, "Not authorized to cancel this appointment");

  if (appt.status === "CANCELLED") return appt;

  const updated = await prisma.appointment.update({
    where: { id: appointmentId },
    data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason || null },
  });

  const doctorUser = appt.doctor.user;
  const patientUser = appt.patient.user;

  for (const [userId, recipientName, otherName] of [
    [patientUser.id, patientUser.name, doctorUser.name],
    [doctorUser.id, doctorUser.name, patientUser.name],
  ]) {
    await enqueueEmail({
      appointmentId: appt.id,
      userId,
      type: "CANCELLATION",
      payload: { to: userId === patientUser.id ? patientUser.email : doctorUser.email, recipientName, doctorName: doctorUser.name, startTime: appt.startTime, reason },
    });
  }

  if (appt.patientCalendarEventId) {
    await enqueueCalendarSync({
      appointmentId: appt.id,
      userId: patientUser.id,
      type: "CANCELLATION",
      payload: { forUserId: patientUser.id, deleteEventId: appt.patientCalendarEventId },
    });
  }
  if (appt.doctorCalendarEventId) {
    await enqueueCalendarSync({
      appointmentId: appt.id,
      userId: doctorUser.id,
      type: "CANCELLATION",
      payload: { forUserId: doctorUser.id, deleteEventId: appt.doctorCalendarEventId },
    });
  }

  return updated;
}

/**
 * Called when an admin marks a doctor on leave for a date range that
 * overlaps existing BOOKED appointments. Cancels each affected
 * appointment and notifies the patient (and doctor) with a dedicated
 * "doctor on leave" email, per the assignment requirement.
 */
async function handleDoctorLeaveConflicts({ doctorId, startDate, endDate }) {
  const affected = await prisma.appointment.findMany({
    where: {
      doctorId,
      status: "BOOKED",
      startTime: { gte: toDateOnly(startDate), lt: addMinutes(toDateOnly(endDate), 24 * 60) },
    },
    include: { doctor: { include: { user: true } }, patient: { include: { user: true } } },
  });

  const results = [];
  for (const appt of affected) {
    const updated = await prisma.appointment.update({
      where: { id: appt.id },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: "Doctor on leave" },
    });

    await enqueueEmail({
      appointmentId: appt.id,
      userId: appt.patient.user.id,
      type: "DOCTOR_LEAVE_CONFLICT",
      payload: {
        to: appt.patient.user.email,
        recipientName: appt.patient.user.name,
        doctorName: appt.doctor.user.name,
        startTime: appt.startTime,
      },
    });

    if (appt.patientCalendarEventId) {
      await enqueueCalendarSync({
        appointmentId: appt.id,
        userId: appt.patient.user.id,
        type: "DOCTOR_LEAVE_CONFLICT",
        payload: { forUserId: appt.patient.user.id, deleteEventId: appt.patientCalendarEventId },
      });
    }
    if (appt.doctorCalendarEventId) {
      await enqueueCalendarSync({
        appointmentId: appt.id,
        userId: appt.doctor.user.id,
        type: "DOCTOR_LEAVE_CONFLICT",
        payload: { forUserId: appt.doctor.user.id, deleteEventId: appt.doctorCalendarEventId },
      });
    }

    results.push(updated);
  }
  return results;
}

/** Sweeps expired HELD rows back to available. Run periodically. */
async function releaseExpiredHolds() {
  const now = new Date();
  const result = await prisma.appointment.deleteMany({
    where: { status: "HELD", holdExpiresAt: { lt: now } },
  });
  return result.count;
}

module.exports = {
  HttpError,
  getAvailableSlots,
  holdSlot,
  confirmBooking,
  cancelAppointment,
  handleDoctorLeaveConflicts,
  releaseExpiredHolds,
};
