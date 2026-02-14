import { useState, useEffect, useCallback, useRef } from 'react';
import { SignalProtocol } from '@/lib/crypto/protocol';

interface UseSignalProtocolOptions {
  userId: string | null;
  conversationId: string | null;
  remoteUserId: string | null;
  enabled?: boolean;
}

interface UseSignalProtocolReturn {
  isReady: boolean;
  isInitializing: boolean;
  encrypt: (message: string) => Promise<string>;
  decrypt: (message: string) => Promise<string>;
  safetyNumber: string;
  isSignalMessage: (content: string) => boolean;
}

let protocolInstance: SignalProtocol | null = null;
let protocolUserId: string | null = null;

export function useSignalProtocol({
  userId,
  conversationId,
  remoteUserId,
  enabled = true,
}: UseSignalProtocolOptions): UseSignalProtocolReturn {
  const [isReady, setIsReady] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [safetyNumber, setSafetyNumber] = useState('');
  const initRef = useRef(false);

  useEffect(() => {
    if (!userId || !enabled) return;

    // Don't re-init if already done for this user
    if (initRef.current && protocolUserId === userId && protocolInstance?.isInitialized()) {
      setIsReady(true);
      return;
    }

    let cancelled = false;
    const init = async () => {
      try {
        setIsInitializing(true);
        if (!protocolInstance || protocolUserId !== userId) {
          protocolInstance = new SignalProtocol(userId);
          protocolUserId = userId;
        }
        await protocolInstance.initialize();
        if (!cancelled) {
          initRef.current = true;
          setIsReady(true);
        }
      } catch (error) {
        console.error('Failed to initialize Signal protocol:', error);
      } finally {
        if (!cancelled) setIsInitializing(false);
      }
    };

    init();
    return () => { cancelled = true; };
  }, [userId, enabled]);

  // Get safety number when conversation changes
  useEffect(() => {
    if (!isReady || !remoteUserId || !protocolInstance) return;
    protocolInstance.getSafetyNumber(remoteUserId).then(setSafetyNumber).catch(() => {});
  }, [isReady, remoteUserId]);

  const encrypt = useCallback(async (message: string): Promise<string> => {
    if (!protocolInstance || !isReady || !conversationId || !remoteUserId) return message;
    try {
      return await protocolInstance.encryptMessage(conversationId, remoteUserId, message);
    } catch (error) {
      console.error('Signal encrypt failed:', error);
      return message;
    }
  }, [isReady, conversationId, remoteUserId]);

  const decrypt = useCallback(async (message: string): Promise<string> => {
    if (!protocolInstance || !isReady || !conversationId || !remoteUserId) return message;
    try {
      return await protocolInstance.decryptMessage(conversationId, remoteUserId, message);
    } catch (error) {
      console.error('Signal decrypt failed:', error);
      return '[Không thể giải mã]';
    }
  }, [isReady, conversationId, remoteUserId]);

  const isSignalMessage = useCallback((content: string): boolean => {
    if (!content) return false;
    try {
      const parsed = JSON.parse(content);
      return parsed.v === 2 && !!parsed.header && !!parsed.ciphertext;
    } catch {
      return false;
    }
  }, []);

  return { isReady, isInitializing, encrypt, decrypt, safetyNumber, isSignalMessage };
}
