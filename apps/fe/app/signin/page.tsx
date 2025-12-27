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
