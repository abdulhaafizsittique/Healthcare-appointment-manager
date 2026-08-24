import { Routes, Route } from "react-router-dom";
import Navbar from "./components/Navbar";
import ProtectedRoute from "./components/ProtectedRoute";

import Home from "./pages/Home";
import Login from "./pages/auth/Login";
import Register from "./pages/auth/Register";
import CalendarConnected from "./pages/CalendarConnected";

import DoctorSearch from "./pages/patient/DoctorSearch";
import BookAppointment from "./pages/patient/BookAppointment";
import MyAppointments from "./pages/patient/MyAppointments";
import AppointmentDetail from "./pages/patient/AppointmentDetail";

import DoctorAppointments from "./pages/doctor/DoctorAppointments";
import DoctorAppointmentDetail from "./pages/doctor/DoctorAppointmentDetail";

import AdminDoctors from "./pages/admin/AdminDoctors";
import AdminDoctorLeave from "./pages/admin/AdminDoctorLeave";
import AdminNotifications from "./pages/admin/AdminNotifications";

export default function App() {
  return (
    <>
      <Navbar />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/calendar-connected" element={<ProtectedRoute><CalendarConnected /></ProtectedRoute>} />

        {/* Patient portal */}
        <Route path="/patient/doctors" element={<ProtectedRoute roles={["PATIENT"]}><DoctorSearch /></ProtectedRoute>} />
        <Route path="/patient/book/:doctorId" element={<ProtectedRoute roles={["PATIENT"]}><BookAppointment /></ProtectedRoute>} />
        <Route path="/patient/appointments" element={<ProtectedRoute roles={["PATIENT"]}><MyAppointments /></ProtectedRoute>} />
        <Route path="/patient/appointments/:id" element={<ProtectedRoute roles={["PATIENT"]}><AppointmentDetail /></ProtectedRoute>} />

        {/* Doctor portal */}
        <Route path="/doctor/appointments" element={<ProtectedRoute roles={["DOCTOR"]}><DoctorAppointments /></ProtectedRoute>} />
        <Route path="/doctor/appointments/:id" element={<ProtectedRoute roles={["DOCTOR"]}><DoctorAppointmentDetail /></ProtectedRoute>} />

        {/* Admin portal */}
        <Route path="/admin/doctors" element={<ProtectedRoute roles={["ADMIN"]}><AdminDoctors /></ProtectedRoute>} />
        <Route path="/admin/doctors/:doctorId" element={<ProtectedRoute roles={["ADMIN"]}><AdminDoctorLeave /></ProtectedRoute>} />
        <Route path="/admin/notifications" element={<ProtectedRoute roles={["ADMIN"]}><AdminNotifications /></ProtectedRoute>} />

        <Route path="*" element={<Home />} />
      </Routes>
    </>
  );
}
