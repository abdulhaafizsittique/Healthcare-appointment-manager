import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../../api/client";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const emptyForm = {
  name: "", email: "", password: "", phone: "", specialisation: "", slotDurationMin: 15, bio: "",
};

export default function AdminDoctors() {
  const [doctors, setDoctors] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [workingDays, setWorkingDays] = useState({}); // { 1: {start, end, checked} }
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);

  async function load() {
    const { data } = await api.get("/admin/doctors");
    setDoctors(data);
  }
  useEffect(() => { load(); }, []);

  function update(field, value) { setForm((f) => ({ ...f, [field]: value })); }
  function toggleDay(d) {
    setWorkingDays((wd) => ({ ...wd, [d]: wd[d] ? { ...wd[d], checked: !wd[d].checked } : { checked: true, start: "09:00", end: "17:00" } }));
  }
  function updateDayTime(d, field, value) {
    setWorkingDays((wd) => ({ ...wd, [d]: { ...wd[d], [field]: value } }));
  }

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setCreating(true);
    try {
      const workingHours = Object.entries(workingDays)
        .filter(([, v]) => v.checked)
        .map(([d, v]) => ({ dayOfWeek: Number(d), startTime: v.start, endTime: v.end }));

      await api.post("/admin/doctors", { ...form, slotDurationMin: Number(form.slotDurationMin), workingHours });
      setForm(emptyForm);
      setWorkingDays({});
      load();
    } catch (err) {
      setError(JSON.stringify(err.response?.data?.error) || "Failed to create doctor");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="container">
      <h1>Doctors</h1>

      <div className="card">
        <h3>Add a new doctor</h3>
        <form onSubmit={submit}>
          <div className="grid grid-2">
            <div><label>Full name</label><input value={form.name} onChange={(e) => update("name", e.target.value)} required /></div>
            <div><label>Email</label><input type="email" value={form.email} onChange={(e) => update("email", e.target.value)} required /></div>
            <div><label>Temporary password</label><input type="password" value={form.password} onChange={(e) => update("password", e.target.value)} required minLength={6} /></div>
            <div><label>Phone</label><input value={form.phone} onChange={(e) => update("phone", e.target.value)} /></div>
            <div><label>Specialisation</label><input value={form.specialisation} onChange={(e) => update("specialisation", e.target.value)} required /></div>
            <div><label>Slot duration (min)</label><input type="number" min={5} max={180} value={form.slotDurationMin} onChange={(e) => update("slotDurationMin", e.target.value)} /></div>
          </div>
          <label>Bio</label>
          <textarea rows={2} value={form.bio} onChange={(e) => update("bio", e.target.value)} />

          <label>Working hours</label>
          {DAYS.map((label, d) => (
            <div key={d} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
              <input type="checkbox" style={{ width: "auto" }} checked={!!workingDays[d]?.checked} onChange={() => toggleDay(d)} />
              <span style={{ width: 40 }}>{label}</span>
              {workingDays[d]?.checked && (
                <>
                  <input type="time" value={workingDays[d].start} onChange={(e) => updateDayTime(d, "start", e.target.value)} style={{ width: 120 }} />
                  <span>to</span>
                  <input type="time" value={workingDays[d].end} onChange={(e) => updateDayTime(d, "end", e.target.value)} style={{ width: 120 }} />
                </>
              )}
            </div>
          ))}

          {error && <div className="error-text">{error}</div>}
          <button className="btn" disabled={creating}>{creating ? "Creating..." : "Create doctor"}</button>
        </form>
      </div>

      <h2>All doctors</h2>
      <div className="grid grid-2">
        {doctors.map((d) => (
          <div className="card" key={d.id}>
            <h3>Dr. {d.user.name}</h3>
            <p className="muted">{d.specialisation} · {d.slotDurationMin} min slots</p>
            <p className="muted">{d.workingHours.length} working-hour blocks · {d.leaves.length} leave entries</p>
            <Link to={`/admin/doctors/${d.id}`}><button className="btn secondary">Manage leave</button></Link>
          </div>
        ))}
      </div>
    </div>
  );
}
