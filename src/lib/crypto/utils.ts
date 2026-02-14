export const ab2b64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

export const b642ab = (base64: string): ArrayBuffer => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer as ArrayBuffer;
};

export const generateDHKeyPair = async (): Promise<CryptoKeyPair> => {
  return await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits']
  );
};

export const generateSigningKeyPair = async (): Promise<CryptoKeyPair> => {
  return await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );
};

export const performDH = async (
  privateKey: CryptoKey,
  publicKey: CryptoKey
): Promise<ArrayBuffer> => {
  return await crypto.subtle.deriveBits(
    { name: 'ECDH', public: publicKey },
    privateKey,
    256
  );
};

export const importDHPublicKey = async (jwk: JsonWebKey): Promise<CryptoKey> => {
  return await crypto.subtle.importKey(
    'jwk', jwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    true, []
  );
};

export const importDHPrivateKey = async (jwk: JsonWebKey): Promise<CryptoKey> => {
  return await crypto.subtle.importKey(
    'jwk', jwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    true, ['deriveBits']
  );
};

export const exportKey = async (key: CryptoKey): Promise<JsonWebKey> => {
  return await crypto.subtle.exportKey('jwk', key);
};

export const hkdf = async (
  ikm: ArrayBuffer,
  salt: ArrayBuffer,
  info: string,
  length: number = 64
): Promise<ArrayBuffer> => {
  const keyMaterial = await crypto.subtle.importKey(
    'raw', ikm, 'HKDF', false, ['deriveBits']
  );
  const encoder = new TextEncoder();
  return await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: encoder.encode(info) },
    keyMaterial,
    length * 8
  );
};

export const hmacSHA256 = async (
  key: ArrayBuffer,
  data: ArrayBuffer
): Promise<ArrayBuffer> => {
  const hmacKey = await crypto.subtle.importKey(
    'raw', key,
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  );
  return await crypto.subtle.sign('HMAC', hmacKey, data);
};

export const signData = async (
  privateKey: CryptoKey,
  data: ArrayBuffer
): Promise<ArrayBuffer> => {
  return await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey, data
  );
};

export const aesEncrypt = async (
  messageKey: ArrayBuffer,
  plaintext: ArrayBuffer
): Promise<ArrayBuffer> => {
  const derived = await hkdf(messageKey, new ArrayBuffer(32), 'signal-msg-encrypt', 44);
  const keyBytes = derived.slice(0, 32);
  const nonce = derived.slice(32, 44);
  const aesKey = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'AES-GCM', length: 256 }, false, ['encrypt']
  );
  return await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, plaintext);
};

export const aesDecrypt = async (
  messageKey: ArrayBuffer,
  ciphertext: ArrayBuffer
): Promise<ArrayBuffer> => {
  const derived = await hkdf(messageKey, new ArrayBuffer(32), 'signal-msg-encrypt', 44);
  const keyBytes = derived.slice(0, 32);
  const nonce = derived.slice(32, 44);
  const aesKey = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'AES-GCM', length: 256 }, false, ['decrypt']
  );
  return await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, aesKey, ciphertext);
};

export const concatBuffers = (...buffers: ArrayBuffer[]): ArrayBuffer => {
  const totalLength = buffers.reduce((sum, buf) => sum + buf.byteLength, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const buf of buffers) {
    result.set(new Uint8Array(buf), offset);
    offset += buf.byteLength;
  }
  return result.buffer as ArrayBuffer;
};

export const generateRegistrationId = (): number => {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return arr[0] & 0x3FFF;
};
