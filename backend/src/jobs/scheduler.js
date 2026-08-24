const cron = require("node-cron");
const { runNotificationWorker } = require("./notification.worker");
const { sendAppointmentReminders, sendMedicationReminders } = require("./reminder.job");
const { releaseExpiredHolds } = require("../services/booking.service");

function startScheduler() {
  // Outbox worker: every minute, attempt delivery of due notifications
  // (new + retries with backoff).
  cron.schedule("* * * * *", async () => {
    try {
      await runNotificationWorker();
    } catch (err) {
      console.error("[notification.worker] error:", err.message);
    }
  });

  // Medication reminders: check every 5 minutes for doses now due.
  cron.schedule("*/5 * * * *", async () => {
    try {
      await sendMedicationReminders();
    } catch (err) {
      console.error("[reminder.job:medication] error:", err.message);
    }
  });

  // Appointment reminders (~24h out): check hourly.
  cron.schedule("0 * * * *", async () => {
    try {
      await sendAppointmentReminders();
    } catch (err) {
      console.error("[reminder.job:appointment] error:", err.message);
    }
  });

  // Release abandoned slot holds every minute so they don't block booking.
  cron.schedule("* * * * *", async () => {
    try {
      await releaseExpiredHolds();
    } catch (err) {
      console.error("[booking.releaseExpiredHolds] error:", err.message);
    }
  });

  console.log("Background jobs scheduled: notification worker, reminders, hold cleanup");
}

module.exports = { startScheduler };
