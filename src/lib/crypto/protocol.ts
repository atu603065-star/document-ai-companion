import { supabase } from '@/integrations/supabase/client';
import { DoubleRatchet } from './double-ratchet';
import { initiateX3DH, completeX3DH, generatePreKeyBundle } from './x3dh';
import {
  getLocalIdentity, saveLocalIdentity,
  getSignedPreKey, saveSignedPreKey,
  getOneTimePreKey, saveOneTimePreKey, deleteOneTimePreKey,
  getSession, saveSession,
  getMetadata, setMetadata,
  clearAllCryptoData
} from './key-store';
import {
  generateDHKeyPair, generateSigningKeyPair, exportKey,
  importDHPublicKey, importDHPrivateKey,
  generateRegistrationId, ab2b64, signData
} from './utils';
import { generateSafetyNumber } from './safety-number';
import type { SignalMessage, PreKeyBundle, SessionRecord } from './types';

export class SignalProtocol {
  private userId: string;
  private sessions: Map<string, DoubleRatchet> = new Map();
  private initialized: boolean = false;

  constructor(userId: string) {
    this.userId = userId;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    let identity = await getLocalIdentity(this.userId);
    if (!identity) {
      await this.generateAndUploadKeys();
    } else {
      // Check if keys are on server
      const { data } = await supabase
        .from('identity_keys' as any)
        .select('*')
        .eq('user_id', this.userId)
        .maybeSingle();

      if (!data) {
        await this.uploadPublicKeys(identity);
      }

      await this.rotatePreKeysIfNeeded();
      await this.refillOneTimePreKeys();
    }
    this.initialized = true;
  }

  private async generateAndUploadKeys(): Promise<void> {
    const identityKeyPair = await generateDHKeyPair();
    const signingKeyPair = await generateSigningKeyPair();
    const registrationId = generateRegistrationId();

    const bundle = await generatePreKeyBundle(
      identityKeyPair, signingKeyPair, 1, 1, 20
    );

    const identityPublicJwk = await exportKey(identityKeyPair.publicKey);
    const identityPrivateJwk = await exportKey(identityKeyPair.privateKey);
    const signingPublicJwk = await exportKey(signingKeyPair.publicKey);
    const signingPrivateJwk = await exportKey(signingKeyPair.privateKey);

    await saveLocalIdentity({
      userId: this.userId,
      keyPair: { publicKey: identityPublicJwk, privateKey: identityPrivateJwk },
      signingKeyPair: { publicKey: signingPublicJwk, privateKey: signingPrivateJwk },
      registrationId,
      createdAt: Date.now(),
    });

    await saveSignedPreKey(this.userId, {
      keyId: bundle.signedPreKey.keyId,
      keyPair: {
        publicKey: bundle.signedPreKey.publicKey,
        privateKey: await exportKey(bundle.signedPreKey.keyPair.privateKey),
      },
      signature: bundle.signedPreKey.signature,
      timestamp: Date.now(),
    });

    for (const otpk of bundle.oneTimePreKeys) {
      await saveOneTimePreKey(this.userId, {
        keyId: otpk.keyId,
        keyPair: {
          publicKey: otpk.publicKey,
          privateKey: await exportKey(otpk.keyPair.privateKey),
        },
      });
    }

    // Upload public keys
    await (supabase as any).from('identity_keys').upsert({
      user_id: this.userId,
      identity_key: JSON.stringify(identityPublicJwk),
      signing_key: JSON.stringify(signingPublicJwk),
    });

    await (supabase as any).from('signed_prekeys').upsert({
      user_id: this.userId,
      key_id: bundle.signedPreKey.keyId,
      public_key: JSON.stringify(bundle.signedPreKey.publicKey),
      signature: bundle.signedPreKey.signature,
    });

    const otpkRows = bundle.oneTimePreKeys.map(otpk => ({
      user_id: this.userId,
      key_id: otpk.keyId,
      public_key: JSON.stringify(otpk.publicKey),
    }));
    await (supabase as any).from('one_time_prekeys').insert(otpkRows);

    await setMetadata('nextSignedPreKeyId', 2);
    await setMetadata('nextOneTimePreKeyId', 21);
    await setMetadata('lastSignedPreKeyRotation', Date.now());
  }

  private async uploadPublicKeys(identity: any): Promise<void> {
    await (supabase as any).from('identity_keys').upsert({
      user_id: this.userId,
      identity_key: JSON.stringify(identity.keyPair.publicKey),
      signing_key: JSON.stringify(identity.signingKeyPair.publicKey),
    });
  }

  private async rotatePreKeysIfNeeded(): Promise<void> {
    const lastRotation = await getMetadata('lastSignedPreKeyRotation');
    if (lastRotation && Date.now() - lastRotation < 7 * 24 * 60 * 60 * 1000) return;

    const identity = await getLocalIdentity(this.userId);
    if (!identity) return;

    const signingPrivateKey = await crypto.subtle.importKey(
      'jwk', identity.signingKeyPair.privateKey,
      { name: 'ECDSA', namedCurve: 'P-256' },
      true, ['sign']
    );

    const nextId = (await getMetadata('nextSignedPreKeyId')) || 1;
    const newPreKeyPair = await generateDHKeyPair();
    const publicJwk = await exportKey(newPreKeyPair.publicKey);

    const encoder = new TextEncoder();
    const data = encoder.encode(JSON.stringify(publicJwk));
    const signature = await signData(signingPrivateKey, data.buffer as ArrayBuffer);
    const signatureB64 = ab2b64(signature);

    await saveSignedPreKey(this.userId, {
      keyId: nextId,
      keyPair: {
        publicKey: publicJwk,
        privateKey: await exportKey(newPreKeyPair.privateKey),
      },
      signature: signatureB64,
      timestamp: Date.now(),
    });

    await (supabase as any).from('signed_prekeys').upsert({
      user_id: this.userId,
      key_id: nextId,
      public_key: JSON.stringify(publicJwk),
      signature: signatureB64,
    });

    await setMetadata('nextSignedPreKeyId', nextId + 1);
    await setMetadata('lastSignedPreKeyRotation', Date.now());
  }

  private async refillOneTimePreKeys(): Promise<void> {
    const { count } = await (supabase as any)
      .from('one_time_prekeys')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', this.userId)
      .eq('used', false);

    if ((count || 0) >= 10) return;

    const toGenerate = 20 - (count || 0);
    const startId = (await getMetadata('nextOneTimePreKeyId')) || 1;

    const newPreKeys = [];
    for (let i = 0; i < toGenerate; i++) {
      const keyPair = await generateDHKeyPair();
      const publicJwk = await exportKey(keyPair.publicKey);
      const privateJwk = await exportKey(keyPair.privateKey);

      await saveOneTimePreKey(this.userId, {
        keyId: startId + i,
        keyPair: { publicKey: publicJwk, privateKey: privateJwk },
      });

      newPreKeys.push({
        user_id: this.userId,
        key_id: startId + i,
        public_key: JSON.stringify(publicJwk),
      });
    }

    if (newPreKeys.length > 0) {
      await (supabase as any).from('one_time_prekeys').insert(newPreKeys);
    }
    await setMetadata('nextOneTimePreKeyId', startId + toGenerate);
  }

  async encryptMessage(
    conversationId: string,
    remoteUserId: string,
    plaintext: string
  ): Promise<string> {
    let ratchet = this.sessions.get(conversationId);

    if (!ratchet) {
      const storedSession = await getSession(conversationId);
      if (storedSession) {
        ratchet = new DoubleRatchet();
        await ratchet.deserialize(storedSession.state);
        this.sessions.set(conversationId, ratchet);
      }
    }

    if (!ratchet) {
      // Initiate X3DH session
      const result = await this.initiateSession(conversationId, remoteUserId);
      ratchet = result.ratchet;

      const { header, ciphertext } = await ratchet.encrypt(plaintext);
      const identity = await getLocalIdentity(this.userId);

      const signalMessage: SignalMessage = {
        header,
        ciphertext,
        v: 2,
        x3dh: {
          identityKey: identity!.keyPair.publicKey,
          ephemeralKey: result.ephemeralPublicKey,
          oneTimePreKeyId: result.oneTimePreKeyId,
        },
      };

      await this.persistSession(conversationId, remoteUserId, ratchet);
      return JSON.stringify(signalMessage);
    }

    const { header, ciphertext } = await ratchet.encrypt(plaintext);
    const signalMessage: SignalMessage = { header, ciphertext, v: 2 };

    await this.persistSession(conversationId, remoteUserId, ratchet);
    return JSON.stringify(signalMessage);
  }

  async decryptMessage(
    conversationId: string,
    remoteUserId: string,
    encryptedString: string
  ): Promise<string> {
    try {
      const parsed = JSON.parse(encryptedString);
      if (parsed.v !== 2) return encryptedString;

      const signalMessage = parsed as SignalMessage;
      let ratchet = this.sessions.get(conversationId);

      if (!ratchet) {
        const storedSession = await getSession(conversationId);
        if (storedSession) {
          ratchet = new DoubleRatchet();
          await ratchet.deserialize(storedSession.state);
          this.sessions.set(conversationId, ratchet);
        }
      }

      if (!ratchet && signalMessage.x3dh) {
        ratchet = await this.completeSession(conversationId, remoteUserId, signalMessage);
      }

      if (!ratchet) {
        return '[Không có session mã hóa]';
      }

      const plaintext = await ratchet.decrypt(signalMessage.header, signalMessage.ciphertext);
      await this.persistSession(conversationId, remoteUserId, ratchet);
      return plaintext;
    } catch (error) {
      console.error('Signal decrypt error:', error);
      return '[Không thể giải mã]';
    }
  }

  private async initiateSession(conversationId: string, remoteUserId: string) {
    const identity = await getLocalIdentity(this.userId);
    if (!identity) throw new Error('Identity not initialized');

    const bundle = await this.fetchPreKeyBundle(remoteUserId);
    if (!bundle) throw new Error('Remote user has no prekey bundle');

    const identityKeyPair = {
      publicKey: await importDHPublicKey(identity.keyPair.publicKey),
      privateKey: await importDHPrivateKey(identity.keyPair.privateKey),
    };

    const { sharedSecret, ephemeralPublicKey, usedOneTimePreKeyId } =
      await initiateX3DH(identityKeyPair, bundle);

    const ratchet = new DoubleRatchet();
    const bobSignedPreKey = await importDHPublicKey(bundle.signedPreKey.publicKey);
    await ratchet.initAlice(sharedSecret, bobSignedPreKey);

    this.sessions.set(conversationId, ratchet);

    return { ratchet, ephemeralPublicKey, oneTimePreKeyId: usedOneTimePreKeyId };
  }

  private async completeSession(
    conversationId: string,
    remoteUserId: string,
    message: SignalMessage
  ): Promise<DoubleRatchet> {
    if (!message.x3dh) throw new Error('No X3DH header');

    const identity = await getLocalIdentity(this.userId);
    if (!identity) throw new Error('Identity not initialized');

    // Get latest signed prekey
    const { data: spkData } = await (supabase as any)
      .from('signed_prekeys')
      .select('key_id')
      .eq('user_id', this.userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!spkData) throw new Error('No signed prekey');

    const storedSPK = await getSignedPreKey(this.userId, spkData.key_id);
    if (!storedSPK) throw new Error('Signed prekey missing from local store');

    const bobIdentityKP = {
      publicKey: await importDHPublicKey(identity.keyPair.publicKey),
      privateKey: await importDHPrivateKey(identity.keyPair.privateKey),
    };
    const bobSignedPreKP = {
      publicKey: await importDHPublicKey(storedSPK.keyPair.publicKey),
      privateKey: await importDHPrivateKey(storedSPK.keyPair.privateKey),
    };

    let bobOTPKP: CryptoKeyPair | null = null;
    if (message.x3dh.oneTimePreKeyId !== undefined) {
      const storedOTPK = await getOneTimePreKey(this.userId, message.x3dh.oneTimePreKeyId);
      if (storedOTPK) {
        bobOTPKP = {
          publicKey: await importDHPublicKey(storedOTPK.keyPair.publicKey),
          privateKey: await importDHPrivateKey(storedOTPK.keyPair.privateKey),
        };
        await deleteOneTimePreKey(this.userId, message.x3dh.oneTimePreKeyId);
      }
    }

    const sharedSecret = await completeX3DH(
      bobIdentityKP, bobSignedPreKP, bobOTPKP,
      message.x3dh.identityKey, message.x3dh.ephemeralKey
    );

    const ratchet = new DoubleRatchet();
    await ratchet.initBob(sharedSecret, bobSignedPreKP);
    this.sessions.set(conversationId, ratchet);

    return ratchet;
  }

  private async fetchPreKeyBundle(remoteUserId: string): Promise<PreKeyBundle | null> {
    const { data: idData } = await (supabase as any)
      .from('identity_keys')
      .select('identity_key')
      .eq('user_id', remoteUserId)
      .single();

    if (!idData) return null;

    const { data: spkData } = await (supabase as any)
      .from('signed_prekeys')
      .select('key_id, public_key, signature')
      .eq('user_id', remoteUserId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!spkData) return null;

    const { data: otpkData } = await supabase
      .rpc('claim_one_time_prekey', { target_user_id: remoteUserId });

    const bundle: PreKeyBundle = {
      identityKey: JSON.parse(idData.identity_key),
      signedPreKey: {
        keyId: spkData.key_id,
        publicKey: JSON.parse(spkData.public_key),
        signature: spkData.signature,
      },
    };

    if (otpkData) {
      bundle.oneTimePreKey = {
        keyId: (otpkData as any).key_id,
        publicKey: JSON.parse((otpkData as any).public_key),
      };
    }

    return bundle;
  }

  private async persistSession(
    conversationId: string,
    remoteUserId: string,
    ratchet: DoubleRatchet
  ): Promise<void> {
    const session: SessionRecord = {
      conversationId,
      remoteUserId,
      state: await ratchet.serialize(),
      x3dhCompleted: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await saveSession(session);
  }

  async getSafetyNumber(remoteUserId: string): Promise<string> {
    const localIdentity = await getLocalIdentity(this.userId);
    if (!localIdentity) return '';

    const { data } = await (supabase as any)
      .from('identity_keys')
      .select('identity_key')
      .eq('user_id', remoteUserId)
      .single();

    if (!data) return '';
    return await generateSafetyNumber(
      localIdentity.keyPair.publicKey,
      JSON.parse(data.identity_key)
    );
  }

  async hasSession(conversationId: string): Promise<boolean> {
    if (this.sessions.has(conversationId)) return true;
    const stored = await getSession(conversationId);
    return !!stored;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  async clearAll(): Promise<void> {
    this.sessions.clear();
    this.initialized = false;
    await clearAllCryptoData();
  }
}
