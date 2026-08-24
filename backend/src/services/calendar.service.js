/**
 * Google Calendar Service
 * ------------------------
 * Handles the OAuth 2.0 flow (per-user, patient or doctor) and creates /
 * updates / deletes calendar events on booking, reschedule, and
 * cancellation. If a user hasn't connected Google Calendar, all functions
 * here return { ok: false, error: "not_connected" } instead of throwing -
 * booking must still succeed without a calendar connection.
 */

const { google } = require("googleapis");
const prisma = require("../config/prisma");

function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

function getAuthUrl(state) {
  const client = getOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline", // needed to receive a refresh_token
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/calendar.events"],
    state, // carries the userId so the callback knows who authorized
  });
}

async function handleOAuthCallback(code, userId) {
  const client = getOAuthClient();
  const { tokens } = await client.getToken(code);

  await prisma.googleToken.upsert({
    where: { userId },
    update: {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || undefined, // keep old one if Google omits it on re-consent
      scope: tokens.scope,
      expiryDate: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    },
    create: {
      userId,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || "",
      scope: tokens.scope,
      expiryDate: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    },
  });

  return { ok: true };
}

async function getAuthedCalendarClientForUser(userId) {
  const record = await prisma.googleToken.findUnique({ where: { userId } });
  if (!record) return null;

  const client = getOAuthClient();
  client.setCredentials({
    access_token: record.accessToken,
    refresh_token: record.refreshToken,
    expiry_date: record.expiryDate ? record.expiryDate.getTime() : undefined,
  });

  // Persist refreshed tokens automatically
  client.on("tokens", async (tokens) => {
    await prisma.googleToken.update({
      where: { userId },
      data: {
        accessToken: tokens.access_token || record.accessToken,
        refreshToken: tokens.refresh_token || record.refreshToken,
        expiryDate: tokens.expiry_date ? new Date(tokens.expiry_date) : record.expiryDate,
      },
    }).catch(() => {});
  });

  return google.calendar({ version: "v3", auth: client });
}

async function createEventForUser(userId, { summary, description, startTime, endTime, attendeeEmail }) {
  try {
    const calendar = await getAuthedCalendarClientForUser(userId);
    if (!calendar) return { ok: false, error: "not_connected" };

    const res = await calendar.events.insert({
      calendarId: "primary",
      requestBody: {
        summary,
        description,
        start: { dateTime: new Date(startTime).toISOString() },
        end: { dateTime: new Date(endTime).toISOString() },
        attendees: attendeeEmail ? [{ email: attendeeEmail }] : undefined,
        reminders: { useDefault: true },
      },
    });
    return { ok: true, eventId: res.data.id };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function updateEventForUser(userId, eventId, { summary, description, startTime, endTime }) {
  try {
    const calendar = await getAuthedCalendarClientForUser(userId);
    if (!calendar) return { ok: false, error: "not_connected" };
    if (!eventId) return { ok: false, error: "no_event_id" };

    await calendar.events.patch({
      calendarId: "primary",
      eventId,
      requestBody: {
        summary,
        description,
        start: startTime ? { dateTime: new Date(startTime).toISOString() } : undefined,
        end: endTime ? { dateTime: new Date(endTime).toISOString() } : undefined,
      },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function deleteEventForUser(userId, eventId) {
  try {
    const calendar = await getAuthedCalendarClientForUser(userId);
    if (!calendar) return { ok: false, error: "not_connected" };
    if (!eventId) return { ok: true }; // nothing to delete

    await calendar.events.delete({ calendarId: "primary", eventId });
    return { ok: true };
  } catch (err) {
    // Treat "already deleted" (410/404) as success
    if (err.code === 410 || err.code === 404) return { ok: true };
    return { ok: false, error: err.message };
  }
}

module.exports = {
  getAuthUrl,
  handleOAuthCallback,
  createEventForUser,
  updateEventForUser,
  deleteEventForUser,
};
