import {
  ab2b64, b642ab, generateDHKeyPair, performDH, exportKey,
  importDHPublicKey, importDHPrivateKey, hkdf, hmacSHA256,
  aesEncrypt, aesDecrypt
} from './utils';
import type { SerializedSessionState, MessageHeader } from './types';

const MAX_SKIP = 256;

async function kdfRK(rk: ArrayBuffer, dhOut: ArrayBuffer) {
  const derived = await hkdf(dhOut, rk, 'signal-root-chain', 64);
  return {
    rootKey: derived.slice(0, 32),
    chainKey: derived.slice(32, 64),
  };
}

async function kdfCK(ck: ArrayBuffer) {
  const messageKey = await hmacSHA256(ck, new Uint8Array([0x01]).buffer as ArrayBuffer);
  const chainKey = await hmacSHA256(ck, new Uint8Array([0x02]).buffer as ArrayBuffer);
  return { chainKey, messageKey };
}

export class DoubleRatchet {
  private DHs: CryptoKeyPair | null = null;
  private DHrJwk: JsonWebKey | null = null;
  private DHr: CryptoKey | null = null;
  private RK: ArrayBuffer = new ArrayBuffer(0);
  private CKs: ArrayBuffer | null = null;
  private CKr: ArrayBuffer | null = null;
  private Ns: number = 0;
  private Nr: number = 0;
  private PN: number = 0;
  private MKSKIPPED: Map<string, ArrayBuffer> = new Map();

  async initAlice(sharedSecret: ArrayBuffer, bobDHPublicKey: CryptoKey): Promise<void> {
    this.DHs = await generateDHKeyPair();
    this.DHr = bobDHPublicKey;
    this.DHrJwk = await exportKey(bobDHPublicKey);

    const dhOut = await performDH(this.DHs.privateKey, this.DHr);
    const { rootKey, chainKey } = await kdfRK(sharedSecret, dhOut);

    this.RK = rootKey;
    this.CKs = chainKey;
    this.CKr = null;
    this.Ns = 0;
    this.Nr = 0;
    this.PN = 0;
  }

  async initBob(sharedSecret: ArrayBuffer, bobDHKeyPair: CryptoKeyPair): Promise<void> {
    this.DHs = bobDHKeyPair;
    this.DHr = null;
    this.DHrJwk = null;
    this.RK = sharedSecret;
    this.CKs = null;
    this.CKr = null;
    this.Ns = 0;
    this.Nr = 0;
    this.PN = 0;
  }

  async encrypt(plaintext: string): Promise<{ header: MessageHeader; ciphertext: string }> {
    if (!this.CKs) throw new Error('Sending chain not initialized');
    if (!this.DHs) throw new Error('DH key pair not initialized');

    const { chainKey, messageKey } = await kdfCK(this.CKs);
    this.CKs = chainKey;

    const encoder = new TextEncoder();
    const ciphertext = await aesEncrypt(messageKey, encoder.encode(plaintext).buffer as ArrayBuffer);

    const header: MessageHeader = {
      dh: await exportKey(this.DHs.publicKey),
      pn: this.PN,
      n: this.Ns,
    };
    this.Ns++;

    return { header, ciphertext: ab2b64(ciphertext) };
  }

  async decrypt(header: MessageHeader, ciphertext: string): Promise<string> {
    const ciphertextBuffer = b642ab(ciphertext);

    // Try skipped message keys
    const skippedKey = `${header.dh.x}:${header.dh.y}:${header.n}`;
    if (this.MKSKIPPED.has(skippedKey)) {
      const mk = this.MKSKIPPED.get(skippedKey)!;
      this.MKSKIPPED.delete(skippedKey);
      const plaintext = await aesDecrypt(mk, ciphertextBuffer);
      return new TextDecoder().decode(plaintext);
    }

    // Check if DH ratchet step needed
    const needsRatchet = !this.DHrJwk ||
      this.DHrJwk.x !== header.dh.x ||
      this.DHrJwk.y !== header.dh.y;

    if (needsRatchet) {
      // Skip missed messages in current chain
      if (this.CKr !== null && this.DHrJwk) {
        await this.skipMessageKeys(this.DHrJwk, header.pn);
      }

      // DH Ratchet step
      this.PN = this.Ns;
      this.Ns = 0;
      this.Nr = 0;
      this.DHrJwk = header.dh;
      this.DHr = await importDHPublicKey(header.dh);

      const dhOut = await performDH(this.DHs!.privateKey, this.DHr);
      const { rootKey, chainKey } = await kdfRK(this.RK, dhOut);
      this.RK = rootKey;
      this.CKr = chainKey;

      // Generate new DH key pair
      this.DHs = await generateDHKeyPair();
      const dhOut2 = await performDH(this.DHs.privateKey, this.DHr);
      const result = await kdfRK(this.RK, dhOut2);
      this.RK = result.rootKey;
      this.CKs = result.chainKey;
    }

    // Skip missed messages
    await this.skipMessageKeys(header.dh, header.n);

    if (!this.CKr) throw new Error('Receiving chain not initialized');
    const { chainKey, messageKey } = await kdfCK(this.CKr);
    this.CKr = chainKey;
    this.Nr++;

    const plaintext = await aesDecrypt(messageKey, ciphertextBuffer);
    return new TextDecoder().decode(plaintext);
  }

  private async skipMessageKeys(dhPublicJwk: JsonWebKey, until: number): Promise<void> {
    if (!this.CKr) return;
    if (this.Nr + MAX_SKIP < until) throw new Error('Too many skipped messages');

    while (this.Nr < until) {
      const { chainKey, messageKey } = await kdfCK(this.CKr);
      this.CKr = chainKey;
      const key = `${dhPublicJwk.x}:${dhPublicJwk.y}:${this.Nr}`;
      this.MKSKIPPED.set(key, messageKey);
      this.Nr++;
    }
  }

  async serialize(): Promise<SerializedSessionState> {
    return {
      DHs: {
        publicKey: await exportKey(this.DHs!.publicKey),
        privateKey: await exportKey(this.DHs!.privateKey),
      },
      DHr: this.DHrJwk,
      RK: ab2b64(this.RK),
      CKs: this.CKs ? ab2b64(this.CKs) : null,
      CKr: this.CKr ? ab2b64(this.CKr) : null,
      Ns: this.Ns,
      Nr: this.Nr,
      PN: this.PN,
      MKSKIPPED: Array.from(this.MKSKIPPED.entries()).map(([k, v]) => [k, ab2b64(v)]),
    };
  }

  async deserialize(state: SerializedSessionState): Promise<void> {
    this.DHs = {
      publicKey: await importDHPublicKey(state.DHs.publicKey),
      privateKey: await importDHPrivateKey(state.DHs.privateKey),
    };
    this.DHrJwk = state.DHr;
    this.DHr = state.DHr ? await importDHPublicKey(state.DHr) : null;
    this.RK = b642ab(state.RK);
    this.CKs = state.CKs ? b642ab(state.CKs) : null;
    this.CKr = state.CKr ? b642ab(state.CKr) : null;
    this.Ns = state.Ns;
    this.Nr = state.Nr;
    this.PN = state.PN;
    this.MKSKIPPED = new Map(
      state.MKSKIPPED.map(([k, v]) => [k, b642ab(v)])
    );
  }
}
