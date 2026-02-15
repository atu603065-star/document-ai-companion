// @ts-nocheck
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

const DB_NAME = 'device-encryption-store';
const DB_VERSION = 1;
const STORE_NAME = 'keys';

interface DeviceKeyPair {
  publicKey: string; // JWK JSON string
  privateKey: CryptoKey; // Non-extractable CryptoKey
  fingerprint: string;
}

interface StoredKeyData {
  publicKeyJwk: JsonWebKey;
  privateKeyJwk: JsonWebKey; // We store JWK but import as non-extractable
  fingerprint: string;
}

export interface DeviceInfo {
  id: string;
  device_name: string;
  public_key: string;
  device_fingerprint: string;
  is_active: boolean;
  created_at: string;
  last_active: string;
}

// Encrypted message structure stored in device_encrypted_content JSONB
export interface DeviceEncryptedPayload {
  v: 1; // version
  device_id: string; // UUID of the device that can decrypt
  device_fingerprint: string;
  ciphertext: string; // base64 AES-GCM encrypted content
  iv: string; // base64 IV
  encrypted_aes_key: string; // base64 AES key encrypted with device's ECDH-derived key
  sender_device_id: string;
}

// --- IndexedDB helpers ---

function openKeyDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getStoredKeyData(): Promise<StoredKeyData | null> {
  try {
    const db = await openKeyDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get('device-keys');
      request.onsuccess = () => resolve(request.result?.data || null);
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => db.close();
    });
  } catch {
    return null;
  }
}

async function storeKeyData(data: StoredKeyData): Promise<void> {
  const db = await openKeyDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put({ id: 'device-keys', data });
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

async function clearStoredKeys(): Promise<void> {
  try {
    const db = await openKeyDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.clear();
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  } catch {
    // ignore
  }
}

// --- Crypto helpers ---

function ab2b64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function b642ab(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer as ArrayBuffer;
}

async function generateDeviceKeys(): Promise<{ stored: StoredKeyData; privateKey: CryptoKey }> {
  // Generate ECDH P-256 key pair
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true, // extractable for initial storage only
    ['deriveBits']
  );

  const publicKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  const privateKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);

  // Generate fingerprint from public key
  const pubKeyStr = JSON.stringify(publicKeyJwk);
  const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pubKeyStr));
  const fingerprint = ab2b64(hashBuffer).substring(0, 16);

  // Import private key as non-extractable for runtime use
  const nonExtractablePrivateKey = await crypto.subtle.importKey(
    'jwk', privateKeyJwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false, // NON-EXTRACTABLE
    ['deriveBits']
  );

  return {
    stored: { publicKeyJwk, privateKeyJwk, fingerprint },
    privateKey: nonExtractablePrivateKey,
  };
}

async function importPrivateKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'jwk', jwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false, // NON-EXTRACTABLE
    ['deriveBits']
  );
}

async function importPublicKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'jwk', jwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );
}

// Derive AES key from ECDH shared secret
async function deriveAESFromECDH(privateKey: CryptoKey, publicKeyJwk: JsonWebKey): Promise<CryptoKey> {
  const publicKey = await importPublicKey(publicKeyJwk);
  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: publicKey },
    privateKey,
    256
  );
  return crypto.subtle.importKey(
    'raw', sharedBits,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// --- Encryption/Decryption ---

/**
 * Encrypt a message for a specific device.
 * Flow:
 * 1. Generate random AES-256-GCM key for the message
 * 2. Encrypt message content with the random AES key
 * 3. Derive a wrapping key from ECDH(sender_private, device_public)
 * 4. Encrypt the random AES key with the wrapping key
 * 5. Return the payload
 */
export async function encryptForDevice(
  message: string,
  senderPrivateKey: CryptoKey,
  devicePublicKeyJwk: JsonWebKey,
  deviceId: string,
  deviceFingerprint: string,
  senderDeviceId: string,
): Promise<DeviceEncryptedPayload> {
  // 1. Generate random AES key for message
  const messageKey = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true, // extractable so we can wrap it
    ['encrypt', 'decrypt']
  );

  // 2. Encrypt message content
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(message);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    messageKey,
    encoded
  );

  // 3. Derive wrapping key from ECDH
  const wrappingKey = await deriveAESFromECDH(senderPrivateKey, devicePublicKeyJwk);

  // 4. Export and encrypt the message key
  const rawMessageKey = await crypto.subtle.exportKey('raw', messageKey);
  const keyIv = crypto.getRandomValues(new Uint8Array(12));
  const encryptedKey = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: keyIv },
    wrappingKey,
    rawMessageKey
  );

  // Combine keyIv + encryptedKey for storage
  const combinedKey = new Uint8Array(keyIv.length + new Uint8Array(encryptedKey).length);
  combinedKey.set(keyIv);
  combinedKey.set(new Uint8Array(encryptedKey), keyIv.length);

  return {
    v: 1,
    device_id: deviceId,
    device_fingerprint: deviceFingerprint,
    ciphertext: ab2b64(ciphertext),
    iv: ab2b64(iv.buffer as ArrayBuffer),
    encrypted_aes_key: ab2b64(combinedKey.buffer as ArrayBuffer),
    sender_device_id: senderDeviceId,
  };
}

/**
 * Decrypt a device-encrypted message.
 * The current device must have the matching private key.
 */
export async function decryptDeviceMessage(
  payload: DeviceEncryptedPayload,
  devicePrivateKey: CryptoKey,
  senderPublicKeyJwk: JsonWebKey,
): Promise<string> {
  // 1. Derive wrapping key from ECDH(my_private, sender_public)
  const wrappingKey = await deriveAESFromECDH(devicePrivateKey, senderPublicKeyJwk);

  // 2. Split keyIv + encryptedKey
  const combinedKeyBuf = b642ab(payload.encrypted_aes_key);
  const combinedArr = new Uint8Array(combinedKeyBuf);
  const keyIv = combinedArr.slice(0, 12);
  const encryptedKeyData = combinedArr.slice(12);

  // 3. Decrypt the AES message key
  const rawMessageKey = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: keyIv },
    wrappingKey,
    encryptedKeyData
  );

  // 4. Import the message key
  const messageKey = await crypto.subtle.importKey(
    'raw', rawMessageKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );

  // 5. Decrypt the message
  const iv = new Uint8Array(b642ab(payload.iv));
  const ciphertext = b642ab(payload.ciphertext);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    messageKey,
    ciphertext
  );

  return new TextDecoder().decode(decrypted);
}

// --- Device name detection ---

function getDeviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Mac/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Linux/.test(ua)) return 'Linux';
  return 'Unknown Device';
}

// --- Main hook ---

export function useDeviceEncryption(userId: string | undefined) {
  const [isEnabled, setIsEnabled] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [privateKey, setPrivateKey] = useState<CryptoKey | null>(null);
  const [publicKeyJwk, setPublicKeyJwk] = useState<JsonWebKey | null>(null);
  const [fingerprint, setFingerprint] = useState<string | null>(null);

  const checkStatus = useCallback(async () => {
    if (!userId) { setLoading(false); return; }

    try {
      const storedData = await getStoredKeyData();
      if (storedData) {
        // Import private key as non-extractable
        const privKey = await importPrivateKey(storedData.privateKeyJwk);
        setPrivateKey(privKey);
        setPublicKeyJwk(storedData.publicKeyJwk);
        setFingerprint(storedData.fingerprint);

        // Check if this device is registered in DB
        const { data } = await supabase
          .from('user_devices')
          .select('*')
          .eq('user_id', userId)
          .eq('device_fingerprint', storedData.fingerprint)
          .eq('is_active', true)
          .maybeSingle();

        if (data) {
          setIsEnabled(true);
          setIsReady(true);
          setCurrentDeviceId(data.id);

          // Update last_active
          await supabase
            .from('user_devices')
            .update({ last_active: new Date().toISOString() })
            .eq('id', data.id);
        }
      }

      await fetchDevices();
    } catch (err) {
      console.error('Device encryption check failed:', err);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  const fetchDevices = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase
      .from('user_devices')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (data) {
      setDevices(data as unknown as DeviceInfo[]);
    }
  }, [userId]);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  const enableEncryption = useCallback(async () => {
    if (!userId) return false;

    try {
      const { stored, privateKey: privKey } = await generateDeviceKeys();
      await storeKeyData(stored);

      const { data, error } = await supabase
        .from('user_devices')
        .insert({
          user_id: userId,
          device_name: getDeviceName(),
          public_key: JSON.stringify(stored.publicKeyJwk),
          device_fingerprint: stored.fingerprint,
          is_active: true,
        })
        .select()
        .single();

      if (error) throw error;

      setPrivateKey(privKey);
      setPublicKeyJwk(stored.publicKeyJwk);
      setFingerprint(stored.fingerprint);
      setIsEnabled(true);
      setIsReady(true);
      setCurrentDeviceId(data.id);
      await fetchDevices();
      return true;
    } catch (err) {
      console.error('Failed to enable device encryption:', err);
      return false;
    }
  }, [userId, fetchDevices]);

  const disableEncryption = useCallback(async () => {
    if (!userId || !currentDeviceId) return false;

    try {
      await supabase
        .from('user_devices')
        .update({ is_active: false })
        .eq('id', currentDeviceId);

      await clearStoredKeys();
      setPrivateKey(null);
      setPublicKeyJwk(null);
      setFingerprint(null);
      setIsEnabled(false);
      setIsReady(false);
      setCurrentDeviceId(null);
      await fetchDevices();
      return true;
    } catch (err) {
      console.error('Failed to disable device encryption:', err);
      return false;
    }
  }, [userId, currentDeviceId, fetchDevices]);

  const revokeDevice = useCallback(async (deviceId: string) => {
    if (!userId) return false;

    try {
      await supabase
        .from('user_devices')
        .update({ is_active: false })
        .eq('id', deviceId)
        .eq('user_id', userId);

      if (deviceId === currentDeviceId) {
        await clearStoredKeys();
        setPrivateKey(null);
        setPublicKeyJwk(null);
        setFingerprint(null);
        setIsEnabled(false);
        setIsReady(false);
        setCurrentDeviceId(null);
      }

      await fetchDevices();
      return true;
    } catch (err) {
      console.error('Failed to revoke device:', err);
      return false;
    }
  }, [userId, currentDeviceId, fetchDevices]);

  /**
   * Encrypt message for current device only.
   * Returns DeviceEncryptedPayload to be stored in device_encrypted_content.
   */
  const encrypt = useCallback(async (message: string): Promise<DeviceEncryptedPayload | null> => {
    if (!privateKey || !publicKeyJwk || !currentDeviceId || !fingerprint || !isReady) return null;
    try {
      return await encryptForDevice(
        message,
        privateKey,
        publicKeyJwk,
        currentDeviceId,
        fingerprint,
        currentDeviceId,
      );
    } catch (err) {
      console.error('Device encryption failed:', err);
      return null;
    }
  }, [privateKey, publicKeyJwk, currentDeviceId, fingerprint, isReady]);

  /**
   * Decrypt a device-encrypted message.
   * Returns null if this device cannot decrypt (wrong device).
   */
  const decrypt = useCallback(async (payload: DeviceEncryptedPayload, senderPublicKey?: string): Promise<string | null> => {
    if (!privateKey || !isReady || !currentDeviceId) return null;

    // Check if this message is for this device
    if (payload.device_id !== currentDeviceId && payload.sender_device_id !== currentDeviceId) {
      return null; // Not for this device
    }

    try {
      // We need the sender's public key to derive the shared secret
      // If sender is us (same device), use our own public key
      let senderPubKeyJwk: JsonWebKey;
      if (payload.sender_device_id === currentDeviceId) {
        // We sent this message - use our own public key
        senderPubKeyJwk = publicKeyJwk!;
      } else if (senderPublicKey) {
        senderPubKeyJwk = JSON.parse(senderPublicKey);
      } else {
        return null;
      }

      return await decryptDeviceMessage(payload, privateKey, senderPubKeyJwk);
    } catch (err) {
      console.error('Device decryption failed:', err);
      return null;
    }
  }, [privateKey, publicKeyJwk, currentDeviceId, isReady]);

  return {
    isEnabled,
    isReady,
    loading,
    devices,
    currentDeviceId,
    fingerprint,
    publicKeyJwk,
    enableEncryption,
    disableEncryption,
    revokeDevice,
    encrypt,
    decrypt,
    fetchDevices,
  };
}
