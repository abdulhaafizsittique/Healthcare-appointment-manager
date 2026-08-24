import { useEffect, useState } from "react";
import api from "../../api/client";

export default function AdminNotifications() {
  const [notifications, setNotifications] = useState([]);
  const [status, setStatus] = useState("");

  async function load() {
    const { data } = await api.get("/admin/notifications", { params: status ? { status } : {} });
    setNotifications(data);
  }
  useEffect(() => { load(); }, [status]);

  return (
    <div className="container">
      <h1>Notification outbox</h1>
      <div className="tabs">
        {["", "PENDING", "RETRYING", "SENT", "FAILED"].map((s) => (
          <button key={s} className={status === s ? "active" : ""} onClick={() => setStatus(s)}>{s || "All"}</button>
        ))}
      </div>
      {notifications.map((n) => (
        <div className="card" key={n.id}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <b>{n.type}</b>
            <span className="badge status">{n.status}</span>
          </div>
          <p className="muted">{n.channel} · attempts: {n.attempts} · created {new Date(n.createdAt).toLocaleString()}</p>
          {n.lastError && <p className="error-text">{n.lastError}</p>}
        </div>
      ))}
      {notifications.length === 0 && <p className="muted">No notifications in this state.</p>}
    </div>
  );
}
