/**
 * Email Service
 * -------------
 * Thin wrapper around Nodemailer/SMTP so any provider that speaks SMTP
 * (SendGrid, Mailgun, Amazon SES, Gmail, Mailtrap for dev) can be used by
 * only changing .env values. This module never throws to the caller -
 * it always returns { ok, error? } so the Notification outbox worker can
 * decide whether to retry (see jobs/notification.worker.js).
 */

const nodemailer = require("nodemailer");

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  if (!process.env.SMTP_HOST) {
    return null; // not configured
  }

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
  return transporter;
}

async function sendEmail({ to, subject, html, text }) {
  const t = getTransporter();
  if (!t) {
    return { ok: false, error: "SMTP is not configured (missing SMTP_HOST)" };
  }

  try {
    await t.sendMail({
      from: process.env.EMAIL_FROM || "no-reply@clinic.local",
      to,
      subject,
      html,
      text: text || html?.replace(/<[^>]+>/g, ""),
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ---- Templates -------------------------------------------------

function bookingConfirmationEmail({ recipientName, otherPartyName, startTime, doctorName, isDoctor }) {
  const when = new Date(startTime).toLocaleString();
  const subject = "Appointment Confirmed";
  const html = `<p>Hi ${recipientName},</p>
    <p>Your appointment ${isDoctor ? `with patient ${otherPartyName}` : `with Dr. ${doctorName}`} is confirmed for <b>${when}</b>.</p>
    <p>A calendar invite has been sent to your Google Calendar (if connected).</p>
    <p>- Clinic Appointments</p>`;
  return { subject, html };
}

function reminderEmail({ recipientName, startTime, doctorName }) {
  const when = new Date(startTime).toLocaleString();
  return {
    subject: "Appointment Reminder",
    html: `<p>Hi ${recipientName},</p><p>Reminder: your appointment with Dr. ${doctorName} is coming up at <b>${when}</b>.</p>`,
  };
}

function medicationReminderEmail({ recipientName, drugName, dosage }) {
  return {
    subject: "Medication Reminder",
    html: `<p>Hi ${recipientName},</p><p>It's time to take <b>${drugName}</b>${dosage ? ` (${dosage})` : ""} as prescribed.</p>`,
  };
}

function cancellationEmail({ recipientName, startTime, doctorName, reason }) {
  const when = new Date(startTime).toLocaleString();
  return {
    subject: "Appointment Cancelled",
    html: `<p>Hi ${recipientName},</p><p>Your appointment with Dr. ${doctorName} on <b>${when}</b> has been cancelled.${
      reason ? ` Reason: ${reason}` : ""
    }</p><p>Please rebook at your convenience.</p>`,
  };
}

function doctorLeaveConflictEmail({ recipientName, startTime, doctorName }) {
  const when = new Date(startTime).toLocaleString();
  return {
    subject: "Your Appointment Needs Rescheduling",
    html: `<p>Hi ${recipientName},</p><p>Dr. ${doctorName} is unavailable on <b>${when}</b> due to leave. Your appointment has been cancelled - please rebook a new slot. We're sorry for the inconvenience.</p>`,
  };
}

module.exports = {
  sendEmail,
  bookingConfirmationEmail,
  reminderEmail,
  medicationReminderEmail,
  cancellationEmail,
  doctorLeaveConflictEmail,
};
