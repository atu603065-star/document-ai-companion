/**
 * End-to-End Encryption utilities using WebCrypto API
 * Provides secure message encryption/decryption with key exchange
 */

// Constants
const ALGORITHM = 'AES-GCM';
const KEY_LENGTH = 256;
const IV_LENGTH = 12;
const SALT_LENGTH = 16;
const PBKDF2_ITERATIONS = 100000;

// Types
export interface EncryptedData {
  ciphertext: string;
  iv: string;
  salt: string;
}

export interface KeyPair {
  publicKey: JsonWebKey;
  privateKey: JsonWebKey;
}

// Check if WebCrypto is available
export const isEncryptionSupported = (): boolean => {
  return !!(window.crypto && window.crypto.subtle);
};

// Generate a random bytes array
const getRandomBytes = (length: number): Uint8Array => {
  return window.crypto.getRandomValues(new Uint8Array(length));
};

// Convert ArrayBuffer to Base64 string
const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

// Convert Base64 string to ArrayBuffer
const base64ToArrayBuffer = (base64: string): ArrayBuffer => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer as ArrayBuffer;
};

// Uint8Array to ArrayBuffer helper
const uint8ToArrayBuffer = (uint8: Uint8Array): ArrayBuffer => {
  return uint8.buffer.slice(uint8.byteOffset, uint8.byteOffset + uint8.byteLength) as ArrayBuffer;
};

// Generate ECDH key pair for key exchange
export const generateKeyPair = async (): Promise<KeyPair> => {
  const keyPair = await window.crypto.subtle.generateKey(
    {
      name: 'ECDH',
      namedCurve: 'P-256',
    },
    true,
    ['deriveKey', 'deriveBits']
  );

  const publicKey = await window.crypto.subtle.exportKey('jwk', keyPair.publicKey);
  const privateKey = await window.crypto.subtle.exportKey('jwk', keyPair.privateKey);

  return { publicKey, privateKey };
};

// Import public key from JWK
const importPublicKey = async (jwk: JsonWebKey): Promise<CryptoKey> => {
  return await window.crypto.subtle.importKey(
    'jwk',
    jwk,
    {
      name: 'ECDH',
      namedCurve: 'P-256',
    },
    false,
    []
  );
};

// Import private key from JWK
const importPrivateKey = async (jwk: JsonWebKey): Promise<CryptoKey> => {
  return await window.crypto.subtle.importKey(
    'jwk',
    jwk,
    {
      name: 'ECDH',
      namedCurve: 'P-256',
    },
    false,
    ['deriveKey', 'deriveBits']
  );
};

// Derive shared secret key from ECDH
export const deriveSharedKey = async (
  privateKeyJwk: JsonWebKey,
  publicKeyJwk: JsonWebKey
): Promise<CryptoKey> => {
  const privateKey = await importPrivateKey(privateKeyJwk);
  const publicKey = await importPublicKey(publicKeyJwk);

  return await window.crypto.subtle.deriveKey(
    {
      name: 'ECDH',
      public: publicKey,
    },
    privateKey,
    {
      name: ALGORITHM,
      length: KEY_LENGTH,
    },
    false,
    ['encrypt', 'decrypt']
  );
};

// Generate a symmetric key from password/passphrase
export const generateSymmetricKeyFromPassword = async (
  password: string,
  salt?: Uint8Array
): Promise<{ key: CryptoKey; salt: Uint8Array }> => {
  const useSalt = salt || getRandomBytes(SALT_LENGTH);
  const encoder = new TextEncoder();

  // Import password as key material
  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  // Derive AES key from password
  const key = await window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: uint8ToArrayBuffer(useSalt),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    {
      name: ALGORITHM,
      length: KEY_LENGTH,
    },
    false,
    ['encrypt', 'decrypt']
  );

  return { key, salt: useSalt };
};

// Generate a random symmetric key
export const generateSymmetricKey = async (): Promise<CryptoKey> => {
  return await window.crypto.subtle.generateKey(
    {
      name: ALGORITHM,
      length: KEY_LENGTH,
    },
    true,
    ['encrypt', 'decrypt']
  );
};

// Export symmetric key to raw format
export const exportSymmetricKey = async (key: CryptoKey): Promise<string> => {
  const rawKey = await window.crypto.subtle.exportKey('raw', key);
  return arrayBufferToBase64(rawKey);
};

// Import symmetric key from raw format
export const importSymmetricKey = async (keyBase64: string): Promise<CryptoKey> => {
  const rawKey = base64ToArrayBuffer(keyBase64);
  return await window.crypto.subtle.importKey(
    'raw',
    rawKey,
    {
      name: ALGORITHM,
      length: KEY_LENGTH,
    },
    false,
    ['encrypt', 'decrypt']
  );
};

// Encrypt a message with AES-GCM
export const encryptMessage = async (
  message: string,
  key: CryptoKey
): Promise<EncryptedData> => {
  const encoder = new TextEncoder();
  const iv = getRandomBytes(IV_LENGTH);
  const salt = getRandomBytes(SALT_LENGTH);

  const ciphertext = await window.crypto.subtle.encrypt(
    {
      name: ALGORITHM,
      iv: uint8ToArrayBuffer(iv),
    },
    key,
    encoder.encode(message)
  );

  return {
    ciphertext: arrayBufferToBase64(ciphertext),
    iv: arrayBufferToBase64(uint8ToArrayBuffer(iv)),
    salt: arrayBufferToBase64(uint8ToArrayBuffer(salt)),
  };
};

// Decrypt a message with AES-GCM
export const decryptMessage = async (
  encryptedData: EncryptedData,
  key: CryptoKey
): Promise<string> => {
  const decoder = new TextDecoder();
  const iv = base64ToArrayBuffer(encryptedData.iv);
  const ciphertext = base64ToArrayBuffer(encryptedData.ciphertext);

  const plaintext = await window.crypto.subtle.decrypt(
    {
      name: ALGORITHM,
      iv,
    },
    key,
    ciphertext
  );

  return decoder.decode(plaintext);
};

// Encrypt message with password-derived key
export const encryptWithPassword = async (
  message: string,
  password: string
): Promise<EncryptedData> => {
  const { key, salt } = await generateSymmetricKeyFromPassword(password);
  const encoder = new TextEncoder();
  const iv = getRandomBytes(IV_LENGTH);

  const ciphertext = await window.crypto.subtle.encrypt(
    {
      name: ALGORITHM,
      iv: uint8ToArrayBuffer(iv),
    },
    key,
    encoder.encode(message)
  );

  return {
    ciphertext: arrayBufferToBase64(ciphertext),
    iv: arrayBufferToBase64(uint8ToArrayBuffer(iv)),
    salt: arrayBufferToBase64(uint8ToArrayBuffer(salt)),
  };
};

// Decrypt message with password-derived key
export const decryptWithPassword = async (
  encryptedData: EncryptedData,
  password: string
): Promise<string> => {
  const saltBuffer = base64ToArrayBuffer(encryptedData.salt);
  const salt = new Uint8Array(saltBuffer);
  const { key } = await generateSymmetricKeyFromPassword(password, salt);
  
  return await decryptMessage(encryptedData, key);
};

// Hash data with SHA-256
export const hashData = async (data: string): Promise<string> => {
  const encoder = new TextEncoder();
  const hashBuffer = await window.crypto.subtle.digest('SHA-256', encoder.encode(data));
  return arrayBufferToBase64(hashBuffer);
};

// Generate a secure conversation key and encrypt it for storage
export const generateConversationKey = async (): Promise<{
  key: CryptoKey;
  keyBase64: string;
}> => {
  const key = await generateSymmetricKey();
  const keyBase64 = await exportSymmetricKey(key);
  return { key, keyBase64 };
};

// Simple message encryption for E2E (using conversation-specific key)
export const encryptForConversation = async (
  message: string,
  conversationKeyBase64: string
): Promise<string> => {
  const key = await importSymmetricKey(conversationKeyBase64);
  const encrypted = await encryptMessage(message, key);
  return JSON.stringify(encrypted);
};

// Simple message decryption for E2E
export const decryptForConversation = async (
  encryptedString: string,
  conversationKeyBase64: string | null
): Promise<string> => {
  try {
    if (!conversationKeyBase64) {
      return "[Không thể giải mã]";
    }

    if (!isEncryptedMessage(encryptedString)) {
      return encryptedString;
    }

    const encryptedData: EncryptedData = JSON.parse(encryptedString);
    const key = await importSymmetricKey(conversationKeyBase64);

    return await decryptMessage(encryptedData, key);
  } catch (err) {
    console.error("Decrypt failed:", err);
    return "[Không thể giải mã]";
  }
};


// Check if a message is encrypted (simple heuristic)
export const isEncryptedMessage = (content: string): boolean => {
  if (!content) return false;
  try {
    const parsed = JSON.parse(content);
    return !!(parsed.ciphertext && parsed.iv && parsed.salt);
  } catch {
    return false;
  }
};

// Local storage helpers for encryption keys
const KEYS_STORAGE_KEY = 'e2e_conversation_keys';

export const getStoredConversationKeys = (): Record<string, string> => {
  try {
    const stored = localStorage.getItem(KEYS_STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
};

export const storeConversationKey = (
  conversationId: string,
  keyBase64: string
): void => {
  try {
    const keys = getStoredConversationKeys();
    keys[conversationId] = keyBase64;
    localStorage.setItem(KEYS_STORAGE_KEY, JSON.stringify(keys));
  } catch {
    console.error('Failed to store conversation key');
  }
};

export const getConversationKey = (conversationId: string): string | null => {
  const keys = getStoredConversationKeys();
  return keys[conversationId] || null;
};

export const removeConversationKey = (conversationId: string): void => {
  try {
    const keys = getStoredConversationKeys();
    delete keys[conversationId];
    localStorage.setItem(KEYS_STORAGE_KEY, JSON.stringify(keys));
  } catch {
    console.error('Failed to remove conversation key');
  }
};

// Clear all stored keys (for logout)
export const clearAllEncryptionKeys = (): void => {
  try {
    localStorage.removeItem(KEYS_STORAGE_KEY);
  } catch {
    console.error('Failed to clear encryption keys');
  }
};
