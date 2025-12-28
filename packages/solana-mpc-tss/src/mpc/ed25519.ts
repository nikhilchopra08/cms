import { PublicKey } from '@solana/web3.js';
import { MPCSigner } from './Signer';
import * as nacl from 'tweetnacl';

/**
 * Initialize the WASM module and create an MPC signer
 * @returns Promise resolving to an MPCSigner instance
 */
export async function createMPCSigner(): Promise<MPCSigner> {
  try {
    // Try to import WASM module if available
    // @ts-ignore - WASM module may not exist, fallback to tweetnacl
    const wasmPath = ['..', 'pkg', 'ed25519_tss_wasm'].join('/');
    // Use computed specifier to avoid bundlers from trying to bundle the wasm at build time
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const wasmModule: any = await (Function('p', 'return import(p)'))(wasmPath);
    // Optional init for wasm-pack bundles
    // @ts-ignore
    if (typeof wasmModule.default === 'function') {
      await wasmModule.default();
    }
    
    const kp = wasmModule.Keypair.generate();
    const publicKeyBytes = Uint8Array.from(kp.public_key());
    const secretKeyBytes = Uint8Array.from(kp.secret_key());

    const publicKey = new PublicKey(publicKeyBytes);

    return {
      publicKey,
      sign: async (message: Uint8Array): Promise<Uint8Array> => {
        const signature = wasmModule.sign(Uint8Array.from(message), Uint8Array.from(secretKeyBytes));
        return Uint8Array.from(signature);
      }
    };
  } catch (error) {
    // Fallback to tweetnacl if WASM module is not available
    console.warn('WASM module not found, falling back to tweetnacl');
    const keypair = nacl.sign.keyPair();
    const publicKey = new PublicKey(keypair.publicKey);

    return {
      publicKey,
      sign: async (message: Uint8Array): Promise<Uint8Array> => {
        const signature = nacl.sign.detached(message, keypair.secretKey);
        return signature;
      }
    };
  }
}

/**
 * Create an MPC signer from existing secret key bytes
 * @param secretKeyBytes The secret key bytes
 * @returns Promise resolving to an MPCSigner instance
 */
export async function createMPCSignerFromSecretKey(secretKeyBytes: Uint8Array): Promise<MPCSigner> {
  try {
    // @ts-ignore - WASM module may not exist, fallback to tweetnacl
    const wasmPath = ['..', 'pkg', 'ed25519_tss_wasm'].join('/');
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const wasmModule: any = await (Function('p', 'return import(p)'))(wasmPath);
    // Optional init for wasm-pack bundles
    // @ts-ignore
    if (typeof wasmModule.default === 'function') {
      await wasmModule.default();
    }
    
    // Derive public key from provided secret (expect 32-byte seed, normalize if needed)
    const seed32 = secretKeyBytes.length === 32 ? secretKeyBytes : secretKeyBytes.slice(0, 32);
    const naclKeypair = nacl.sign.keyPair.fromSeed(seed32);
    const derivedPublicKey = new PublicKey(naclKeypair.publicKey);
    
    return {
      publicKey: derivedPublicKey,
      sign: async (message: Uint8Array): Promise<Uint8Array> => {
        const signature = wasmModule.sign(Uint8Array.from(message), Uint8Array.from(seed32));
        return Uint8Array.from(signature);
      }
    };
  } catch (error) {
    // Fallback to tweetnacl
    const fullSecret = secretKeyBytes.length === 64
      ? secretKeyBytes
      : nacl.sign.keyPair.fromSeed(secretKeyBytes.length === 32 ? secretKeyBytes : secretKeyBytes.slice(0, 32)).secretKey;
    const keypair = nacl.sign.keyPair.fromSecretKey(fullSecret);
    const publicKey = new PublicKey(keypair.publicKey);
    
    return {
      publicKey,
      sign: async (message: Uint8Array): Promise<Uint8Array> => {
        const signature = nacl.sign.detached(message, keypair.secretKey);
        return signature;
      }
    };
  }
}
