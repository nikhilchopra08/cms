#!/bin/bash
set -e

APP_NAME="fe"

echo "Creating frontend app: $APP_NAME"

mkdir -p $APP_NAME/app/dashboard/calendar
mkdir -p $APP_NAME/app/dashboard/wallet

# ---------------- package.json ----------------
cat > $APP_NAME/package.json <<'EOF'
{
  "name": "fe",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start"
  },
  "dependencies": {
    "next": "16.1.0",
    "react": "^19.2.0",
    "react-dom": "^19.2.0"
  },
  "devDependencies": {
    "tailwindcss": "^3.4.17",
    "postcss": "^8.4.38",
    "autoprefixer": "^10.4.19",
    "typescript": "^5.9.2",
    "@types/react": "^19.2.2",
    "@types/node": "^22.15.3"
  }
}
EOF

# ---------------- tailwind ----------------
cat > $APP_NAME/tailwind.config.js <<'EOF'
export default {
  content: ["./app/**/*.{ts,tsx}"],
  theme: {
    extend: {}
  },
  plugins: []
};
EOF

cat > $APP_NAME/postcss.config.js <<'EOF'
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {}
  }
};
EOF

# ---------------- globals.css ----------------
cat > $APP_NAME/app/globals.css <<'EOF'
@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  background-color: #0a0a0a;
  color: #ededed;
}
EOF

# ---------------- layout ----------------
cat > $APP_NAME/app/layout.tsx <<'EOF'
import "./globals.css";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
EOF

# ---------------- landing page ----------------
cat > $APP_NAME/app/page.tsx <<'EOF'
import Link from "next/link";

export default function Landing() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center text-center px-6">
      <h1 className="text-5xl font-bold">Course Calendar</h1>
      <p className="mt-4 text-neutral-400 max-w-md">
        Access your purchased course calendars synced from Notion.
      </p>
      <Link
        href="/signin"
        className="mt-8 px-6 py-3 bg-white text-black font-semibold rounded-lg"
      >
        Sign In
      </Link>
    </main>
  );
}
EOF

# ---------------- signin ----------------
mkdir -p $APP_NAME/app/signin
cat > $APP_NAME/app/signin/page.tsx <<'EOF'
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SignIn() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function submit() {
    setError("");

    const res = await fetch("http://localhost:3000/signin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });

    if (!res.ok) {
      setError("Invalid credentials");
      return;
    }

    const data = await res.json();
    localStorage.setItem("token", data.token);
    router.push("/dashboard");
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-full max-w-sm bg-neutral-900 p-6 rounded-xl">
        <h2 className="text-xl font-semibold mb-4">Sign In</h2>

        <input
          className="w-full mb-3 px-3 py-2 bg-neutral-800 rounded"
          placeholder="Email"
          onChange={e => setEmail(e.target.value)}
        />

        <input
          type="password"
          className="w-full mb-3 px-3 py-2 bg-neutral-800 rounded"
          placeholder="Password"
          onChange={e => setPassword(e.target.value)}
        />

        {error && <p className="text-red-500 text-sm mb-2">{error}</p>}

        <button
          onClick={submit}
          className="w-full bg-white text-black py-2 rounded font-semibold"
        >
          Sign In
        </button>
      </div>
    </div>
  );
}
EOF

# ---------------- dashboard layout ----------------
cat > $APP_NAME/app/dashboard/layout.tsx <<'EOF'
import Link from "next/link";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <aside className="w-64 bg-neutral-900 p-6">
        <h2 className="font-bold text-lg mb-6">Dashboard</h2>
        <nav className="flex flex-col gap-3">
          <Link href="/dashboard/calendar">Calendar</Link>
          <Link href="/dashboard/wallet">Wallet</Link>
        </nav>
      </aside>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
EOF

# ---------------- dashboard index ----------------
cat > $APP_NAME/app/dashboard/page.tsx <<'EOF'
export default function Dashboard() {
  return (
    <div>
      <h1 className="text-2xl font-semibold">Welcome</h1>
      <p className="text-neutral-400 mt-2">
        Use the sidebar.
      </p>
    </div>
  );
}
EOF

# ---------------- calendar ----------------
cat > $APP_NAME/app/dashboard/calendar/page.tsx <<'EOF'
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
EOF

# ---------------- wallet ----------------
cat > $APP_NAME/app/dashboard/wallet/page.tsx <<'EOF'
export default function Wallet() {
  return (
    <div>
      <h1 className="text-2xl font-semibold">Wallet</h1>
      <p className="text-neutral-400 mt-2">
        Nothing here yet.
      </p>
    </div>
  );
}
EOF

echo "Frontend created in apps/$APP_NAME"
echo "Next steps:"
echo "cd fe"
echo "npm install"
echo "npm run dev"

