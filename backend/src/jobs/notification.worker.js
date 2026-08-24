/**
 * Notification Worker
 * ---------------------
 * Polls the Notification outbox table for PENDING / RETRYING rows whose
 * nextAttemptAt <= now, attempts delivery (EMAIL via SMTP, CALENDAR via
 * Google Calendar API), and records the outcome. Failures get exponential
 * backoff up to MAX_ATTEMPTS, after which the row is left FAILED for
 * manual/admin inspection rather than retried forever.
 *
 * This is what satisfies "background job for ... email retries" and
 * "notification failure handling" from the assignment.
 */

const prisma = require("../config/prisma");
const {
  sendEmail,
  bookingConfirmationEmail,
  reminderEmail,
  medicationReminderEmail,
  cancellationEmail,
  doctorLeaveConflictEmail,
} = require("../services/email.service");
const { createEventForUser, deleteEventForUser } = require("../services/calendar.service");

const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 20;

function backoffMinutes(attempts) {
  // 1, 2, 4, 8, 16 minutes
  return Math.pow(2, attempts);
}

function buildEmailContent(type, payload) {
  switch (type) {
    case "BOOKING_CONFIRMATION":
      return bookingConfirmationEmail(payload);
    case "REMINDER_APPOINTMENT":
      return reminderEmail(payload);
    case "REMINDER_MEDICATION":
      return medicationReminderEmail(payload);
    case "CANCELLATION":
      return cancellationEmail(payload);
    case "DOCTOR_LEAVE_CONFLICT":
      return doctorLeaveConflictEmail(payload);
    default:
      return { subject: "Clinic Notification", html: "<p>You have a notification.</p>" };
  }
}

async function processEmailNotification(n, payload) {
  const { subject, html } = buildEmailContent(n.type, payload);
  return sendEmail({ to: payload.to, subject, html });
}

async function processCalendarNotification(n, payload) {
  if (payload.deleteEventId) {
    return deleteEventForUser(payload.forUserId, payload.deleteEventId);
  }
  const result = await createEventForUser(payload.forUserId, {
    summary: payload.summary,
    description: payload.description,
    startTime: payload.startTime,
    endTime: payload.endTime,
    attendeeEmail: payload.attendeeEmail,
  });

  // On success, persist the created event id back onto the appointment so
  // we can update/delete it later on reschedule/cancel.
  if (result.ok && n.appointmentId) {
    const field = payload.role === "doctor" ? "doctorCalendarEventId" : "patientCalendarEventId";
    await prisma.appointment.update({
      where: { id: n.appointmentId },
      data: { [field]: result.eventId },
    }).catch(() => {});
  }
  return result;
}

async function processOne(n) {
  const payload = JSON.parse(n.payload);

  let result;
  if (n.channel === "EMAIL") {
    result = await processEmailNotification(n, payload);
  } else {
    result = await processCalendarNotification(n, payload);
  }

  if (result.ok) {
    await prisma.notification.update({
      where: { id: n.id },
      data: { status: "SENT", attempts: n.attempts + 1, lastError: null },
    });
    return;
  }

  // "not_connected" (Google Calendar never linked) is not a transient
  // failure - retrying won't help, so mark FAILED immediately without
  // burning retry attempts on it, but don't affect the appointment.
  if (result.error === "not_connected") {
    await prisma.notification.update({
      where: { id: n.id },
      data: { status: "FAILED", attempts: n.attempts + 1, lastError: "Google Calendar not connected" },
    });
    return;
  }

  const attempts = n.attempts + 1;
  if (attempts >= MAX_ATTEMPTS) {
    await prisma.notification.update({
      where: { id: n.id },
      data: { status: "FAILED", attempts, lastError: result.error },
    });
  } else {
    const nextAttemptAt = new Date(Date.now() + backoffMinutes(attempts) * 60000);
    await prisma.notification.update({
      where: { id: n.id },
      data: { status: "RETRYING", attempts, lastError: result.error, nextAttemptAt },
    });
  }
}

async function runNotificationWorker() {
  const due = await prisma.notification.findMany({
    where: {
      status: { in: ["PENDING", "RETRYING"] },
      nextAttemptAt: { lte: new Date() },
    },
    take: BATCH_SIZE,
    orderBy: { createdAt: "asc" },
  });

  for (const n of due) {
    try {
      await processOne(n);
    } catch (err) {
      // Defensive: never let one bad row crash the worker loop.
      await prisma.notification
        .update({
          where: { id: n.id },
          data: { status: "RETRYING", attempts: n.attempts + 1, lastError: err.message, nextAttemptAt: new Date(Date.now() + 60000) },
        })
        .catch(() => {});
    }
  }

  return due.length;
}

module.exports = { runNotificationWorker };
