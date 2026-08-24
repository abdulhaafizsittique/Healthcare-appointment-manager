import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Navigate } from "react-router-dom";

const roleHome = { PATIENT: "/patient/doctors", DOCTOR: "/doctor/appointments", ADMIN: "/admin/doctors" };

export default function Home() {
  const { user } = useAuth();
  if (user) return <Navigate to={roleHome[user.role]} replace />;

  return (
    <div className="container">
      <div className="card">
        <h1>Welcome to Clinic Appointments</h1>
        <p className="muted">
          Book appointments, share symptoms in advance, and get AI-powered pre-visit and post-visit summaries,
          with email and Google Calendar sync.
        </p>
        <Link to="/login"><button className="btn">Log in</button></Link>
        <Link to="/register"><button className="btn secondary" style={{ marginLeft: 8 }}>Register as a patient</button></Link>
      </div>
    </div>
  );
}
