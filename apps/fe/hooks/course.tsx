"use client"
import { useEffect, useState } from "react"
import axios from "axios"

export interface Course{
    id : string,
    title : string,
    slug : string
}

export const useCourses = () => {
    const [loading, setLoading] = useState(true);
    const [courses, setCourses] = useState<Course[]>([]);

    console.log(process.env.NEXT_PUBLIC_BACKEND_URL)

    useEffect(() => {
        axios.get(`${process.env.NEXT_PUBLIC_BACKEND_URL}/courses`,{
            headers: {
                Authorization: `Bearer ${localStorage.getItem("token")}`
            }
        })
            .then(res => {
                setCourses(res.data.courses);
                setLoading(false);
            })
    }, []);

    return {loading, courses};
}

export const useCourse = () => {
    const { loading, courses } = useCourses();
    const [selectedCourse, setSelectedCourse] = useState<Course>();

    useEffect(() => {
        setSelectedCourse(courses[0])
    }, [courses])


    return{
        loading, selectedCourse, setSelectedCourse
    }
}