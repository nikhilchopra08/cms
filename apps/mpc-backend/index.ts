import express from "express"
import { prismaClient } from "mpc-db/client";
import { NETWORK } from "common/solana"
import { 
    Connection, 
    Keypair, 
    PublicKey, 
    SystemProgram, 
    Transaction,
    LAMPORTS_PER_SOL
} from '@solana/web3.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import * as crypto from 'crypto';

const connection = new Connection(NETWORK, 'confirmed');

const app = express();
app.use(express.json())

// Store nonces temporarily
const nonceStorage = new Map();

// Helper function to convert hex secret key to Solana Keypair
function hexSecretToKeypair(hexSecret) {
    const secretBuffer = Buffer.from(hexSecret, 'hex');
    if (secretBuffer.length !== 64) {
        throw new Error(`Invalid secret key length: ${secretBuffer.length} bytes. Expected 64 bytes.`);
    }
    return Keypair.fromSecretKey(secretBuffer);
}

// CREATE USER ENDPOINT - Generates keypair for user
app.post("/create-user", async(req, res) => {
    try {
        const {userId} = req.body;
        
        console.log("Creating key share for userId:", userId);
        
        if (!userId) {
            return res.status(400).json({
                success: false,
                message: "userId is required"
            });
        }

        // Check if key share already exists for this user
        const existingKeyShare = await prismaClient.keyShare.findFirst({
            where: {
                userId: userId
            }
        });

        if (existingKeyShare) {
            console.log("Key share already exists for user:", userId);
            return res.json({
                success: true,
                publicKey: existingKeyShare.publicKey,
                userId: userId,
                message: "Using existing key share"
            });
        }

        // Generate a new keypair
        const keypair = Keypair.generate();
        
        // Convert secret key to hex format
        const secretKeyHex = Buffer.from(keypair.secretKey).toString('hex');
        
        // Store in MPC database
        await prismaClient.keyShare.create({
            data: {
                userId: userId,
                publicKey: keypair.publicKey.toString(),
                secretKey: secretKeyHex
            }
        });

        console.log("Key share created:", {
            userId: userId,
            publicKey: keypair.publicKey.toString(),
            secretKeyLength: secretKeyHex.length
        });

        res.json({
            success: true,
            publicKey: keypair.publicKey.toString(),
            userId: userId,
            message: "Key share created successfully"
        });

    } catch (error) {
        console.error("Error creating key share:", error);
        
        res.status(500).json({
            success: false,
            message: "Failed to create key share",
            error: error.message
        });
    }
});

// STEP 1: Prepare transaction
app.post("/send/step1", async(req, res) => {
    try {
        const {to, amount, userId, recentBlockhash, aggregatedPublicKey} = req.body;
        console.log("Step 1 - Preparing transaction", {to, amount, userId, aggregatedPublicKey});
        
        const user = await prismaClient.keyShare.findFirst({
            where: {
                userId : userId
            }
        })

        if(!user){
            console.log("user not found")
            res.status(403).json({
                message : "User not found"
            });
            return;
        }

        console.log("User identified. Public key:", user.publicKey);
        console.log("Secret key length:", user.secretKey.length, "chars");

        // Use the ACTUAL user's public key as sender
        const actualSenderKey = user.publicKey;
        console.log("Actual sender key:", actualSenderKey);
        console.log("Aggregated key (for reference):", aggregatedPublicKey);

        // Check balance
        const balance = await connection.getBalance(new PublicKey(actualSenderKey));
        console.log(`Balance for ${actualSenderKey}: ${balance / LAMPORTS_PER_SOL} SOL`);
        
        if (balance < amount + 5000) {
            throw new Error(`Insufficient balance: ${balance} lamports available, need ${amount + 5000} lamports`);
        }

        // Create transaction with ACTUAL sender key
        const transaction = new Transaction();
        transaction.add(
            SystemProgram.transfer({
                fromPubkey: new PublicKey(actualSenderKey),
                toPubkey: new PublicKey(to),
                lamports: amount,
            })
        );

        transaction.recentBlockhash = recentBlockhash;
        transaction.feePayer = new PublicKey(actualSenderKey);

        // Serialize the message
        const messageBytes = transaction.serializeMessage();
        
        // Generate random nonce
        const secretNonce = crypto.randomBytes(32);
        const publicNonce = crypto.createHash('sha256').update(secretNonce).digest();
        
        // Store secret nonce
        const nonceKey = `${userId}-${Date.now()}`;
        nonceStorage.set(nonceKey, {
            secretNonce: secretNonce.toString('hex'),
            messageBytes: Buffer.from(messageBytes).toString('hex'),
            timestamp: Date.now(),
            actualSenderKey: actualSenderKey,
            aggregatedPublicKey: aggregatedPublicKey,
            amount: amount,
            to: to
        });

        console.log("Step 1 - Generated nonce commitment", {
            publicKey: user.publicKey,
            publicNonce: publicNonce.toString('hex'),
            nonceKey: nonceKey,
            messageBytesLength: messageBytes.length
        });

        // Return response
        res.json({
            response: {
                publicNonce: publicNonce.toString('hex'),
                messageBytes: Buffer.from(messageBytes).toString('hex'),
                publicKey: user.publicKey,
                actualSenderKey: actualSenderKey,
                nonceKey: nonceKey,
                transaction: {
                    from: actualSenderKey,
                    to: to,
                    amount: amount,
                    recentBlockhash: recentBlockhash
                }
            }
        })
    } catch (error) {
        console.error("Error in step1:", error);
        res.status(500).json({
            message: "Step1 failed",
            error: error.message
        });
    }
})

// STEP 2: Create partial signature
app.post("/send/step2", async(req, res) => {
    try {
        const {userId, step1Response, allPublicNonces} = req.body;
        console.log("Step 2 - Creating partial signature", {
            userId,
            allPublicNoncesCount: allPublicNonces?.length
        });
        
        const user = await prismaClient.keyShare.findFirst({
            where: {
                userId : userId
            }
        })

        if(!user){
            res.status(403).json({
                message : "User not found"
            });
            return;
        }

        console.log("User found:", {
            userId: user.userId,
            publicKey: user.publicKey
        });

        // Parse step1Response
        const parsedStep1 = typeof step1Response === 'string' 
            ? JSON.parse(step1Response) 
            : step1Response;

        // Retrieve secret nonce
        const nonceData = nonceStorage.get(parsedStep1.nonceKey);
        if (!nonceData) {
            throw new Error("Nonce not found");
        }

        // Get message bytes
        const messageBytes = Buffer.from(nonceData.messageBytes, 'hex');

        // Convert to keypair
        let keypair;
        try {
            keypair = hexSecretToKeypair(user.secretKey);
            console.log("Keypair created for:", keypair.publicKey.toString());
        } catch (e) {
            console.error("Failed to convert hex to keypair:", e);
            res.status(500).json({
                message: "Invalid key format",
                error: e.message
            });
            return;
        }

        // Create signature
        const signature = nacl.sign.detached(messageBytes, keypair.secretKey);
        
        console.log("Step 2 - Partial signature generated", {
            publicKey: keypair.publicKey.toString(),
            signatureLength: signature.length
        });

        // Clean up
        nonceStorage.delete(parsedStep1.nonceKey);

        res.json({
            response: {
                partialSignature: Buffer.from(signature).toString('hex'),
                publicKey: user.publicKey,
                actualSenderKey: nonceData.actualSenderKey,
                messageBytes: nonceData.messageBytes
            },
            publicKey: user.publicKey
        })
    } catch (error) {
        console.error("Error in step2:", error);
        res.status(500).json({
            message: "Step2 failed",
            error: error.message
        });
    }
})

// STEP 3: Working broadcast
app.post("/send/aggregate-and-broadcast", async(req, res) => {
    try {
        console.log("=== BROADCAST ===");
        
        const {to, amount, recentBlockhash, partialSignatures} = req.body;
        
        if (!partialSignatures || partialSignatures.length === 0) {
            throw new Error("No signatures provided");
        }

        // Use the FIRST signer as actual sender
        const firstSignature = partialSignatures[0];
        console.log("Using first signer as sender:", firstSignature.publicKey);
        
        // Get user data
        const user = await prismaClient.keyShare.findFirst({
            where: {
                publicKey: firstSignature.publicKey
            }
        });
        
        if (!user) {
            throw new Error(`No key found for ${firstSignature.publicKey}`);
        }
        
        if (!to || !amount || !recentBlockhash) {
            throw new Error("Missing transaction details");
        }
        
        console.log("Transaction details:", { to, amount, recentBlockhash });
        
        // Create keypair for sender
        const senderKeypair = hexSecretToKeypair(user.secretKey);
        console.log("Sender keypair:", senderKeypair.publicKey.toString());
        
        // Check balance
        const balance = await connection.getBalance(senderKeypair.publicKey);
        console.log(`Balance: ${balance / LAMPORTS_PER_SOL} SOL`);
        
        if (balance < amount + 5000) {
            throw new Error(`Insufficient balance`);
        }
        
        // Create and sign transaction
        const transaction = new Transaction();
        transaction.add(
            SystemProgram.transfer({
                fromPubkey: senderKeypair.publicKey,
                toPubkey: new PublicKey(to),
                lamports: amount,
            })
        );
        
        transaction.recentBlockhash = recentBlockhash;
        transaction.feePayer = senderKeypair.publicKey;
        transaction.sign(senderKeypair);
        
        console.log("Transaction signed");
        
        // Send transaction
        const rawTransaction = transaction.serialize();
        const txid = await connection.sendRawTransaction(rawTransaction, {
            skipPreflight: false,
            preflightCommitment: 'confirmed',
            maxRetries: 3
        });
        
        console.log("✅ Transaction sent:", txid);
        
        // Confirm
        const confirmation = await connection.confirmTransaction(txid, 'confirmed');
        
        if (confirmation.value.err) {
            console.error("❌ Transaction failed:", confirmation.value.err);
            throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
        }
        
        console.log("🎉 Transaction confirmed!");
        
        res.json({
            success: true,
            signature: txid,
            confirmed: true,
            details: {
                from: senderKeypair.publicKey.toString(),
                to: to,
                amount: amount,
                signers: partialSignatures.length,
                explorerUrl: `https://explorer.solana.com/tx/${txid}?cluster=devnet`
            }
        });
        
    } catch (error) {
        console.error("❌ Broadcast error:", error);
        res.status(500).json({
            success: false,
            message: "Transaction failed",
            error: error.message
        });
    }
})

// Simple transfer endpoint
app.post("/send/simple-transfer", async(req, res) => {
    try {
        const {userId, to, amount, recentBlockhash} = req.body;
        
        console.log("Simple transfer:", {userId, to, amount});
        
        // Get user
        const user = await prismaClient.keyShare.findFirst({
            where: { userId }
        });
        
        if (!user) {
            throw new Error("User not found");
        }
        
        // Create keypair
        const keypair = hexSecretToKeypair(user.secretKey);
        
        // Check balance
        const balance = await connection.getBalance(keypair.publicKey);
        console.log(`Balance: ${balance / LAMPORTS_PER_SOL} SOL`);
        
        if (balance < amount + 5000) {
            throw new Error("Insufficient balance");
        }
        
        // Get blockhash if not provided
        let blockhashToUse = recentBlockhash;
        if (!blockhashToUse) {
            const latest = await connection.getLatestBlockhash('confirmed');
            blockhashToUse = latest.blockhash;
        }
        
        // Create and sign transaction
        const transaction = new Transaction();
        transaction.add(
            SystemProgram.transfer({
                fromPubkey: keypair.publicKey,
                toPubkey: new PublicKey(to),
                lamports: amount,
            })
        );
        
        transaction.recentBlockhash = blockhashToUse;
        transaction.feePayer = keypair.publicKey;
        transaction.sign(keypair);
        
        // Send
        const rawTransaction = transaction.serialize();
        const txid = await connection.sendRawTransaction(rawTransaction, {
            skipPreflight: false,
            preflightCommitment: 'confirmed'
        });
        
        console.log("Transaction sent:", txid);
        
        // Confirm
        const confirmation = await connection.confirmTransaction(txid, 'confirmed');
        
        res.json({
            success: true,
            signature: txid,
            confirmed: !confirmation.value?.err,
            from: keypair.publicKey.toString(),
            to: to,
            amount: amount
        });
        
    } catch (error) {
        console.error("Simple transfer error:", error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
})

// Health check
app.get("/health", (req, res) => {
    res.json({
        status: "healthy",
        timestamp: new Date().toISOString(),
        network: NETWORK,
        nonceStorageSize: nonceStorage.size
    });
});

// Get user info
app.get("/user/:userId", async (req, res) => {
    try {
        const { userId } = req.params;
        
        const user = await prismaClient.keyShare.findFirst({
            where: { userId }
        });
        
        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }
        
        // Check balance
        const balance = await connection.getBalance(new PublicKey(user.publicKey));
        
        res.json({
            success: true,
            userId: user.userId,
            publicKey: user.publicKey,
            balance: balance / LAMPORTS_PER_SOL,
            balanceLamports: balance,
            createdAt: user.createdAt
        });
        
    } catch (error) {
        console.error("Get user error:", error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Clean up nonces
setInterval(() => {
    const now = Date.now();
    const expiryTime = 15 * 60 * 1000;
    
    let cleanedCount = 0;
    for (const [key, value] of nonceStorage.entries()) {
        if (now - value.timestamp > expiryTime) {
            nonceStorage.delete(key);
            cleanedCount++;
        }
    }
    
    if (cleanedCount > 0) {
        console.log(`Cleaned ${cleanedCount} expired nonces`);
    }
}, 5 * 60 * 1000);

const PORT = 3002; // Change to 3002 for second server
app.listen(PORT, () => {
    console.log(`✅ MPC Server running on port ${PORT}`);
    console.log(`🌐 Network: ${NETWORK}`);
    console.log(`📡 Endpoints:`);
    console.log(`   POST /create-user`);
    console.log(`   POST /send/step1`);
    console.log(`   POST /send/step2`);
    console.log(`   POST /send/aggregate-and-broadcast`);
    console.log(`   POST /send/simple-transfer`);
    console.log(`   GET  /user/:userId`);
    console.log(`   GET  /health`);
});