import { CreateUserSchema, SendSchema, SignupSchema } from "common/inputs";
import { prismaClient } from "db/client";
import { Router } from "express";
import { adminAuthMiddleware } from "../middleware";
import jwt from "jsonwebtoken";
import axios from "axios";
import { NETWORK } from "common/solana"
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import crypto from 'crypto';

export const MPC_SERVER = [
    "http://localhost:3001",
    "http://localhost:3002",
];

export const MPC_THRESHOLD = Math.max(1, MPC_SERVER.length - 1);

const connection = new Connection(NETWORK, 'confirmed');

const router = Router();

export default router;

// Helper function to combine public keys (simplified MPC key aggregation)
// Helper function to combine public keys into aggregated key
function createAggregatedPublicKey(publicKeys, threshold) {
    console.log("Creating aggregated public key from:", publicKeys);
    console.log("Threshold:", threshold);
    
    // Sort keys for deterministic result
    const sortedKeys = publicKeys.sort();
    
    // Create a combined string
    const combinedString = sortedKeys.join('') + threshold.toString();
    
    // Hash to create deterministic public key
    const hash = crypto.createHash('sha256').update(combinedString).digest();
    
    // Convert to Solana PublicKey format (base58)
    let aggregatedKey;
    try {
        aggregatedKey = new PublicKey(hash);
    } catch (error) {
        // If hash doesn't make valid public key, use a different approach
        console.log("Hash not valid as public key, using alternative method...");
        
        // Create deterministic keypair from hash
        const seed = hash.slice(0, 32);
        const { publicKey } = require('tweetnacl').sign.keyPair.fromSeed(seed);
        aggregatedKey = new PublicKey(Buffer.from(publicKey));
    }
    
    console.log("Aggregated public key:", aggregatedKey.toString());
    return aggregatedKey.toString();
}

// Alternative: Simple XOR combination (for testing)
function createSimpleAggregatedKey(publicKeys) {
    console.log("Creating simple aggregated key...");
    
    // Convert all public keys to buffers and XOR them
    let combinedBuffer = Buffer.alloc(32, 0); // 32 bytes for ed25519 public key
    
    for (const pubKey of publicKeys) {
        try {
            const pubKeyBuffer = new PublicKey(pubKey).toBuffer();
            
            // XOR each byte
            for (let i = 0; i < 32; i++) {
                combinedBuffer[i] ^= pubKeyBuffer[i];
            }
        } catch (error) {
            console.error("Error processing public key:", pubKey, error.message);
        }
    }
    
    // Convert back to PublicKey
    const aggregatedKey = new PublicKey(combinedBuffer);
    console.log("Simple aggregated key:", aggregatedKey.toString());
    return aggregatedKey.toString();
}

router.post("/create-user", adminAuthMiddleware, async (req, res) => {
    try {
        const {success, data} = CreateUserSchema.safeParse(req.body);

        console.log("Creating user with data:", data);
        
        if(!success){
            return res.status(403).json({
                message : "Invalid input data"
            });
        }

        // Step 1: Create user in MAIN database
        console.log("Step 1: Creating user in main database...");
        const user = await prismaClient.user.create({
            data: {
                email: data.email,
                phone: data.number,
                password: data.password,
                role: "USER"
            }
        });

        console.log(`Created user with ID: ${user.id}`);

        // Step 2: Create key shares on all MPC servers
        console.log("\nStep 2: Creating key shares on MPC servers...");
        const serverResponses = await Promise.all(MPC_SERVER.map(async (server, index) => {
            try {
                console.log(`[Server ${index}] Creating key share on ${server}`);
                const response = await axios.post(`${server}/create-user`, {
                    userId: user.id
                }, {
                    timeout: 30000
                });
                
                console.log(`[Server ${index}] Key share created:`, response.data.publicKey);
                
                return {
                    server: server,
                    publicKey: response.data.publicKey,
                    success: response.data.success
                };
            } catch (error) {
                console.error(`[Server ${index}] Failed to create key share:`, error.message);
                throw new Error(`Failed to create key share on server ${index}: ${error.message}`);
            }
        }));

        // Extract public keys from server responses
        const individualPublicKeys = serverResponses.map(r => r.publicKey);
        console.log("\nIndividual public keys from MPC servers:", individualPublicKeys);

        // Step 3: Create aggregated public key
        console.log("\nStep 3: Creating aggregated public key...");
        
        let aggregatedPublicKey;
        try {
            // Try method 1: Hash-based aggregation
            aggregatedPublicKey = createAggregatedPublicKey(individualPublicKeys, MPC_THRESHOLD);
            
            // Verify it's a valid public key
            new PublicKey(aggregatedPublicKey); // Will throw if invalid
            console.log("✅ Aggregated key is valid:", aggregatedPublicKey);
            
        } catch (error) {
            console.log("Hash method failed, trying simple XOR method...");
            aggregatedPublicKey = createSimpleAggregatedKey(individualPublicKeys);
        }

        // Step 4: Store aggregated key in MAIN database
        console.log("\nStep 4: Storing aggregated key in main database...");
        await prismaClient.user.update({
            where: {
                id: user.id
            },
            data: {
                publicKey: aggregatedPublicKey
            }
        });

        console.log("✅ Aggregated key stored for user:", aggregatedPublicKey);

        // Step 5: Return response
        res.json({
            success: true,
            message: "User created successfully with MPC setup",
            user: {
                id: user.id,
                email: user.email,
                phone: user.phone,
                publicKey: aggregatedPublicKey,
                mpcDetails: {
                    serverCount: MPC_SERVER.length,
                    threshold: MPC_THRESHOLD,
                    individualKeys: individualPublicKeys,
                    servers: MPC_SERVER
                }
            }
        });

    } catch (error) {
        console.error("Error creating user:", error);
        
        // Try to clean up if user was created but MPC setup failed
        if (req.body.email) {
            try {
                await prismaClient.user.deleteMany({
                    where: {
                        email: req.body.email
                    }
                });
                console.log("Cleaned up partially created user");
            } catch (cleanupError) {
                console.error("Cleanup failed:", cleanupError.message);
            }
        }
        
        res.status(500).json({
            success: false,
            message: "Failed to create user with MPC setup",
            error: error.message
        });
    }
});


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
});