"use client"
import Link from "next/link";
import { CourseToggle } from "../../components/CourseToggle";
import { useCourse, useCourses } from "../../hooks/course";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
    const {loading, selectedCourse, setSelectedCourse} = useCourse();
    const {courses} = useCourses();

    const courseId = selectedCourse?.id;

    console.log(courseId);
    

  return (
    <div className="flex min-h-screen">
      <aside className="w-64 bg-neutral-900 p-6">
        {/* <h2 className="font-bold text-lg mb-6">Dashboard</h2> */}
        <CourseToggle loading={loading} selectedCourse={selectedCourse} setSelectedCourse={setSelectedCourse} courses={courses}/>
        <nav className="flex flex-col gap-3">
          <Link href={`/dashboard/calendar/${courseId}`}>Calendar</Link>
          <Link href="/dashboard/wallet">Wallet</Link>
        </nav>
      </aside>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
