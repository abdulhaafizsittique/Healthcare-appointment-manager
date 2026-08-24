import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../../api/client";

export default function DoctorSearch() {
  const [doctors, setDoctors] = useState([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  async function load(specialisation) {
    setLoading(true);
    const { data } = await api.get("/patient/doctors", { params: specialisation ? { specialisation } : {} });
    setDoctors(data);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="container">
      <h1>Find a doctor</h1>
      <div className="card">
        <label>Search by specialisation</label>
        <div style={{ display: "flex", gap: 8 }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Cardiology, General Medicine" />
          <button className="btn" onClick={() => load(q)}>Search</button>
          <button className="btn secondary" onClick={() => { setQ(""); load(); }}>Clear</button>
        </div>
      </div>

      {loading ? (
        <p className="muted">Loading doctors...</p>
      ) : doctors.length === 0 ? (
        <p className="muted">No doctors found.</p>
      ) : (
        <div className="grid grid-2">
          {doctors.map((d) => (
            <div className="card" key={d.id}>
              <h3>Dr. {d.user.name}</h3>
              <p className="muted">{d.specialisation} · {d.slotDurationMin} min slots</p>
              {d.bio && <p>{d.bio}</p>}
              <Link to={`/patient/book/${d.id}`}>
                <button className="btn">Book appointment</button>
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
