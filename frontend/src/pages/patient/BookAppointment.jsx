import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import api from "../../api/client";

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export default function BookAppointment() {
  const { doctorId } = useParams();
  const navigate = useNavigate();

  const [date, setDate] = useState(todayStr());
  const [slots, setSlots] = useState([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slotsError, setSlotsError] = useState(null);

  const [heldAppointment, setHeldAppointment] = useState(null);
  const [holding, setHolding] = useState(false);
  const [holdError, setHoldError] = useState(null);

  const [symptoms, setSymptoms] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState(null);
  const [confirmedResult, setConfirmedResult] = useState(null);

  async function loadSlots() {
    setLoadingSlots(true);
    setSlotsError(null);
    try {
      const { data } = await api.get("/appointments/availability", { params: { doctorId, date } });
      setSlots(data.slots);
    } catch (err) {
      setSlotsError(err.response?.data?.error || "Failed to load slots");
    } finally {
      setLoadingSlots(false);
    }
  }

  useEffect(() => { loadSlots(); }, [date]);

  async function pickSlot(startTime) {
    setHolding(true);
    setHoldError(null);
    try {
      const { data } = await api.post("/appointments/hold", { doctorId, startTime });
      setHeldAppointment(data);
    } catch (err) {
      setHoldError(err.response?.data?.error || "Could not hold this slot. It may have just been taken.");
      loadSlots(); // refresh so the taken slot disappears
    } finally {
      setHolding(false);
    }
  }

  async function confirm(e) {
    e.preventDefault();
    setConfirming(true);
    setConfirmError(null);
    try {
      const { data } = await api.post(`/appointments/${heldAppointment.id}/confirm`, { symptomsText: symptoms });
      setConfirmedResult(data);
    } catch (err) {
      setConfirmError(err.response?.data?.error || "Could not confirm booking. Your hold may have expired.");
    } finally {
      setConfirming(false);
    }
  }

  if (confirmedResult) {
    return (
      <div className="container" style={{ maxWidth: 560 }}>
        <div className="card">
          <h1>✅ Appointment booked</h1>
          <p>Your appointment is confirmed for <b>{new Date(confirmedResult.appointment.startTime).toLocaleString()}</b>.</p>
          {!confirmedResult.llmOk && (
            <p className="muted">
              Note: the AI pre-visit summary couldn't be generated right now ({confirmedResult.llmError}). A safe default
              summary was saved and the doctor can regenerate it later.
            </p>
          )}
          <p className="muted">A confirmation email and calendar invite (if connected) are on their way.</p>
          <button className="btn" onClick={() => navigate("/patient/appointments")}>View my appointments</button>
        </div>
      </div>
    );
  }

  if (heldAppointment) {
    const expiresIn = Math.max(0, Math.round((new Date(heldAppointment.holdExpiresAt) - new Date()) / 60000));
    return (
      <div className="container" style={{ maxWidth: 560 }}>
        <div className="card">
          <h1>Tell us your symptoms</h1>
          <p className="muted">
            Slot held: <b>{new Date(heldAppointment.startTime).toLocaleString()}</b> — please complete this within ~{expiresIn || 5} minutes or the hold will expire.
          </p>
          <form onSubmit={confirm}>
            <label>Describe your symptoms</label>
            <textarea
              rows={5}
              value={symptoms}
              onChange={(e) => setSymptoms(e.target.value)}
              placeholder="e.g. Fever for 2 days, mild headache, sore throat..."
              required
              minLength={3}
            />
            {confirmError && <div className="error-text">{confirmError}</div>}
            <button className="btn" disabled={confirming}>{confirming ? "Confirming..." : "Confirm booking"}</button>
            <button type="button" className="btn secondary" onClick={() => setHeldAppointment(null)} style={{ marginLeft: 8 }}>
              Choose a different slot
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <h1>Book an appointment</h1>
      <div className="card">
        <label>Date</label>
        <input type="date" value={date} min={todayStr()} onChange={(e) => setDate(e.target.value)} />

        {holdError && <div className="error-text">{holdError}</div>}
        {loadingSlots ? (
          <p className="muted">Loading available slots...</p>
        ) : slotsError ? (
          <p className="error-text">{slotsError}</p>
        ) : slots.length === 0 ? (
          <p className="muted">No available slots on this date (doctor may be off or fully booked).</p>
        ) : (
          <div className="slot-grid">
            {slots.map((s) => (
              <button key={s} className="slot-btn" disabled={holding} onClick={() => pickSlot(s)}>
                {new Date(s).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
