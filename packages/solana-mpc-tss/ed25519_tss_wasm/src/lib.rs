use ed25519_dalek::{Keypair as DalekKeypair, PublicKey as DalekPublicKey, SecretKey as DalekSecretKey, Signer};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct Keypair {
    secret_seed: [u8; 32],
    public_key: [u8; 32],
}

#[wasm_bindgen]
impl Keypair {
    #[wasm_bindgen]
    pub fn generate() -> Keypair {
        // Generate 32 random bytes using getrandom (works in WASM with the "js" feature)
        let mut seed = [0u8; 32];
        getrandom::getrandom(&mut seed).expect("randomness available in WASM");

        let secret = DalekSecretKey::from_bytes(&seed).expect("valid secret");
        let public: DalekPublicKey = (&secret).into();

        Keypair {
            secret_seed: seed,
            public_key: public.to_bytes(),
        }
    }

    #[wasm_bindgen]
    pub fn public_key(&self) -> Vec<u8> {
        self.public_key.to_vec()
    }

    #[wasm_bindgen]
    pub fn secret_key(&self) -> Vec<u8> {
        // Return the 32-byte seed (compatible with tweetnacl key derivation)
        self.secret_seed.to_vec()
    }
}

#[wasm_bindgen]
pub fn sign(message: &[u8], secret_key: &[u8]) -> Vec<u8> {
    // secret_key is expected to be a 32-byte seed
    let seed: [u8; 32] = {
        let mut arr = [0u8; 32];
        let len = secret_key.len().min(32);
        arr[..len].copy_from_slice(&secret_key[..len]);
        arr
    };

    let secret = DalekSecretKey::from_bytes(&seed).expect("valid secret");
    let public: DalekPublicKey = (&secret).into();
    let dalek_kp = DalekKeypair { secret, public };

    let sig = dalek_kp.sign(message);
    sig.to_bytes().to_vec()
}


