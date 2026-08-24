import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";

const roleHome = { PATIENT: "/patient/doctors", DOCTOR: "/doctor/appointments", ADMIN: "/admin/doctors" };

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const user = await login(email, password);
      navigate(roleHome[user.role] || "/");
    } catch (err) {
      setError(err.response?.data?.error || "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container" style={{ maxWidth: 420 }}>
      <div className="card">
        <h1>Log in</h1>
        <p className="muted">
          Demo accounts (after seeding): admin@clinic.local / dr.rao@clinic.local / patient@demo.local — password{" "}
          <code>Password123!</code>
        </p>
        <form onSubmit={onSubmit}>
          <label>Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <label>Password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          {error && <div className="error-text">{error}</div>}
          <button className="btn" disabled={loading}>{loading ? "Logging in..." : "Log in"}</button>
        </form>
        <p className="muted" style={{ marginTop: 12 }}>
          No account? <Link to="/register">Register as a patient</Link>
        </p>
      </div>
    </div>
  );
}
