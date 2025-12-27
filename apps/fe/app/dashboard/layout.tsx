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
