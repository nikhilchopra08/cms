import { SignupSchema } from "common/inputs";
import { prismaClient } from "db/client";
import { Router } from "express";
import { adminAuthMiddleware } from "../middleware";
import jwt from "jsonwebtoken";

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

