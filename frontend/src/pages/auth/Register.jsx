import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", email: "", password: "", phone: "" });
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await register({ ...form, role: "PATIENT" });
      navigate("/patient/doctors");
    } catch (err) {
      setError(err.response?.data?.error?.formErrors?.join(", ") || err.response?.data?.error || "Registration failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container" style={{ maxWidth: 420 }}>
      <div className="card">
        <h1>Create a patient account</h1>
        <form onSubmit={onSubmit}>
          <label>Full name</label>
          <input value={form.name} onChange={(e) => update("name", e.target.value)} required />
          <label>Email</label>
          <input type="email" value={form.email} onChange={(e) => update("email", e.target.value)} required />
          <label>Phone (optional)</label>
          <input value={form.phone} onChange={(e) => update("phone", e.target.value)} />
          <label>Password (min 6 characters)</label>
          <input type="password" value={form.password} onChange={(e) => update("password", e.target.value)} required minLength={6} />
          {error && <div className="error-text">{String(error)}</div>}
          <button className="btn" disabled={loading}>{loading ? "Creating..." : "Register"}</button>
        </form>
        <p className="muted" style={{ marginTop: 12 }}>
          Already have an account? <Link to="/login">Log in</Link>
        </p>
      </div>
    </div>
  );
}
