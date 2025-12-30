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
function combinePublicKeysEd25519(publicKeys, threshold) {
    console.log("Combining public keys for MPC:");
    console.log("Public keys:", publicKeys);
    console.log("Threshold:", threshold);
    
    // In real MPC, you would use proper threshold cryptography
    // For now, we'll create a deterministic aggregated key
    
    // Create a hash of all public keys + threshold
    const combinedString = publicKeys.sort().join('') + threshold;
    const hash = crypto.createHash('sha256').update(combinedString).digest();
    
    // Use the hash as a seed to generate a deterministic keypair
    const seed = hash.slice(0, 32); // First 32 bytes for seed
    
    // Generate keypair from seed (deterministic)
    const keypair = nacl.sign.keyPair.fromSeed(seed);
    
    // Convert to Solana Keypair format
    const solanaKeypair = Keypair.fromSecretKey(Buffer.from(keypair.secretKey));
    
    console.log("Generated aggregated public key:", solanaKeypair.publicKey.toString());
    
    return {
        aggregatedPublicKey: solanaKeypair.publicKey.toString(),
        aggregatedSecretKey: bs58.encode(solanaKeypair.secretKey) // Store for reference (in production, split this)
    };
}

// Alternative: Create a simple multisig address
function createMultisigAddress(publicKeys, threshold) {
    console.log("Creating multisig-like address...");
    
    // Sort keys for deterministic result
    const sortedKeys = publicKeys.map(k => new PublicKey(k)).sort((a, b) => 
        a.toBuffer().compare(b.toBuffer())
    );
    
    // Create a combined hash
    let combinedBuffer = Buffer.concat([
        Buffer.from([threshold]), // Threshold as first byte
        ...sortedKeys.map(k => k.toBuffer())
    ]);
    
    // Hash to create deterministic address
    const hash = crypto.createHash('sha256').update(combinedBuffer).digest();
    
    // Convert to PublicKey
    const aggregatedKey = new PublicKey(hash);
    
    console.log("Multisig-like aggregated key:", aggregatedKey.toString());
    
    return {
        aggregatedPublicKey: aggregatedKey.toString(),
        // Note: There's no corresponding private key for this method
        // This is just for address generation
    };
}

// Helper to airdrop SOL
async function airdropToAddress(publicKey, amountInSol) {
    try {
        const publicKeyObj = new PublicKey(publicKey);
        console.log(`Airdropping ${amountInSol} SOL to ${publicKey}...`);
        
        const signature = await connection.requestAirdrop(
            publicKeyObj,
            amountInSol * 1e9 // Convert SOL to lamports
        );
        
        console.log(`Airdrop signature: ${signature}`);
        
        // Wait for confirmation
        await connection.confirmTransaction(signature, 'confirmed');
        console.log(`✅ Airdrop completed to ${publicKey}`);
        
        return signature;
    } catch (error) {
        console.error("Airdrop failed:", error.message);
        throw error;
    }
}

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

router.post("/create-user", adminAuthMiddleware, async (req, res) => {
    try {
        const {success, data} = CreateUserSchema.safeParse(req.body);

        console.log("Creating user with data:", data);
        
        if(!success){
            res.status(403).json({
                message : "Invalid input data"
            })
            return;
        }

        // Create user in database
        const user = await prismaClient.user.create({
            data: {
                email : data.email,
                phone : data.number,
                password: data.password,
                role : "USER"
            }
        });

        console.log(`Created user with ID: ${user.id}`);

        // Step 1: Create key shares on all MPC servers
        console.log("Creating key shares on MPC servers...");
        const serverResponses = await Promise.all(MPC_SERVER.map(async (server, index) => {
            try {
                console.log(`[Server ${index}] Creating key share on ${server}`);
                const response = await axios.post(`${server}/create-user`, {
                    userId: user.id
                }, {
                    timeout: 30000
                });
                
                console.log(`[Server ${index}] Key share created:`, {
                    publicKey: response.data.publicKey,
                    server: server
                });
                
                return response.data;
            } catch (error) {
                console.error(`[Server ${index}] Failed to create key share:`, error.message);
                throw new Error(`Failed to create key share on server ${index}: ${error.message}`);
            }
        }));

        // Extract public keys from server responses
        const individualPublicKeys = serverResponses.map(r => r.publicKey);
        console.log("Individual public keys:", individualPublicKeys);

        // Step 2: Create aggregated public key using MPC logic
        console.log("\nCreating aggregated public key...");
        
        // Method 1: Deterministic aggregated key (has corresponding private key)
        const aggregatedKeyResult = combinePublicKeysEd25519(individualPublicKeys, MPC_THRESHOLD);
        
        // OR Method 2: Multisig-like address (no corresponding private key)
        // const aggregatedKeyResult = createMultisigAddress(individualPublicKeys, MPC_THRESHOLD);
        
        const aggregatedPublicKey = aggregatedKeyResult.aggregatedPublicKey;
        
        console.log("Aggregated public key created:", aggregatedPublicKey);
        
        if (aggregatedKeyResult.aggregatedSecretKey) {
            console.log("Aggregated secret key (for reference):", aggregatedKeyResult.aggregatedSecretKey);
            
            // In production, you would split this secret key into shares
            // and distribute to MPC servers
        }

        // Step 3: Store aggregated key in database
        await prismaClient.user.update({
            where: {
                id: user.id
            },
            data: {
                publicKey: aggregatedPublicKey
            }
        });

        // Also store individual keys for reference
        for (let i = 0; i < serverResponses.length; i++) {
            await prismaClient.keyShare.create({
                data: {
                    userId: user.id,
                    publicKey: individualPublicKeys[i],
                    secretKey: serverResponses[i].secretKey || "stored-on-server",
                    serverIndex: i
                }
            });
        }

        // Step 4: Fund the aggregated account
        console.log("\nFunding aggregated account...");
        try {
            const airdropSignature = await airdropToAddress(aggregatedPublicKey, 0.1);
            console.log("Airdrop successful:", airdropSignature);
        } catch (airdropError) {
            console.warn("Airdrop failed, but continuing:", airdropError.message);
            // Continue even if airdrop fails - user might fund manually
        }

        // Step 5: Return response
        res.json({
            success: true,
            message: "User created successfully with MPC keys",
            user: {
                id: user.id,
                email: user.email,
                phone: user.phone,
                publicKey: aggregatedPublicKey,
                individualKeys: individualPublicKeys,
                threshold: MPC_THRESHOLD,
                serverCount: MPC_SERVER.length
            },
            keyDetails: {
                aggregatedPublicKey: aggregatedPublicKey,
                individualPublicKeys: individualPublicKeys,
                threshold: MPC_THRESHOLD
            }
        });

    } catch (error) {
        console.error("Error creating user:", error);
        res.status(500).json({
            success: false,
            message: "Failed to create user with MPC setup",
            error: error.message
        });
    }
});