import {
  generateDHKeyPair, performDH, exportKey, importDHPublicKey, importDHPrivateKey,
  hkdf, signData, concatBuffers, ab2b64
} from './utils';
import type { PreKeyBundle } from './types';

const X3DH_INFO = 'signal-x3dh-shared-secret';

export async function generatePreKeyBundle(
  identityKeyPair: CryptoKeyPair,
  signingKeyPair: CryptoKeyPair,
  signedPreKeyId: number,
  oneTimePreKeyStartId: number,
  oneTimePreKeyCount: number = 20
) {
  // Generate signed prekey
  const signedPreKeyPair = await generateDHKeyPair();
  const signedPreKeyPublic = await exportKey(signedPreKeyPair.publicKey);

  // Sign the prekey with identity signing key
  const encoder = new TextEncoder();
  const preKeyData = encoder.encode(JSON.stringify(signedPreKeyPublic));
  const signature = await signData(signingKeyPair.privateKey, preKeyData.buffer as ArrayBuffer);

  // Generate one-time prekeys
  const oneTimePreKeys = [];
  for (let i = 0; i < oneTimePreKeyCount; i++) {
    const keyPair = await generateDHKeyPair();
    const publicKey = await exportKey(keyPair.publicKey);
    oneTimePreKeys.push({
      keyId: oneTimePreKeyStartId + i,
      keyPair,
      publicKey,
    });
  }

  return {
    identityPublicKey: await exportKey(identityKeyPair.publicKey),
    signedPreKey: {
      keyId: signedPreKeyId,
      keyPair: signedPreKeyPair,
      publicKey: signedPreKeyPublic,
      signature: ab2b64(signature),
    },
    oneTimePreKeys,
  };
}

// Alice initiates X3DH with Bob's prekey bundle
export async function initiateX3DH(
  aliceIdentityKeyPair: CryptoKeyPair,
  bobBundle: PreKeyBundle
): Promise<{
  sharedSecret: ArrayBuffer;
  ephemeralPublicKey: JsonWebKey;
  usedOneTimePreKeyId?: number;
}> {
  const bobIdentityKey = await importDHPublicKey(bobBundle.identityKey);
  const bobSignedPreKey = await importDHPublicKey(bobBundle.signedPreKey.publicKey);
  const ephemeralKeyPair = await generateDHKeyPair();

  // DH1 = DH(IKa, SPKb)
  const dh1 = await performDH(aliceIdentityKeyPair.privateKey, bobSignedPreKey);
  // DH2 = DH(EKa, IKb)
  const dh2 = await performDH(ephemeralKeyPair.privateKey, bobIdentityKey);
  // DH3 = DH(EKa, SPKb)
  const dh3 = await performDH(ephemeralKeyPair.privateKey, bobSignedPreKey);

  let dhConcat: ArrayBuffer;
  let usedOneTimePreKeyId: number | undefined;

  if (bobBundle.oneTimePreKey) {
    const bobOTPK = await importDHPublicKey(bobBundle.oneTimePreKey.publicKey);
    // DH4 = DH(EKa, OPKb)
    const dh4 = await performDH(ephemeralKeyPair.privateKey, bobOTPK);
    dhConcat = concatBuffers(dh1, dh2, dh3, dh4);
    usedOneTimePreKeyId = bobBundle.oneTimePreKey.keyId;
  } else {
    dhConcat = concatBuffers(dh1, dh2, dh3);
  }

  const salt = new ArrayBuffer(32); // Zero salt per Signal spec
  const sharedSecret = await hkdf(dhConcat, salt, X3DH_INFO, 32);

  return {
    sharedSecret,
    ephemeralPublicKey: await exportKey(ephemeralKeyPair.publicKey),
    usedOneTimePreKeyId,
  };
}

// Bob completes X3DH when receiving Alice's initial message
export async function completeX3DH(
  bobIdentityKeyPair: CryptoKeyPair,
  bobSignedPreKeyPair: CryptoKeyPair,
  bobOneTimePreKeyPair: CryptoKeyPair | null,
  aliceIdentityKey: JsonWebKey,
  aliceEphemeralKey: JsonWebKey
): Promise<ArrayBuffer> {
  const aliceIK = await importDHPublicKey(aliceIdentityKey);
  const aliceEK = await importDHPublicKey(aliceEphemeralKey);

  // DH1 = DH(SPKb, IKa)
  const dh1 = await performDH(bobSignedPreKeyPair.privateKey, aliceIK);
  // DH2 = DH(IKb, EKa)
  const dh2 = await performDH(bobIdentityKeyPair.privateKey, aliceEK);
  // DH3 = DH(SPKb, EKa)
  const dh3 = await performDH(bobSignedPreKeyPair.privateKey, aliceEK);

  let dhConcat: ArrayBuffer;
  if (bobOneTimePreKeyPair) {
    const dh4 = await performDH(bobOneTimePreKeyPair.privateKey, aliceEK);
    dhConcat = concatBuffers(dh1, dh2, dh3, dh4);
  } else {
    dhConcat = concatBuffers(dh1, dh2, dh3);
  }

  const salt = new ArrayBuffer(32);
  return await hkdf(dhConcat, salt, X3DH_INFO, 32);
}
