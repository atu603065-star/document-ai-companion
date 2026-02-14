export interface KeyPairJWK {
  publicKey: JsonWebKey;
  privateKey: JsonWebKey;
}

export interface MessageHeader {
  dh: JsonWebKey;
  pn: number;
  n: number;
}

export interface SignalMessage {
  header: MessageHeader;
  ciphertext: string;
  v: 2;
  x3dh?: {
    identityKey: JsonWebKey;
    ephemeralKey: JsonWebKey;
    oneTimePreKeyId?: number;
  };
}

export interface SerializedSessionState {
  DHs: KeyPairJWK;
  DHr: JsonWebKey | null;
  RK: string;
  CKs: string | null;
  CKr: string | null;
  Ns: number;
  Nr: number;
  PN: number;
  MKSKIPPED: [string, string][];
}

export interface SessionRecord {
  conversationId: string;
  remoteUserId: string;
  state: SerializedSessionState;
  x3dhCompleted: boolean;
  ephemeralPublicKey?: JsonWebKey;
  oneTimePreKeyId?: number;
  createdAt: number;
  updatedAt: number;
}

export interface StoredIdentity {
  userId: string;
  keyPair: KeyPairJWK;
  signingKeyPair: KeyPairJWK;
  registrationId: number;
  createdAt: number;
}

export interface StoredSignedPreKey {
  keyId: number;
  keyPair: KeyPairJWK;
  signature: string;
  timestamp: number;
}

export interface StoredOneTimePreKey {
  keyId: number;
  keyPair: KeyPairJWK;
}

export interface PreKeyBundle {
  identityKey: JsonWebKey;
  signedPreKey: {
    keyId: number;
    publicKey: JsonWebKey;
    signature: string;
  };
  oneTimePreKey?: {
    keyId: number;
    publicKey: JsonWebKey;
  };
}
