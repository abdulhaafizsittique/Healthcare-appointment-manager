import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../../api/client";
import ConnectCalendarButton from "../../components/ConnectCalendarButton";

export default function DoctorAppointments() {
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const { data } = await api.get("/doctor/me/appointments", { params: { status: "BOOKED" } });
    setAppointments(data);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  if (loading) return <div className="container"><p className="muted">Loading...</p></div>;

  return (
    <div className="container">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Upcoming appointments</h1>
        <ConnectCalendarButton />
      </div>
      {appointments.length === 0 && <p className="muted">No upcoming appointments.</p>}
      {appointments.map((a) => (
        <div className="card" key={a.id}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <div>
              <h3>{a.patient.user.name}</h3>
              <p className="muted">{new Date(a.startTime).toLocaleString()}</p>
            </div>
            {a.urgency && <span className={`badge ${a.urgency}`}>{a.urgency}</span>}
          </div>
          {a.preVisitSummary && (
            <div style={{ marginTop: 8 }}>
              <p><b>Chief complaint:</b> {a.preVisitSummary.chiefComplaint}</p>
              <p className="muted"><b>Suggested questions:</b> {a.preVisitSummary.questions?.join(" · ")}</p>
              {a.preVisitLlmError && <p className="muted">(AI summary fell back to defaults: {a.preVisitLlmError})</p>}
            </div>
          )}
          <Link to={`/doctor/appointments/${a.id}`}><button className="btn">Open</button></Link>
        </div>
      ))}
    </div>
  );
}
