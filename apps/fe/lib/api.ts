const BASE = process.env.NEXT_BACKEND_URL || "http://localhost:3000";

async function handle(res: Response) {
  if (!res.ok) {
    let msg = "Request failed";
    try {
      const j = await res.json();
      msg = j?.message || msg;
    } catch {}
    throw new Error(msg);
  }
  return res.json();
}

export async function getCalendar(courseId: string, token: string): Promise<{ id: string; calendarId: string }> {
  const res = await fetch(`${BASE}/calender/${courseId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return handle(res);
}