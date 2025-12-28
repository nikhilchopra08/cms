import { CreateUserSchema, SignupSchema } from "common/inputs";
import { prismaClient } from "db/client";
import { Router } from "express";
import { adminAuthMiddleware } from "../middleware";
import jwt from "jsonwebtoken";
import axios from "axios";

const MPC_SERVER = [
    "http://localhost:3001",
    "http://localhost:3002",
    "http://localhost:3003",
];

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
    }, process.env.ADMIN_JWT_SECRET!);
    
    res.json({
        token
    })

})

router.post("/create-user", adminAuthMiddleware, async (req, res) => {
    const {success, data} = CreateUserSchema.safeParse(req.body);
    if(!success){
        res.status(403).json({
            message : "you are not admin"
        })
        return;
    }

    const user = await prismaClient.user.create({
        data: {
            email : data.email,
            phone : data.number,
            password: data.password,
            role : "USER"
        }
    })

    const responses = await Promise.all(MPC_SERVER.map(async (server) => {
        const response = await axios.post(`${server}/create-user`, {
            userId : user.id
        })
    }))

    res.json({
        message : "User Created",
        user
    })
})