import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import api from "../../api/client";

export default function AdminDoctorLeave() {
  const { doctorId } = useParams();
  const [leaves, setLeaves] = useState([]);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    const { data } = await api.get(`/admin/doctors/${doctorId}/leave`);
    setLeaves(data);
  }
  useEffect(() => { load(); }, [doctorId]);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setSubmitting(true);
    try {
      const { data } = await api.post(`/admin/doctors/${doctorId}/leave`, { startDate, endDate, reason });
      setResult(data);
      setStartDate(""); setEndDate(""); setReason("");
      load();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to add leave");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="container" style={{ maxWidth: 600 }}>
      <h1>Manage doctor leave</h1>
      <div className="card">
        <form onSubmit={submit}>
          <div className="grid grid-2">
            <div><label>Start date</label><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required /></div>
            <div><label>End date</label><input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} required /></div>
          </div>
          <label>Reason (optional)</label>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Conference, personal leave" />
          {error && <div className="error-text">{error}</div>}
          <button className="btn" disabled={submitting}>{submitting ? "Saving..." : "Add leave"}</button>
        </form>
        {result && (
          <p className="muted" style={{ marginTop: 10 }}>
            Leave added. {result.affectedAppointments > 0
              ? `${result.affectedAppointments} existing appointment(s) were cancelled and affected patients notified by email.`
              : "No existing appointments were affected."}
          </p>
        )}
      </div>

      <h2>Existing leave</h2>
      {leaves.length === 0 && <p className="muted">No leave recorded.</p>}
      {leaves.map((l) => (
        <div className="card" key={l.id}>
          <p>{new Date(l.startDate).toLocaleDateString()} → {new Date(l.endDate).toLocaleDateString()}</p>
          {l.reason && <p className="muted">{l.reason}</p>}
        </div>
      ))}
    </div>
  );
}
