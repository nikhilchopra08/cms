import { CreateUserSchema, SendSchema, SignupSchema } from "common/inputs";
import { prismaClient } from "db/client";
import { Router } from "express";
import { adminAuthMiddleware } from "../middleware";
import jwt from "jsonwebtoken";
import axios from "axios";
import { TSSCli } from "solana-mpc-tss-lib/mpc";
import { NETWORK } from "common/solana"

export const MPC_SERVER = [
    "http://localhost:3001",
    // "http://localhost:3002",
    // "http://localhost:3003",
];

export const MPC_THRESHOLD = Math.max(1, MPC_SERVER.length - 1);

export const cli = new TSSCli(NETWORK);

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

    console.log(success)
    if(!success){
        res.status(403).json({
            message : "you are not allowed to create user"
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
        return response.data;
    }))

    console.log(responses);

    const aggregatedPublicKey = cli.aggregateKeys(responses.map((r) => r.publicKey), MPC_THRESHOLD)

    console.log(aggregatedPublicKey)

    await prismaClient.user.update({
        where: {
            id : user.id
        },
        data: {
            publicKey : aggregatedPublicKey.aggregatedPublicKey
        }
    })

    await cli.airdrop(aggregatedPublicKey.aggregatedPublicKey, 0.1);

    res.json({
        message : "User Created",
        user : {
            ...user,
            publicKey: aggregatedPublicKey.aggregatedPublicKey
        }
    })
})
