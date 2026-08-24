import api from "../api/client";

export default function ConnectCalendarButton() {
  async function connect() {
    const { data } = await api.get("/calendar/oauth/connect");
    window.location.href = data.url;
  }
  return (
    <button className="btn secondary" onClick={connect}>
      📅 Connect Google Calendar
    </button>
  );
}
