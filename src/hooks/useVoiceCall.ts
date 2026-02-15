// @ts-nocheck
import { useState, useRef, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useCallRingtone } from "./useCallRingtone";

interface CallState {
  isInCall: boolean;
  isCalling: boolean;
  isReceivingCall: boolean;
  callerId: string | null;
  calleeId: string | null;
  conversationId: string | null;
  callerName?: string;
}

interface SignalData {
  type: "offer" | "answer" | "ice-candidate" | "call-request" | "call-accepted" | "call-rejected" | "call-ended";
  data: any;
  from: string;
  to: string;
  conversationId: string;
  callerName?: string;
}

export type CallEndReason = "completed" | "rejected" | "missed" | "cancelled";

export const useVoiceCall = (currentUserId: string | undefined) => {
  const [callState, setCallState] = useState<CallState>({
    isInCall: false,
    isCalling: false,
    isReceivingCall: false,
    callerId: null,
    calleeId: null,
    conversationId: null,
    callerName: undefined,
  });
  const [isMuted, setIsMuted] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  
  const { playCallerRingtone, playReceiverRingtone, stopRingtone } = useCallRingtone();

  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const callTimerRef = useRef<NodeJS.Timeout | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const callStartTimeRef = useRef<number | null>(null);
  const { toast } = useToast();

  // ICE servers configuration
  const iceServers = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      { urls: "stun:stun2.l.google.com:19302" },
    ],
  };

  // Create audio element for remote stream
  useEffect(() => {
    if (!remoteAudioRef.current) {
      remoteAudioRef.current = document.createElement("audio");
      remoteAudioRef.current.autoplay = true;
      (remoteAudioRef.current as any).playsInline = true;
    }
    return () => {
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = null;
      }
    };
  }, []);

  // Subscribe to call signals
  useEffect(() => {
    if (!currentUserId) return;

    const channel = supabase.channel(`calls:${currentUserId}`);
    channelRef.current = channel;

    channel
      .on("broadcast", { event: "signal" }, async ({ payload }) => {
        const signal = payload as SignalData;
        if (signal.to !== currentUserId) return;

        console.log("Received signal:", signal.type);

        switch (signal.type) {
          case "call-request":
            setCallState({
              isInCall: false,
              isCalling: false,
              isReceivingCall: true,
              callerId: signal.from,
              calleeId: currentUserId,
              conversationId: signal.conversationId,
              callerName: signal.callerName,
            });
            // Play receiver ringtone
            playReceiverRingtone();
            break;

          case "call-accepted":
            stopRingtone();
            await handleCallAccepted(signal);
            break;

          case "call-rejected":
            stopRingtone();
            handleCallRejectedRef.current?.();
            break;

          case "call-ended":
            stopRingtone();
            handleCallEndedRef.current?.();
            break;

          case "offer":
            await handleOffer(signal);
            break;

          case "answer":
            await handleAnswer(signal);
            break;

          case "ice-candidate":
            await handleIceCandidate(signal);
            break;
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUserId]);

  const sendSignal = useCallback(
    async (type: SignalData["type"], to: string, conversationId: string, data?: any) => {
      if (!currentUserId) return;

      const targetChannel = supabase.channel(`calls:${to}`);
      await targetChannel.subscribe();
      
      await targetChannel.send({
        type: "broadcast",
        event: "signal",
        payload: {
          type,
          data,
          from: currentUserId,
          to,
          conversationId,
        },
      });

      await supabase.removeChannel(targetChannel);
    },
    [currentUserId]
  );

  const createPeerConnection = useCallback(
    (targetUserId: string, conversationId: string) => {
      const pc = new RTCPeerConnection(iceServers);

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          sendSignal("ice-candidate", targetUserId, conversationId, event.candidate);
        }
      };

      pc.ontrack = (event) => {
        console.log("Received remote track");
        if (remoteAudioRef.current && event.streams[0]) {
          remoteAudioRef.current.srcObject = event.streams[0];
        }
      };

      pc.onconnectionstatechange = () => {
        console.log("Connection state:", pc.connectionState);
        if (pc.connectionState === "connected") {
          startCallTimer();
        } else if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
          endCall();
        }
      };

      peerConnectionRef.current = pc;
      return pc;
    },
    [sendSignal]
  );

  const startCallTimer = () => {
    if (callTimerRef.current) clearInterval(callTimerRef.current);
    setCallDuration(0);
    callTimerRef.current = setInterval(() => {
      setCallDuration((prev) => prev + 1);
    }, 1000);
  };

  const stopCallTimer = () => {
    if (callTimerRef.current) {
      clearInterval(callTimerRef.current);
      callTimerRef.current = null;
    }
    setCallDuration(0);
  };

  // Save call message to database
  const saveCallMessage = useCallback(async (
    conversationId: string, 
    senderId: string, 
    callType: "outgoing" | "incoming",
    status: "completed" | "rejected" | "missed" | "cancelled",
    duration?: number
  ) => {
    const durationStr = duration && duration > 0 ? formatDuration(duration) : undefined;
    let content = "";
    
    if (callType === "outgoing") {
      if (status === "completed") {
        content = durationStr ? `Cuộc gọi đi - ${durationStr}` : "Cuộc gọi đi";
      } else if (status === "cancelled") {
        content = "Cuộc gọi đi - Đã hủy";
      } else if (status === "rejected") {
        content = "Cuộc gọi đi - Bị từ chối";
      } else {
        content = "Cuộc gọi đi - Không trả lời";
      }
    } else {
      if (status === "completed") {
        content = durationStr ? `Cuộc gọi đến - ${durationStr}` : "Cuộc gọi đến";
      } else if (status === "rejected") {
        content = "Cuộc gọi đến - Đã từ chối";
      } else {
        content = "Cuộc gọi nhỡ";
      }
    }

    try {
      await supabase.from("messages").insert({
        conversation_id: conversationId,
        sender_id: senderId,
        content,
        type: "call",
      });
    } catch (err) {
      console.error("Error saving call message:", err);
    }
  }, []);

  const startCall = useCallback(
    async (calleeId: string, conversationId: string, callerName?: string) => {
      if (!currentUserId) return;

      try {
        // Request microphone access
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        localStreamRef.current = stream;
        callStartTimeRef.current = Date.now();

        setCallState({
          isInCall: false,
          isCalling: true,
          isReceivingCall: false,
          callerId: currentUserId,
          calleeId,
          conversationId,
        });

        // Play caller ringtone
        playCallerRingtone();

        // Send call request with caller name
        const targetChannel = supabase.channel(`calls:${calleeId}`);
        await targetChannel.subscribe();
        
        await targetChannel.send({
          type: "broadcast",
          event: "signal",
          payload: {
            type: "call-request",
            data: null,
            from: currentUserId,
            to: calleeId,
            conversationId,
            callerName,
          },
        });

        await supabase.removeChannel(targetChannel);

        toast({
          title: "Đang gọi...",
          description: "Chờ người kia trả lời",
        });
      } catch (err) {
        console.error("Error starting call:", err);
        toast({
          variant: "destructive",
          title: "Lỗi",
          description: "Không thể truy cập microphone",
        });
      }
    },
    [currentUserId, toast, playCallerRingtone]
  );

  const acceptCall = useCallback(async () => {
    if (!callState.callerId || !callState.conversationId || !currentUserId) return;

    // Stop receiver ringtone
    stopRingtone();
    callStartTimeRef.current = Date.now();

    try {
      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      localStreamRef.current = stream;

      setCallState((prev) => ({
        ...prev,
        isInCall: true,
        isReceivingCall: false,
      }));

      // Send acceptance
      await sendSignal("call-accepted", callState.callerId, callState.conversationId);
    } catch (err) {
      console.error("Error accepting call:", err);
      toast({
        variant: "destructive",
        title: "Lỗi",
        description: "Không thể truy cập microphone",
      });
      rejectCall();
    }
  }, [callState.callerId, callState.conversationId, currentUserId, sendSignal, toast, stopRingtone]);

  const rejectCall = useCallback(async () => {
    if (!callState.callerId || !callState.conversationId || !currentUserId) return;

    stopRingtone();

    await sendSignal("call-rejected", callState.callerId, callState.conversationId);

    setCallState({
      isInCall: false,
      isCalling: false,
      isReceivingCall: false,
      callerId: null,
      calleeId: null,
      conversationId: null,
    });
  }, [callState.callerId, callState.conversationId, currentUserId, sendSignal, stopRingtone]);

  const handleCallAccepted = async (signal: SignalData) => {
    if (!localStreamRef.current) return;

    setCallState((prev) => ({
      ...prev,
      isInCall: true,
      isCalling: false,
    }));

    const pc = createPeerConnection(signal.from, signal.conversationId);

    // Add local stream tracks
    localStreamRef.current.getTracks().forEach((track) => {
      pc.addTrack(track, localStreamRef.current!);
    });

    // Create and send offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await sendSignal("offer", signal.from, signal.conversationId, offer);
  };

  const handleCallRejectedRef = useRef<(() => void) | null>(null);
  const handleCallEndedRef = useRef<(() => void) | null>(null);

  const handleOffer = async (signal: SignalData) => {
    if (!localStreamRef.current) return;

    const pc = createPeerConnection(signal.from, signal.conversationId);

    // Add local stream tracks
    localStreamRef.current.getTracks().forEach((track) => {
      pc.addTrack(track, localStreamRef.current!);
    });

    await pc.setRemoteDescription(new RTCSessionDescription(signal.data));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await sendSignal("answer", signal.from, signal.conversationId, answer);
  };

  const handleAnswer = async (signal: SignalData) => {
    if (!peerConnectionRef.current) return;
    await peerConnectionRef.current.setRemoteDescription(
      new RTCSessionDescription(signal.data)
    );
  };

  const handleIceCandidate = async (signal: SignalData) => {
    if (!peerConnectionRef.current) return;
    try {
      await peerConnectionRef.current.addIceCandidate(
        new RTCIceCandidate(signal.data)
      );
    } catch (err) {
      console.error("Error adding ICE candidate:", err);
    }
  };

  const cleanupCall = useCallback(() => {
    // Stop local stream
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }

    // Close peer connection
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    // Clear remote audio
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }

    stopCallTimer();
    setIsMuted(false);

    setCallState({
      isInCall: false,
      isCalling: false,
      isReceivingCall: false,
      callerId: null,
      calleeId: null,
      conversationId: null,
    });
  }, []);

  // Define handleCallRejected after cleanupCall
  const handleCallRejected = useCallback(async () => {
    const conversationId = callState.conversationId;
    
    // Caller saves the call message when rejected
    if (currentUserId && conversationId) {
      await saveCallMessage(conversationId, currentUserId, "outgoing", "rejected");
    }
    
    cleanupCall();
    toast({
      title: "Cuộc gọi bị từ chối",
      description: "Người kia không muốn trả lời",
    });
  }, [callState.conversationId, currentUserId, cleanupCall, toast, saveCallMessage]);

  const handleCallEnded = useCallback(() => {
    cleanupCall();
    toast({
      title: "Cuộc gọi đã kết thúc",
    });
  }, [cleanupCall, toast]);

  // Update refs
  useEffect(() => {
    handleCallRejectedRef.current = handleCallRejected;
    handleCallEndedRef.current = handleCallEnded;
  }, [handleCallRejected, handleCallEnded]);

  const endCall = useCallback(async () => {
    const targetId =
      callState.callerId === currentUserId
        ? callState.calleeId
        : callState.callerId;

    const wasInCall = callState.isInCall;
    const wasCalling = callState.isCalling;
    const conversationId = callState.conversationId;

    stopRingtone();

    if (targetId && conversationId) {
      await sendSignal("call-ended", targetId, conversationId);

      // Save call message
      if (currentUserId && conversationId) {
        if (wasInCall) {
          // Call was completed
          const duration = callStartTimeRef.current 
            ? Math.floor((Date.now() - callStartTimeRef.current) / 1000)
            : callDuration;
          await saveCallMessage(conversationId, currentUserId, "outgoing", "completed", duration);
        } else if (wasCalling) {
          // Caller cancelled the call
          await saveCallMessage(conversationId, currentUserId, "outgoing", "cancelled");
        }
      }
    }

    callStartTimeRef.current = null;
    cleanupCall();
  }, [callState, currentUserId, sendSignal, cleanupCall, stopRingtone, saveCallMessage, callDuration]);

  const toggleMute = useCallback(() => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
  }, []);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  return {
    callState,
    isMuted,
    callDuration,
    formatDuration,
    startCall,
    acceptCall,
    rejectCall,
    endCall,
    toggleMute,
  };
};
