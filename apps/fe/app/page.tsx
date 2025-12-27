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
