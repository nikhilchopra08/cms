"use client";

import { useEffect, useState } from "react";

export default function CalendarPage() {
  const [calendarId, setCalendarId] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) {
      setError("Unauthorized");
      return;
    }

    fetch("http://localhost:3000/calender/COURSE_ID_HERE", {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(data => setCalendarId(data.calenderId))
      .catch(() => setError("Failed to load calendar"));
  }, []);

  if (error) return <p className="text-red-500">{error}</p>;
  if (!calendarId) return <p>Loading...</p>;

  return (
    <iframe
      src={`https://notion.so/${calendarId}`}
      className="w-full h-[80vh] rounded-xl border border-neutral-800"
    />
  );
}
