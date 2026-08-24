import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import api from "../../api/client";

export default function AppointmentDetail() {
  const { id } = useParams();
  const [appt, setAppt] = useState(null);

  async function load() {
    const { data } = await api.get(`/patient/me/appointments/${id}`);
    setAppt(data);
  }
  useEffect(() => { load(); }, [id]);

  if (!appt) return <div className="container"><p className="muted">Loading...</p></div>;

  const preVisit = appt.preVisitSummary ? JSON.parse(appt.preVisitSummary) : null;
  let prescription = [];
  try { prescription = appt.prescription ? JSON.parse(appt.prescription) : []; } catch {}

  return (
    <div className="container" style={{ maxWidth: 700 }}>
      <h1>Appointment with Dr. {appt.doctor.user.name}</h1>
      <p className="muted">{new Date(appt.startTime).toLocaleString()} · <span className="badge status">{appt.status}</span></p>

      {preVisit && (
        <div className="card">
          <h3>Your pre-visit summary</h3>
          <p><b>Urgency:</b> <span className={`badge ${preVisit.urgency}`}>{preVisit.urgency}</span></p>
          <p><b>Chief complaint:</b> {preVisit.chiefComplaint}</p>
        </div>
      )}

      {appt.status === "COMPLETED" && (
        <div className="card">
          <h3>Visit summary</h3>
          {appt.postVisitLlmError && <p className="muted">(AI summary generation had an issue — showing fallback text)</p>}
          <p style={{ whiteSpace: "pre-wrap" }}>{appt.postVisitSummary}</p>

          {prescription.length > 0 && (
            <>
              <h3>Medication schedule</h3>
              <ul>
                {prescription.map((p, i) => (
                  <li key={i}>{p.drug} {p.dosage} — {p.frequencyPerDay}x/day for {p.durationDays} days</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
