"use client"

import { Course, useCourse, useCourses } from "../hooks/course";

export function CourseToggle({ loading, setSelectedCourse, selectedCourse, courses }: { loading: boolean, setSelectedCourse: (course: Course) => void, selectedCourse: Course, courses: Course[] }) {


    if (loading) return <div>loading...</div>

    console.log(courses)

    return (
        <div>
            <select value={selectedCourse?.id} onChange={(e) => {
                const course = courses.find(c => c.id === e.target.value);
                if (course) {
                    setSelectedCourse(course);
                }
            }}
            >
                {courses.map((course) => (
                    <option key={course.id} value={course.id}>
                        {course.title}
                    </option>
                ))}
            </select>
        </div>
    )
}