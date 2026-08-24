# System Design Write-up

## 1. Double-booking prevention

Correctness ultimately rests on the database, not application logic, because
application-level checks alone break under concurrent requests (two patients
hitting "book" on the same slot within milliseconds of each other, or
multiple server instances behind a load balancer).

The `Appointment` table has `@@unique([doctorId, startTime])` covering every
status (HELD, BOOKED, CANCELLED, COMPLETED). This means the database itself
physically cannot contain two live rows for the same doctor at the same
start time. The booking flow (`booking.service.js`) works as follows:

1. The app checks for an existing row at that `(doctorId, startTime)` inside
   a Prisma transaction. If one exists and is `BOOKED`, or `HELD` with a
   live (non-expired) TTL belonging to someone else, the request is
   rejected with 409 before any write is attempted.
2. If no row exists, the app calls `create()`. If a second concurrent
   request slipped past the read-check (a classic TOCTOU race), the second
   `create()` fails with Prisma's `P2002` unique-constraint error. The
   service catches this specific error and converts it into a clean 409
   "slot no longer available" response.

This means correctness does not depend on how many app instances are
running or how the requests interleave — the unique index is the single
source of truth, and the app-layer check is purely an optimization to fail
fast with a friendly message in the common case.

## 2. Slot hold mechanism

The assignment requires patients to fill a symptom form *before* the
booking is confirmed, which creates a UX problem: if the slot isn't
reserved during that time, another patient could grab it while the first
is still typing. Permanently reserving on first click is also wrong — an
abandoned form would lock the slot forever.

The solution is a two-phase commit modeled as appointment status:

- **Phase 1 — Hold:** `POST /appointments/hold` creates a row with
  `status=HELD` and `holdExpiresAt = now + SLOT_HOLD_TTL_MINUTES`
  (default 5 minutes). This slot is now excluded from
  `getAvailableSlots()` for everyone else, but it isn't a "real" booking.
- **Phase 2 — Confirm:** `POST /appointments/:id/confirm` is called once
  the patient submits symptoms. It checks the hold hasn't expired,
  triggers the pre-visit LLM summary, and flips the row to `BOOKED`,
  clearing `holdExpiresAt`.

Expired holds are reclaimed lazily (any new hold request on that slot
detects the expiry and overwrites the row) *and* proactively by a
once-a-minute cron job (`releaseExpiredHolds`) that deletes stale HELD
rows, keeping the slots list clean even if nobody else ever requests that
exact slot again. The TTL is short enough to keep inventory fresh but long
enough for a patient to realistically describe their symptoms.

## 3. Doctor leave conflict handling

When an admin adds a `DoctorLeave` record for a date range
(`POST /admin/doctors/:id/leave`), two things happen atomically within the
same request:

1. The leave row is written, which immediately removes any slots in that
   range from future availability (`getAvailableSlots` filters out days
   that fall inside any leave interval).
2. `handleDoctorLeaveConflicts()` queries all existing `BOOKED`
   appointments that overlap the new leave range, cancels each one
   (`status=CANCELLED`, `cancelReason="Doctor on leave"`), and enqueues a
   dedicated `DOCTOR_LEAVE_CONFLICT` email to the affected patient, plus a
   calendar-delete for any linked Google Calendar event. The admin's
   response includes the count of affected appointments so they get
   immediate confirmation the notification pipeline was triggered.

This keeps the leave workflow single-step for the admin — they don't have
to separately hunt down and cancel each conflicting appointment.

## 4. Notification failure handling

Emails and calendar syncs are two of the most failure-prone parts of the
system (SMTP hiccups, expired OAuth tokens, rate limits), so they are never
sent synchronously inside a request handler. Instead, every notification
the system owes a user is first written as a row in the `Notification`
table — an **outbox pattern**. Booking, cancellation, and leave-conflict
handlers only ever *enqueue*; they never call SMTP or the Calendar API
directly, so a slow or failing email provider can never make the booking
API itself slow or fail.

A cron job runs every minute, picks up `PENDING`/`RETRYING` rows whose
`nextAttemptAt` has passed, and attempts delivery. On failure, the row's
`attempts` counter increments and `nextAttemptAt` is pushed out with
exponential backoff (1, 2, 4, 8, 16 minutes) up to 5 attempts, after which
it's marked `FAILED` for admin visibility (surfaced in the admin
Notifications tab) rather than retried forever. A special case —
`"not_connected"` for Google Calendar — is treated as permanently
non-retryable rather than transient, since retrying won't help until the
user re-authorizes. This design means a temporary SMTP or Google API outage
self-heals without any lost notifications or manual intervention, while a
genuinely broken destination surfaces clearly instead of silently vanishing.
