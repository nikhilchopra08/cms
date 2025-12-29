import { SendSchema, SignupSchema } from "common/inputs";
import { prismaClient } from "db/client";
import { Router } from "express";
import { authMiddleware } from "../middleware";
import jwt from "jsonwebtoken";
import { cli, MPC_SERVER, MPC_THRESHOLD } from "./admin";
import axios from "axios";
import { NETWORK } from "common/solana";

const router = Router();

export default router;

router.post("/signin", async (req, res) => {
    console.log("inside the signin")
    const {success, data} = SignupSchema.safeParse(req.body);
    if(!success){
        res.status(403).json({
            message : "incorrect credentials"
        })
        return;
    }

    const email = data.email;
    const password = data.password;

    const user = await prismaClient.user.findFirst({
        where:{
            email
        }
    });

    if(!user){
        res.status(403).json({
            message : "User not found",
        })
        return;
    }

    if(user.password != password){
        res.status(403).json({
            message : "incorrect",
        })
        return;
    }

    const token = jwt.sign({
        userId: user.id
    }, process.env.JWT_SECRET!);
    
    res.json({
        token
    })

})

router.get("/calender/:courseId", authMiddleware, async (req, res) => {
    const courseId = req.params.courseId;
    const course = await prismaClient.course.findFirst({
        where :{
            id : courseId
        }
    })

    const purchase = await prismaClient.purchases.findFirst({
        where: {
            userId: req.userId,
            courseId : courseId
        }
    })

    if(!purchase){
        res.status(411).json({
            message : "you dont have access to course"
        })
        return;
    }

    if(!course){
        res.status(411).json({
            message : "course with id not found"
        })

        return;
    }

    res.json({
        id : course?.id,
        calenderId : course.calendarNotionId
    })
})

router.get("/courses", authMiddleware, async (req, res) => {
    const courses = await prismaClient.course.findMany({
        where: {
            purchases: {
                some: {
                    userId : req.userId
                }
            }
        }
    })

    res.json({
        courses: courses.map(c => ({
            id : c.id,
            title : c.title,
            slug : c.slug
        }))
    })
})


router.post("/send", authMiddleware, async(req, res) => {
    const {success, data} = SendSchema.safeParse(req.body);

    if(!success){
        res.status(403).json({
            message : "Incorrect credentials"
        })
        return;
    }

    const user = await prismaClient.user.findFirst({
        where: {
            id : req.userId
        }
    })

    if(!user){
        res.status(403).json({
            message : "User not found"
        })
        return;
    }

    const recentBlockhash = await cli.recentBlockHash();

    const step1Responses = await Promise.all(MPC_SERVER.map(async (server) => {
        const response = await axios.post(`${server}/send/step1`, {
            to: data.to,
            amount: data.amount,
            userId : req.userId,
            recentBlockhash: recentBlockhash
        })
        return response.data.response
    }))

    console.log("step1 response" , step1Responses);

    
    const step2Responses = await Promise.all(MPC_SERVER.map(async (server, index) => {

        console.log({
            to: data.to,
            amount : data.amount,
            userId : req.userId,
            recentBlockhash: recentBlockhash,
            step1Response: JSON.stringify(step1Responses[index]),
            allPublicNonces: step1Responses.map((r) => r.publicNonce)
        })

        const response = await axios.post(`${server}/send/step2`, {
            to: data.to,
            amount : data.amount,
            userId : req.userId,
            recentBlockhash: recentBlockhash,
            step1Response: JSON.stringify(step1Responses[index]),
            allPublicNonces: step1Responses.map((r) => r.publicNonce)
        })
        return response.data;
    }))

    console.log("step2 response" , step2Responses);

    const partialSignature = step2Responses.map((r) => r.response);

    const transactionDetails = {
        amount : data.amount,
        to : data.to,
        from : user.publicKey,
        network : NETWORK,
        memo : undefined,
        recentBlockhash: recentBlockhash
    }

    const signature = await cli.aggregateSignaturesAndBroadcast(
        JSON.stringify(partialSignature),
        JSON.stringify(transactionDetails),
        JSON.stringify({
            aggregatedPublicKey : user.publicKey,
            participantKeys : step2Responses.map((r) => r.publicKey),
            threshold: MPC_THRESHOLD
        })
    )

    res.json(signature);

})