import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import api from "../../api/client";

const emptyDrug = { drug: "", dosage: "", frequencyPerDay: 2, durationDays: 5 };

export default function DoctorAppointmentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [appt, setAppt] = useState(null);

  const [notes, setNotes] = useState("");
  const [prescription, setPrescription] = useState([{ ...emptyDrug }]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  async function load() {
    const { data } = await api.get(`/doctor/me/appointments/${id}`);
    setAppt(data);
  }
  useEffect(() => { load(); }, [id]);

  function updateDrug(i, field, value) {
    setPrescription((p) => p.map((d, idx) => (idx === i ? { ...d, [field]: value } : d)));
  }
  function addDrug() { setPrescription((p) => [...p, { ...emptyDrug }]); }
  function removeDrug(i) { setPrescription((p) => p.filter((_, idx) => idx !== i)); }

  async function submit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const { data } = await api.post(`/doctor/me/appointments/${id}/complete`, {
        doctorNotes: notes,
        prescription: prescription.filter((p) => p.drug.trim()),
      });
      setResult(data);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to submit");
    } finally {
      setSubmitting(false);
    }
  }

  if (!appt) return <div className="container"><p className="muted">Loading...</p></div>;

  return (
    <div className="container" style={{ maxWidth: 700 }}>
      <h1>{appt.patient.user.name}</h1>
      <p className="muted">{new Date(appt.startTime).toLocaleString()} · {appt.patient.user.email} · <span className="badge status">{appt.status}</span></p>

      <div className="card">
        <h3>Pre-visit AI summary</h3>
        {appt.preVisitSummary ? (
          <>
            <p><b>Urgency:</b> <span className={`badge ${appt.preVisitSummary.urgency}`}>{appt.preVisitSummary.urgency}</span></p>
            <p><b>Chief complaint:</b> {appt.preVisitSummary.chiefComplaint}</p>
            <p><b>Suggested questions:</b></p>
            <ul>{appt.preVisitSummary.questions?.map((q, i) => <li key={i}>{q}</li>)}</ul>
          </>
        ) : <p className="muted">No summary available.</p>}
        <p className="muted"><b>Raw symptoms reported:</b> {appt.symptomsText}</p>
      </div>

      {appt.status === "BOOKED" && !result && (
        <div className="card">
          <h3>Complete visit</h3>
          <form onSubmit={submit}>
            <label>Clinical notes</label>
            <textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} required />

            <label>Prescription</label>
            {prescription.map((p, i) => (
              <div key={i} className="grid grid-3" style={{ marginBottom: 6 }}>
                <input placeholder="Drug name" value={p.drug} onChange={(e) => updateDrug(i, "drug", e.target.value)} />
                <input placeholder="Dosage (e.g. 500mg)" value={p.dosage} onChange={(e) => updateDrug(i, "dosage", e.target.value)} />
                <div style={{ display: "flex", gap: 4 }}>
                  <input type="number" min={1} max={6} placeholder="x/day" value={p.frequencyPerDay} onChange={(e) => updateDrug(i, "frequencyPerDay", Number(e.target.value))} />
                  <input type="number" min={1} max={90} placeholder="days" value={p.durationDays} onChange={(e) => updateDrug(i, "durationDays", Number(e.target.value))} />
                  <button type="button" className="btn danger" onClick={() => removeDrug(i)}>×</button>
                </div>
              </div>
            ))}
            <button type="button" className="btn secondary" onClick={addDrug}>+ Add medication</button>
            <br />
            {error && <div className="error-text">{error}</div>}
            <button className="btn" disabled={submitting}>{submitting ? "Submitting..." : "Complete visit & generate summary"}</button>
          </form>
        </div>
      )}

      {result && (
        <div className="card">
          <h3>Patient-friendly summary generated</h3>
          {!result.llmOk && <p className="muted">AI summary generation failed ({result.llmError}); a fallback message was saved instead.</p>}
          <p style={{ whiteSpace: "pre-wrap" }}>{result.appointment.postVisitSummary}</p>
          <button className="btn" onClick={() => navigate("/doctor/appointments")}>Back to schedule</button>
        </div>
      )}
    </div>
  );
}
