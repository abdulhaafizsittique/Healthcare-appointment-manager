# Healthcare Appointment & Follow-up Manager

A clinic platform with three portals (Patient / Doctor / Admin) covering:
booking with symptom intake, AI pre-visit and post-visit summaries,
email notifications, Google Calendar sync, medication reminders, and
robust handling of double-booking / doctor-leave conflicts.

```
healthcare-appointment-manager/
├── backend/     Express API + Prisma ORM + SQLite (swappable to Postgres)
├── frontend/    React (Vite) SPA with role-based portals
└── SYSTEM_DESIGN.md   800-word design write-up (conflicts, holds, notifications)
```

---

## 1. Quick start (local)

### Prerequisites
- Node.js 18+
- npm

### Backend

```bash
cd backend
cp .env.example .env      # edit values (see section 4 for required keys)
npm install
npx prisma generate
npx prisma migrate dev --name init   # creates dev.db (SQLite) and applies schema
npm run seed                          # creates demo admin/doctor/patient accounts
npm run dev                           # starts API on http://localhost:4000
```

Demo accounts created by `npm run seed` (password for all: `Password123!`):

| Role    | Email                  |
|---------|-------------------------|
| Admin   | admin@clinic.local      |
| Doctor  | dr.rao@clinic.local     |
| Patient | patient@demo.local      |

### Frontend

```bash
cd frontend
cp .env.example .env      # VITE_API_URL defaults to http://localhost:4000/api
npm install
npm run dev                # starts on http://localhost:5173
```

Open http://localhost:5173, log in with one of the seeded accounts, or
register a new patient account.

---

## 2. Deploying (free hosting)

The repo is split into two deployable units:

**Backend → Render / Railway**
1. Push this repo to GitHub.
2. Create a new Web Service pointing at `/backend`.
3. Build command: `npm install && npx prisma generate && npx prisma migrate deploy`
4. Start command: `npm start`
5. Add all variables from `backend/.env.example` in the host's environment settings.
   - For a persistent DB on Render/Railway, switch `provider` in `prisma/schema.prisma`
     to `"postgresql"` and use the free Postgres add-on's connection string as
     `DATABASE_URL` (SQLite's local file won't survive redeploys on most PaaS).
6. Run `npm run seed` once via the platform's shell/console (optional, for demo data).

**Frontend → Vercel / Netlify**
1. Import the repo, set the project root to `/frontend`.
2. Build command: `npm run build`, output directory: `dist`.
3. Set env var `VITE_API_URL` to your deployed backend URL + `/api`.
4. Update backend's `FRONTEND_URL` env var to the deployed frontend URL (used for CORS and OAuth redirects).

---

## 3. Database schema

Defined in `backend/prisma/schema.prisma`. Key models:

- **User** — `role` (ADMIN/DOCTOR/PATIENT), auth fields, 1:1 with `GoogleToken` (Calendar OAuth).
- **Doctor** — profile, `specialisation`, `slotDurationMin`; has many `WorkingHour` (recurring weekly availability) and `DoctorLeave` (date-range unavailability).
- **Patient** — profile linked 1:1 to `User`.
- **Appointment** — the core booking record:
  - `status`: `HELD → BOOKED → COMPLETED` (or `CANCELLED` / `NO_SHOW`)
  - `holdExpiresAt`: TTL for the temporary hold before a patient confirms (see §5)
  - Pre-visit: `symptomsText`, `preVisitSummary` (JSON), `urgency`, `preVisitLlmError`
  - Post-visit: `doctorNotes`, `prescription` (JSON), `postVisitSummary`, `postVisitLlmError`
  - Calendar: `patientCalendarEventId`, `doctorCalendarEventId`
  - **`@@unique([doctorId, startTime])`** — the DB-level guarantee against double-booking.
- **MedicationReminder** — one row per scheduled dose, derived from the prescription's frequency/duration.
- **Notification** — the outbox table. Every email/calendar action the system owes a user is a row here (`status`: PENDING → SENT/FAILED/RETRYING), processed by the background worker. This is how notification failures are retried instead of silently dropped.

Run `npx prisma studio` from `/backend` for a visual DB browser.

---

## 4. Environment variables

See `backend/.env.example` and `frontend/.env.example` for the full list with inline comments. The functionally required ones:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | SQLite file path (dev) or Postgres URL (prod) |
| `JWT_SECRET` | Signs auth tokens |
| `ANTHROPIC_API_KEY` | Enables the two LLM summary features (app still runs and books appointments without it — see §6) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `EMAIL_FROM` | Any SMTP provider — SendGrid, Mailgun, Amazon SES, Gmail, or Mailtrap for local testing |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` | Google Calendar OAuth (see §7) |
| `SLOT_HOLD_TTL_MINUTES` | How long a slot stays reserved while a patient fills the symptom form (default 5) |

---

## 5. API reference

Base URL: `/api`. Auth via `Authorization: Bearer <JWT>` header (obtained from `/auth/login`).

### Auth
| Method | Path | Role | Body |
|---|---|---|---|
| POST | `/auth/register` | public | `{email, password, name, phone?, role: "PATIENT"\|"DOCTOR"}` |
| POST | `/auth/login` | public | `{email, password}` |

### Appointments (booking core)
| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/appointments/availability?doctorId=&date=YYYY-MM-DD` | any | Returns free slot start times for that date |
| POST | `/appointments/hold` | PATIENT | `{doctorId, startTime}` → creates a `HELD` row with a TTL (phase 1 of booking) |
| POST | `/appointments/:id/confirm` | PATIENT | `{symptomsText}` → runs pre-visit LLM, flips to `BOOKED`, enqueues email + calendar notifications (phase 2) |
| POST | `/appointments/:id/regenerate-previsit-summary` | any | Re-runs the LLM if it failed earlier |
| POST | `/appointments/:id/cancel` | PATIENT/DOCTOR/ADMIN | `{reason?}` → cancels, enqueues cancellation email + calendar-delete |

### Patient portal
| Method | Path | Notes |
|---|---|---|
| GET | `/patient/doctors?specialisation=` | Search doctors |
| GET | `/patient/me/appointments` | Own appointment history |
| GET | `/patient/me/appointments/:id` | Detail incl. post-visit summary |

### Doctor portal
| Method | Path | Notes |
|---|---|---|
| GET | `/doctor/me/appointments?status=BOOKED` | Schedule with parsed pre-visit AI summary |
| GET | `/doctor/me/appointments/:id` | Full detail |
| POST | `/doctor/me/appointments/:id/complete` | `{doctorNotes, prescription:[{drug,dosage,frequencyPerDay,durationDays}]}` → runs post-visit LLM, schedules medication reminders |
| POST | `/doctor/me/appointments/:id/no-show` | Marks a booked appointment as no-show |

### Admin portal
| Method | Path | Notes |
|---|---|---|
| POST | `/admin/doctors` | Create doctor account + profile (+ optional `workingHours`) |
| GET | `/admin/doctors` | List all doctors |
| PUT | `/admin/doctors/:id` | Update profile fields |
| PUT | `/admin/doctors/:id/working-hours` | Replace weekly schedule |
| POST | `/admin/doctors/:id/leave` | `{startDate, endDate, reason?}` → **auto-cancels conflicting bookings and notifies affected patients** |
| GET/DELETE | `/admin/doctors/:id/leave`, `/admin/leave/:leaveId` | List/remove leave entries |
| GET | `/admin/appointments` | All appointments (oversight) |
| GET | `/admin/notifications?status=` | Outbox monitor (PENDING/RETRYING/SENT/FAILED) |

### Calendar
| Method | Path | Notes |
|---|---|---|
| GET | `/calendar/oauth/connect` | Returns the Google consent URL for the logged-in user |
| GET | `/calendar/oauth/callback` | Google redirects here; stores tokens |

---

## 6. LLM prompts & failure handling

Implemented in `backend/src/services/llm.service.js`, calling the Anthropic
Messages API directly (model set via `ANTHROPIC_MODEL`, default
`claude-sonnet-4-6`).

**Pre-visit summary prompt:**
```
Analyse these symptoms and return ONLY valid JSON (no markdown, no prose) in this exact shape:
{"urgency": "Low" | "Medium" | "High", "chiefComplaint": string, "questions": [string, string, string]}
Symptoms: <symptoms>
```

**Post-visit summary prompt:**
```
Convert these clinical notes into a patient-friendly summary with a medication
schedule and follow-up steps. Use short sections with headings:
"What we found", "Your medication schedule", "Follow-up steps".
Clinical notes: <notes>
Prescription: <prescription>
```

**Failure handling** (required by the assignment — "system should not break"):
- Every call has a 15s timeout and is wrapped in try/catch; nothing is ever thrown up to the booking/notes route.
- On any failure (missing API key, network error, timeout, malformed JSON response), the service returns `{ok:false, error, summary:<safe fallback>}`. The route still saves the fallback, sets `preVisitLlmError` / `postVisitLlmError` on the appointment, and booking/visit-completion proceeds normally.
- The frontend surfaces this transparently ("AI summary fell back to defaults") rather than hiding it.
- `POST /appointments/:id/regenerate-previsit-summary` lets anyone retry once the LLM is available again.

---

## 7. Google Calendar setup

1. Go to the [Google Cloud Console](https://console.cloud.google.com/apis/credentials), create a project (or reuse one).
2. Enable the **Google Calendar API** (APIs & Services → Library).
3. Configure the OAuth consent screen (External, add your test users while in testing mode).
4. Create an **OAuth 2.0 Client ID** (Web application).
   - Authorized redirect URI: `http://localhost:4000/api/calendar/oauth/callback` (dev) or your deployed backend's equivalent URL.
5. Copy the Client ID/Secret into `backend/.env` as `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, and set `GOOGLE_REDIRECT_URI` to match exactly what you registered.
6. In the app, a logged-in patient or doctor clicks **"Connect Google Calendar"** (on their appointments page) → consents → tokens are stored in the `GoogleToken` table → future bookings automatically create/update/delete events on their primary calendar.
7. If a user never connects Calendar, calendar notifications are marked `FAILED` with reason "Google Calendar not connected" in the outbox — booking and email notifications are unaffected.

---

## 8. Background jobs

Wired in `backend/src/jobs/scheduler.js` via `node-cron`, started alongside the API server:

| Job | Schedule | Purpose |
|---|---|---|
| Notification worker | every 1 min | Sends PENDING/RETRYING outbox rows (email + calendar), with exponential backoff (1,2,4,8,16 min) up to 5 attempts before marking `FAILED` |
| Medication reminders | every 5 min | Sends due `MedicationReminder` rows as emails |
| Appointment reminders | hourly | Emails patient + doctor ~24h before a `BOOKED` appointment (idempotent — checked via existing notification row) |
| Expired-hold cleanup | every 1 min | Deletes `HELD` appointments past their `holdExpiresAt` so abandoned bookings don't block a slot forever |

---

## 9. Tech stack

- **Backend:** Node.js, Express, Prisma ORM, SQLite (swap to Postgres for prod), JWT auth, Zod validation, node-cron, Nodemailer, googleapis
- **Frontend:** React 18, React Router, Axios, Vite
- **LLM:** Anthropic Claude API (direct HTTPS call, no SDK dependency)
