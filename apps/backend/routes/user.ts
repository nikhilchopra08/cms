import { SendSchema, SignupSchema } from "common/inputs";
import { prismaClient } from "db/client";
import { Router } from "express";
import { authMiddleware } from "../middleware";
import jwt from "jsonwebtoken";
import { cli, MPC_SERVER, MPC_THRESHOLD } from "./admin";
import axios from "axios";
import { NETWORK } from "common/solana";
import { 
    Connection, 
    Keypair, 
    PublicKey, 
    SystemProgram, 
    Transaction,
} from '@solana/web3.js';

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
    try {
        const {success, data} = SendSchema.safeParse(req.body);

        if(!success){
            res.status(403).json({
                message: "Incorrect credentials"
            })
            return;
        }

        const user = await prismaClient.user.findFirst({
            where: {
                id: req.userId
            }
        })

        if(!user){
            res.status(403).json({
                message: "User not found"
            })
            return;
        }

        console.log("=== STARTING MPC TRANSACTION ===");
        console.log("User:", req.userId);
        console.log("To:", data.to);
        console.log("Amount:", data.amount);
        console.log("MPC Servers:", MPC_SERVER.length);

        // Get fresh blockhash
        const connection = new Connection(NETWORK, 'confirmed');
        const { blockhash } = await connection.getLatestBlockhash('confirmed');
        console.log("Recent blockhash:", blockhash);

        // ===== STEP 1: Collect nonce commitments =====
        console.log("\n=== STEP 1: Collecting nonce commitments ===");
        
        const step1Responses = await Promise.all(MPC_SERVER.map(async (server, index) => {
            try {
                console.log(`[Server ${index}] Requesting step1 from ${server}`);
                const response = await axios.post(`${server}/send/step1`, {
                    to: data.to,
                    amount: data.amount,
                    userId: req.userId,
                    recentBlockhash: blockhash,
                    aggregatedPublicKey: user.publicKey // Still pass for reference
                }, {
                    timeout: 30000
                })
                
                console.log(`[Server ${index}] ✓ Received nonce from:`, response.data.response.publicKey);
                
                return response.data.response;
            } catch (error) {
                console.error(`[Server ${index}] ✗ Error:`, error.message);
                throw new Error(`Step1 failed at server ${index}: ${error.message}`);
            }
        }));

        // IMPORTANT: Each server will have DIFFERENT message bytes because they use different sender keys
        // That's OK for MPC - each server signs with its own key
        
        console.log("\n✓ Step 1 Complete");
        console.log("  Servers responded:", step1Responses.length);
        console.log("  Server public keys:", step1Responses.map(r => r.publicKey));
        console.log("  Server sender keys:", step1Responses.map(r => r.actualSenderKey || r.publicKey));
        
        // Collect all public nonces
        const allPublicNonces = step1Responses.map(r => r.publicNonce);
        const participantKeys = step1Responses.map(r => r.publicKey);
        const actualSenderKeys = step1Responses.map(r => r.actualSenderKey || r.publicKey);

        // ===== STEP 2: Collect partial signatures =====
        console.log("\n=== STEP 2: Collecting partial signatures ===");
        
        const step2Responses = await Promise.all(MPC_SERVER.map(async (server, index) => {
            try {
                console.log(`[Server ${index}] Requesting step2 from ${server}`);
                
                const response = await axios.post(`${server}/send/step2`, {
                    userId: req.userId,
                    step1Response: step1Responses[index],
                    allPublicNonces: allPublicNonces
                }, {
                    timeout: 30000
                });
                
                console.log(`[Server ${index}] ✓ Received partial signature from:`, response.data.publicKey);
                
                return {
                    ...response.data.response,
                    publicKey: response.data.publicKey,
                    actualSenderKey: response.data.response.actualSenderKey
                };
            } catch (error) {
                console.error(`[Server ${index}] ✗ Error:`, error.message);
                throw new Error(`Step2 failed at server ${index}: ${error.message}`);
            }
        }));

        // Prepare partial signatures for aggregation
        const partialSignaturesForAggregation = step2Responses.map(response => ({
            publicKey: response.publicKey,
            partialSignature: response.partialSignature,
            actualSenderKey: response.actualSenderKey
        }));

        console.log("\n✓ Step 2 Complete");
        console.log("  Partial signatures collected:", partialSignaturesForAggregation.length);
        console.log("  First signature sender:", partialSignaturesForAggregation[0]?.actualSenderKey);

        // ===== STEP 3: Aggregate and broadcast =====
        console.log("\n=== STEP 3: Aggregating and broadcasting ===");

        // Use the first server's actual sender key
        const firstSenderKey = partialSignaturesForAggregation[0]?.actualSenderKey;
        
        if (!firstSenderKey) {
            throw new Error("No sender key found");
        }

        console.log("Using sender key:", firstSenderKey);
        console.log("Original aggregated key (not used):", user.publicKey);

        // Call aggregate-and-broadcast with ALL necessary data
        const aggregateResponse = await axios.post(`${MPC_SERVER[0]}/send/aggregate-and-broadcast`, {
            to: data.to,
            amount: data.amount,
            recentBlockhash: blockhash,
            partialSignatures: partialSignaturesForAggregation,
            // Note: We're NOT passing aggregatedPublicKey anymore
            // The server will use the actual sender key from the first signature
        }, {
            timeout: 60000
        });

        console.log("\n✓ Step 3 Complete");
        console.log("  Transaction ID:", aggregateResponse.data.signature);
        console.log("  Success:", aggregateResponse.data.success);

        if (!aggregateResponse.data.success) {
            throw new Error("Transaction broadcast failed");
        }

        console.log("\n=== ✅ TRANSACTION SUCCESSFUL ===");
        
        res.json({
            success: true,
            signature: aggregateResponse.data.signature,
            transactionDetails: {
                from: firstSenderKey, // Use actual sender
                to: data.to,
                amount: data.amount,
                signersParticipated: partialSignaturesForAggregation.length,
                threshold: MPC_THRESHOLD,
                explorerUrl: `https://explorer.solana.com/tx/${aggregateResponse.data.signature}?cluster=devnet`
            }
        });

    } catch (error) {
        console.error("\n=== ❌ TRANSACTION FAILED ===");
        console.error("Error:", error.message);
        
        res.status(500).json({
            success: false,
            message: "MPC transaction failed",
            error: error.message
        });
    }
});