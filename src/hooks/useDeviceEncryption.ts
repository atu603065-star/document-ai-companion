// @ts-nocheck
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

const DB_NAME = 'device-encryption-store';
const DB_VERSION = 1;
const STORE_NAME = 'keys';

interface DeviceKeyPair {
  publicKey: string;
  privateKey: string;
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

// --- IndexedDB helpers for private key storage ---

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

async function getStoredKeys(): Promise<DeviceKeyPair | null> {
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

async function storeKeys(keys: DeviceKeyPair): Promise<void> {
  const db = await openKeyDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put({ id: 'device-keys', data: keys });
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

// --- Crypto helpers using Web Crypto API ---

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

async function generateDeviceKeyPair(): Promise<DeviceKeyPair> {
  // Generate ECDH P-256 key pair for key exchange
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits']
  );

  const publicKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  const privateKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);

  const publicKeyStr = JSON.stringify(publicKeyJwk);
  const privateKeyStr = JSON.stringify(privateKeyJwk);

  // Generate fingerprint from public key
  const pubKeyBuffer = new TextEncoder().encode(publicKeyStr);
  const hashBuffer = await crypto.subtle.digest('SHA-256', pubKeyBuffer);
  const fingerprint = ab2b64(hashBuffer).substring(0, 16);

  return {
    publicKey: publicKeyStr,
    privateKey: privateKeyStr,
    fingerprint,
  };
}

async function deriveAESKey(privateKeyJwk: JsonWebKey, publicKeyJwk: JsonWebKey): Promise<CryptoKey> {
  const privateKey = await crypto.subtle.importKey(
    'jwk', privateKeyJwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false, ['deriveBits']
  );
  const publicKey = await crypto.subtle.importKey(
    'jwk', publicKeyJwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false, []
  );

  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: publicKey },
    privateKey,
    256
  );

  return crypto.subtle.importKey(
    'raw', sharedBits,
    { name: 'AES-GCM', length: 256 },
    false, ['encrypt', 'decrypt']
  );
}

export async function encryptWithDeviceKey(message: string, privateKeyStr: string, publicKeyStr: string): Promise<string> {
  const privateKeyJwk = JSON.parse(privateKeyStr) as JsonWebKey;
  const publicKeyJwk = JSON.parse(publicKeyStr) as JsonWebKey;

  const aesKey = await deriveAESKey(privateKeyJwk, publicKeyJwk);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(message);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey, encoded
  );

  // Format: base64(iv) + '.' + base64(ciphertext)
  return `DE:${ab2b64(iv.buffer as ArrayBuffer)}.${ab2b64(ciphertext)}`;
}

export async function decryptWithDeviceKey(encrypted: string, privateKeyStr: string, publicKeyStr: string): Promise<string> {
  if (!encrypted.startsWith('DE:')) {
    return encrypted; // Not device-encrypted
  }

  const payload = encrypted.slice(3);
  const [ivB64, ciphertextB64] = payload.split('.');

  const privateKeyJwk = JSON.parse(privateKeyStr) as JsonWebKey;
  const publicKeyJwk = JSON.parse(publicKeyStr) as JsonWebKey;

  const aesKey = await deriveAESKey(privateKeyJwk, publicKeyJwk);
  const iv = new Uint8Array(b642ab(ivB64));
  const ciphertext = b642ab(ciphertextB64);

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    aesKey, ciphertext
  );

  return new TextDecoder().decode(decrypted);
}

export function isDeviceEncrypted(message: string): boolean {
  return message.startsWith('DE:');
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
  const [keys, setKeys] = useState<DeviceKeyPair | null>(null);

  // Check if device encryption is active
  const checkStatus = useCallback(async () => {
    if (!userId) { setLoading(false); return; }

    try {
      const storedKeys = await getStoredKeys();
      if (storedKeys) {
        setKeys(storedKeys);

        // Check if this device is registered in DB
        const { data } = await supabase
          .from('user_devices' as any)
          .select('*')
          .eq('user_id', userId)
          .eq('device_fingerprint', storedKeys.fingerprint)
          .eq('is_active', true)
          .maybeSingle();

        if (data) {
          setIsEnabled(true);
          setIsReady(true);
          setCurrentDeviceId((data as any).id);

          // Update last_active
          await supabase
            .from('user_devices' as any)
            .update({ last_active: new Date().toISOString() } as any)
            .eq('id', (data as any).id);
        }
      }

      // Fetch all devices
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
      .from('user_devices' as any)
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

  // Enable device encryption
  const enableEncryption = useCallback(async () => {
    if (!userId) return false;

    try {
      const keyPair = await generateDeviceKeyPair();
      await storeKeys(keyPair);

      const { data, error } = await supabase
        .from('user_devices' as any)
        .insert({
          user_id: userId,
          device_name: getDeviceName(),
          public_key: keyPair.publicKey,
          device_fingerprint: keyPair.fingerprint,
          is_active: true,
        } as any)
        .select()
        .single();

      if (error) throw error;

      setKeys(keyPair);
      setIsEnabled(true);
      setIsReady(true);
      setCurrentDeviceId((data as any).id);
      await fetchDevices();
      return true;
    } catch (err) {
      console.error('Failed to enable device encryption:', err);
      return false;
    }
  }, [userId, fetchDevices]);

  // Disable device encryption (revoke current device)
  const disableEncryption = useCallback(async () => {
    if (!userId || !currentDeviceId) return false;

    try {
      await supabase
        .from('user_devices' as any)
        .update({ is_active: false } as any)
        .eq('id', currentDeviceId);

      await clearStoredKeys();
      setKeys(null);
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

  // Revoke a specific device
  const revokeDevice = useCallback(async (deviceId: string) => {
    if (!userId) return false;

    try {
      await supabase
        .from('user_devices' as any)
        .update({ is_active: false } as any)
        .eq('id', deviceId)
        .eq('user_id', userId);

      // If revoking current device, clear local keys
      if (deviceId === currentDeviceId) {
        await clearStoredKeys();
        setKeys(null);
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

  // Encrypt message using current device keys
  const encrypt = useCallback(async (message: string): Promise<string> => {
    if (!keys || !isReady) return message;
    try {
      return await encryptWithDeviceKey(message, keys.privateKey, keys.publicKey);
    } catch {
      return message;
    }
  }, [keys, isReady]);

  // Decrypt message
  const decrypt = useCallback(async (encryptedMessage: string): Promise<string> => {
    if (!keys || !isReady) {
      if (isDeviceEncrypted(encryptedMessage)) {
        return '[🔒 Không thể giải mã - thiết bị không có quyền]';
      }
      return encryptedMessage;
    }
    if (!isDeviceEncrypted(encryptedMessage)) return encryptedMessage;

    try {
      return await decryptWithDeviceKey(encryptedMessage, keys.privateKey, keys.publicKey);
    } catch {
      return '[🔒 Không thể giải mã tin nhắn]';
    }
  }, [keys, isReady]);

  return {
    isEnabled,
    isReady,
    loading,
    devices,
    currentDeviceId,
    enableEncryption,
    disableEncryption,
    revokeDevice,
    encrypt,
    decrypt,
    fetchDevices,
  };
}
