import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate("/login");
  }

  return (
    <div className="navbar">
      <Link to="/" className="brand">🏥 Clinic Appointments</Link>
      <nav>
        {!user && (
          <>
            <Link to="/login">Login</Link>
            <Link to="/register">Register</Link>
          </>
        )}
        {user?.role === "PATIENT" && (
          <>
            <Link to="/patient/doctors">Find a Doctor</Link>
            <Link to="/patient/appointments">My Appointments</Link>
          </>
        )}
        {user?.role === "DOCTOR" && <Link to="/doctor/appointments">My Schedule</Link>}
        {user?.role === "ADMIN" && (
          <>
            <Link to="/admin/doctors">Doctors</Link>
            <Link to="/admin/notifications">Notifications</Link>
          </>
        )}
        {user && (
          <>
            <span className="muted" style={{ marginLeft: 16 }}>
              {user.name} ({user.role})
            </span>
            <button onClick={handleLogout}>Logout</button>
          </>
        )}
      </nav>
    </div>
  );
}
