import { useState, useCallback, useEffect } from 'react';
import {
  isEncryptionSupported,
  generateConversationKey,
  encryptForConversation,
  decryptForConversation,
  isEncryptedMessage,
  getConversationKey,
  storeConversationKey,
  clearAllEncryptionKeys,
} from '@/lib/encryption';

interface UseE2EEncryptionOptions {
  conversationId: string | null;
  enabled?: boolean;
}

interface UseE2EEncryptionReturn {
  isSupported: boolean;
  isEnabled: boolean;
  isReady: boolean;
  encryptMessage: (message: string) => Promise<string>;
  decryptMessage: (encryptedMessage: string) => Promise<string>;
  initializeEncryption: () => Promise<string | null>;
  setSharedKey: (keyBase64: string) => void;
  clearKeys: () => void;
}

export const useE2EEncryption = ({
  conversationId,
  enabled = true,
}: UseE2EEncryptionOptions): UseE2EEncryptionReturn => {
  const [isSupported] = useState(() => isEncryptionSupported());
  const [currentKey, setCurrentKey] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);

  // Load existing key for conversation
  useEffect(() => {
    if (!conversationId || !enabled || !isSupported) {
      setCurrentKey(null);
      setIsReady(false);
      return;
    }

    const storedKey = getConversationKey(conversationId);
    if (storedKey) {
      setCurrentKey(storedKey);
      setIsReady(true);
    } else {
      setIsReady(false);
    }
  }, [conversationId, enabled, isSupported]);

  // Initialize encryption for a conversation (generate new key)
  const initializeEncryption = useCallback(async (): Promise<string | null> => {
    if (!conversationId || !isSupported) return null;

    try {
      const { keyBase64 } = await generateConversationKey();
      storeConversationKey(conversationId, keyBase64);
      setCurrentKey(keyBase64);
      setIsReady(true);
      return keyBase64;
    } catch (error) {
      console.error('Failed to initialize encryption:', error);
      return null;
    }
  }, [conversationId, isSupported]);

  // Set a shared key (received from another user)
  const setSharedKey = useCallback(
    (keyBase64: string) => {
      if (!conversationId) return;
      storeConversationKey(conversationId, keyBase64);
      setCurrentKey(keyBase64);
      setIsReady(true);
    },
    [conversationId]
  );

  // Encrypt a message
  const encryptMessage = useCallback(
    async (message: string): Promise<string> => {
      if (!enabled || !isSupported || !currentKey) {
        return message;
      }

      try {
        return await encryptForConversation(message, currentKey);
      } catch (error) {
        console.error('Encryption failed:', error);
        return message;
      }
    },
    [enabled, isSupported, currentKey]
  );

  // Decrypt a message
  const decryptMessage = useCallback(
    async (encryptedMessage: string): Promise<string> => {
      if (!enabled || !isSupported || !currentKey) {
        return encryptedMessage;
      }

      // Check if message is actually encrypted
      if (!isEncryptedMessage(encryptedMessage)) {
        return encryptedMessage;
      }

      try {
        return await decryptForConversation(encryptedMessage, currentKey);
      } catch (error) {
        console.error('Decryption failed:', error);
        return '[Không thể giải mã tin nhắn]';
      }
    },
    [enabled, isSupported, currentKey]
  );

  // Clear all encryption keys
  const clearKeys = useCallback(() => {
    clearAllEncryptionKeys();
    setCurrentKey(null);
    setIsReady(false);
  }, []);

  return {
    isSupported,
    isEnabled: enabled && isSupported && !!currentKey,
    isReady,
    encryptMessage,
    decryptMessage,
    initializeEncryption,
    setSharedKey,
    clearKeys,
  };
};
