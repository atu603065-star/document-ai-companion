import { useRef, useCallback, useEffect } from "react";

export const useCallRingtone = () => {
  const audioContextRef = useRef<AudioContext | null>(null);
  const oscillatorRef = useRef<OscillatorNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const isPlayingRef = useRef(false);

  const createAudioContext = () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return audioContextRef.current;
  };

  // Play caller ringtone (continuous beeping - "đang gọi")
  const playCallerRingtone = useCallback(() => {
    if (isPlayingRef.current) return;
    isPlayingRef.current = true;

    const playBeep = () => {
      const audioContext = createAudioContext();
      
      if (audioContext.state === "suspended") {
        audioContext.resume();
      }

      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();

      oscillator.connect(gain);
      gain.connect(audioContext.destination);

      // Caller tone - lower pitched beeping
      oscillator.frequency.value = 440; // A4
      oscillator.type = "sine";
      
      const now = audioContext.currentTime;
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.4);

      oscillator.start(now);
      oscillator.stop(now + 0.4);
    };

    // Play beep every 2 seconds
    playBeep();
    intervalRef.current = setInterval(() => {
      if (isPlayingRef.current) {
        playBeep();
      }
    }, 2000);
  }, []);

  // Play receiver ringtone (more urgent - "có người gọi đến")
  const playReceiverRingtone = useCallback(() => {
    if (isPlayingRef.current) return;
    isPlayingRef.current = true;

    const playRing = () => {
      const audioContext = createAudioContext();
      
      if (audioContext.state === "suspended") {
        audioContext.resume();
      }

      const now = audioContext.currentTime;

      // Double ring pattern
      [0, 0.15].forEach((offset) => {
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();

        oscillator.connect(gain);
        gain.connect(audioContext.destination);

        // Higher pitched for incoming call
        oscillator.frequency.value = 880; // A5
        oscillator.type = "sine";
        
        gain.gain.setValueAtTime(0.2, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.01, now + offset + 0.12);

        oscillator.start(now + offset);
        oscillator.stop(now + offset + 0.12);
      });
    };

    // Play ring every 1.5 seconds
    playRing();
    intervalRef.current = setInterval(() => {
      if (isPlayingRef.current) {
        playRing();
      }
    }, 1500);
  }, []);

  // Stop all ringtones
  const stopRingtone = useCallback(() => {
    isPlayingRef.current = false;

    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (oscillatorRef.current) {
      try {
        oscillatorRef.current.stop();
      } catch (e) {
        // Ignore if already stopped
      }
      oscillatorRef.current = null;
    }

    if (gainRef.current) {
      gainRef.current.disconnect();
      gainRef.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopRingtone();
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
    };
  }, [stopRingtone]);

  return {
    playCallerRingtone,
    playReceiverRingtone,
    stopRingtone,
  };
};
