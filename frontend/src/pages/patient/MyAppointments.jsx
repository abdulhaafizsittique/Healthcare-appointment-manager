import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../../api/client";
import ConnectCalendarButton from "../../components/ConnectCalendarButton";

export default function MyAppointments() {
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const { data } = await api.get("/patient/me/appointments");
    setAppointments(data);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function cancel(id) {
    if (!confirm("Cancel this appointment?")) return;
    await api.post(`/appointments/${id}/cancel`, { reason: "Cancelled by patient" });
    load();
  }

  if (loading) return <div className="container"><p className="muted">Loading...</p></div>;

  return (
    <div className="container">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>My appointments</h1>
        <ConnectCalendarButton />
      </div>
      {appointments.length === 0 && <p className="muted">No appointments yet. <Link to="/patient/doctors">Find a doctor</Link></p>}
      {appointments.map((a) => (
        <div className="card" key={a.id}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <div>
              <h3>Dr. {a.doctor.user.name}</h3>
              <p className="muted">{new Date(a.startTime).toLocaleString()}</p>
            </div>
            <div>
              <span className="badge status">{a.status}</span>
              {a.urgency && <span className={`badge ${a.urgency}`} style={{ marginLeft: 6 }}>{a.urgency}</span>}
            </div>
          </div>
          <div style={{ marginTop: 10 }}>
            <Link to={`/patient/appointments/${a.id}`}><button className="btn secondary">View details</button></Link>
            {a.status === "BOOKED" && (
              <button className="btn danger" style={{ marginLeft: 8 }} onClick={() => cancel(a.id)}>Cancel</button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
