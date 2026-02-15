// @ts-nocheck
import { useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

export const useNotificationSound = (userId?: string) => {
  const audioContextRef = useRef<AudioContext | null>(null);

  const playSound = useCallback(async () => {
    try {
      // Check user settings
      if (userId) {
        const { data } = await supabase
          .from("user_settings")
          .select("sound_enabled")
          .eq("user_id", userId)
          .maybeSingle();

        if (data?.sound_enabled === false) return;
      }

      // Create or resume audio context
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }

      const audioContext = audioContextRef.current;
      
      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }

      // Create a pleasant notification sound
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      // Pleasant chime sound - two notes
      const now = audioContext.currentTime;
      
      oscillator.frequency.setValueAtTime(880, now); // A5
      oscillator.frequency.setValueAtTime(1047, now + 0.1); // C6
      oscillator.type = "sine";
      
      gainNode.gain.setValueAtTime(0.08, now);
      gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.3);

      oscillator.start(now);
      oscillator.stop(now + 0.3);
    } catch (error) {
      console.error("Error playing notification sound:", error);
    }
  }, [userId]);

  return { playSound };
};
