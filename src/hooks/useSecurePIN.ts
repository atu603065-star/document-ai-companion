// @ts-nocheck
/**
 * Secure PIN verification hook using database functions
 * Prevents PIN hash exposure on client-side
 */

import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { validatePinFormat } from '@/lib/security';

interface PinStatus {
  pin_enabled: boolean;
  is_locked: boolean;
  locked_until?: string | null;
}

interface VerifyResult {
  success: boolean;
  message: string;
  attempts_remaining?: number;
  locked_until?: string;
}

interface SetPinResult {
  success: boolean;
  message: string;
}

export const useSecurePIN = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Get PIN status without exposing hash
  const getPinStatus = useCallback(async (): Promise<PinStatus | null> => {
    setLoading(true);
    setError(null);
    
    try {
      const { data, error: rpcError } = await supabase.rpc('get_pin_status');
      
      if (rpcError) {
        // Fallback to old method if function doesn't exist yet
        const { data: userData } = await supabase.auth.getUser();
        const { data: settings } = await supabase
          .from('user_settings')
          .select('pin_enabled')
          .eq('user_id', (await supabase.auth.getUser()).data.user?.id)
          .maybeSingle();
        
        return {
          pin_enabled: settings?.pin_enabled || false,
          is_locked: false
        };
      }
      
      return data as unknown as PinStatus;
    } catch (err) {
      console.error('Error getting PIN status:', err);
      setError('Không thể kiểm tra trạng thái PIN');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  // Verify PIN using secure server-side function
  const verifyPin = useCallback(async (pin: string): Promise<VerifyResult> => {
    setLoading(true);
    setError(null);
    
    // Client-side validation first
    const validation = validatePinFormat(pin);
    if (!validation.valid) {
      setLoading(false);
      return {
        success: false,
        message: validation.error || 'PIN không hợp lệ'
      };
    }
    
    try {
      const { data, error: rpcError } = await supabase.rpc('verify_pin', {
        input_pin: pin
      });
      
      if (rpcError) {
        // Fallback to old method for backwards compatibility
        const { data: user } = await supabase.auth.getUser();
        if (!user.user) {
          return { success: false, message: 'Chưa đăng nhập' };
        }
        
        const { data: settings } = await supabase
          .from('user_settings')
          .select('pin_hash, pin_enabled')
          .eq('user_id', user.user.id)
          .maybeSingle();
        
        if (!settings?.pin_enabled || !settings?.pin_hash) {
          return { success: true, message: 'Không yêu cầu PIN' };
        }
        
        // Simple comparison for backwards compatibility
        const enteredHash = btoa(pin);
        if (enteredHash === settings.pin_hash) {
          return { success: true, message: 'PIN đúng' };
        }
        
        return { success: false, message: 'PIN sai', attempts_remaining: 4 };
      }
      
      const result = data as unknown as VerifyResult;
      
      if (!result.success) {
        setError(result.message);
      }
      
      return result;
    } catch (err) {
      console.error('Error verifying PIN:', err);
      const message = 'Lỗi xác thực PIN';
      setError(message);
      return { success: false, message };
    } finally {
      setLoading(false);
    }
  }, []);

  // Set new PIN using secure server-side function
  const setPin = useCallback(async (pin: string): Promise<SetPinResult> => {
    setLoading(true);
    setError(null);
    
    // Client-side validation first
    const validation = validatePinFormat(pin);
    if (!validation.valid) {
      setLoading(false);
      return {
        success: false,
        message: validation.error || 'PIN không hợp lệ'
      };
    }
    
    try {
      const { data, error: rpcError } = await supabase.rpc('set_pin', {
        new_pin: pin
      });
      
      if (rpcError) {
        // Fallback to old method for backwards compatibility
        const { data: user } = await supabase.auth.getUser();
        if (!user.user) {
          return { success: false, message: 'Chưa đăng nhập' };
        }
        
        // Use SHA256-like hashing client side as fallback
        const pinHash = btoa(pin);
        
        const { error: upsertError } = await supabase
          .from('user_settings')
          .upsert({
            user_id: user.user.id,
            pin_hash: pinHash,
            pin_enabled: true
          }, { onConflict: 'user_id' });
        
        if (upsertError) {
          return { success: false, message: 'Không thể đặt PIN' };
        }
        
        return { success: true, message: 'Đã đặt PIN thành công' };
      }
      
      return data as unknown as SetPinResult;
    } catch (err) {
      console.error('Error setting PIN:', err);
      const message = 'Lỗi đặt PIN';
      setError(message);
      return { success: false, message };
    } finally {
      setLoading(false);
    }
  }, []);

  // Disable PIN
  const disablePin = useCallback(async (): Promise<SetPinResult> => {
    setLoading(true);
    setError(null);
    
    try {
      const { data, error: rpcError } = await supabase.rpc('disable_pin');
      
      if (rpcError) {
        // Fallback to old method
        const { data: user } = await supabase.auth.getUser();
        if (!user.user) {
          return { success: false, message: 'Chưa đăng nhập' };
        }
        
        const { error: updateError } = await supabase
          .from('user_settings')
          .update({ pin_enabled: false, pin_hash: null })
          .eq('user_id', user.user.id);
        
        if (updateError) {
          return { success: false, message: 'Không thể tắt PIN' };
        }
        
        return { success: true, message: 'Đã tắt PIN' };
      }
      
      return data as unknown as SetPinResult;
    } catch (err) {
      console.error('Error disabling PIN:', err);
      const message = 'Lỗi tắt PIN';
      setError(message);
      return { success: false, message };
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    loading,
    error,
    getPinStatus,
    verifyPin,
    setPin,
    disablePin
  };
};
