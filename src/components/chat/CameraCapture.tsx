// @ts-nocheck
import { useState, useRef, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
const db = supabase as any;
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import {
  Camera,
  Video,
  X,
  SwitchCamera,
  Circle,
  Square,
} from "lucide-react";

interface CameraCaptureProps {
  isOpen: boolean;
  onClose: () => void;
  currentUserId: string;
  mode: "photo" | "video";
  onCapture: () => void;
  onSavingStart?: (id: string, type: "photo" | "video") => void;
  onSavingEnd?: (id: string) => void;
}

export const CameraCapture = ({
  isOpen,
  onClose,
  currentUserId,
  mode,
  onCapture,
  onSavingStart,
  onSavingEnd,
}: CameraCaptureProps) => {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("environment");
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [showCapturedNotification, setShowCapturedNotification] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const { toast } = useToast();

  const startCamera = useCallback(async () => {
    try {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }

      const constraints: MediaStreamConstraints = {
        video: {
          facingMode,
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: mode === "video",
      };

      const newStream = await navigator.mediaDevices.getUserMedia(constraints);
      setStream(newStream);

      if (videoRef.current) {
        videoRef.current.srcObject = newStream;
      }
    } catch (err) {
      console.error("Camera error:", err);
      toast({
        variant: "destructive",
        title: "Lỗi",
        description: "Không thể truy cập camera",
      });
    }
  }, [facingMode, mode, stream, toast]);

  useEffect(() => {
    if (isOpen) {
      startCamera();
    }

    return () => {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && stream && videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [stream, isOpen]);

  const switchCamera = async () => {
    const newFacing = facingMode === "user" ? "environment" : "user";
    setFacingMode(newFacing);

    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }

    try {
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: newFacing,
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: mode === "video",
      };

      const newStream = await navigator.mediaDevices.getUserMedia(constraints);
      setStream(newStream);

      if (videoRef.current) {
        videoRef.current.srcObject = newStream;
      }
    } catch (err) {
      console.error("Switch camera error:", err);
    }
  };

  const saveFileInBackground = async (blob: Blob, fileName: string, fileType: string, storageType: "image" | "video") => {
    const saveId = Date.now().toString();
    onSavingStart?.(saveId, storageType === "image" ? "photo" : "video");
    
    try {
      const file = new File([blob], fileName, { type: fileType });
      const filePath = `${currentUserId}/${Date.now()}.${fileName.split('.').pop()}`;

      const { error: uploadError } = await supabase.storage
        .from("user-storage")
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from("user-storage")
        .getPublicUrl(filePath);

      const { error: insertError } = await supabase
        .from("user_storage")
        .insert({
          user_id: currentUserId,
          file_url: urlData.publicUrl,
          file_name: fileName,
          file_type: fileType,
          file_size: file.size,
          storage_type: storageType,
        });

      if (insertError) throw insertError;

      toast({
        title: "Thành công",
        description: storageType === "image" ? "Đã lưu ảnh vào kho" : "Đã lưu video vào kho",
      });

      onCapture();
    } catch (err) {
      console.error("Save error:", err);
      toast({
        variant: "destructive",
        title: "Lỗi",
        description: "Không thể lưu file",
      });
    } finally {
      onSavingEnd?.(saveId);
    }
  };

  const capturePhoto = async () => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext("2d");
    if (ctx) {
      // For front camera: video is displayed mirrored (scaleX(-1)), 
      // so we need to draw it mirrored too for the saved image to look correct
      if (facingMode === "user") {
        ctx.save();
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(video, 0, 0);
        ctx.restore();
      } else {
        ctx.drawImage(video, 0, 0);
      }
      
      // Show "Đã chụp" notification
      setShowCapturedNotification(true);
      setTimeout(() => setShowCapturedNotification(false), 1500);
      
      canvas.toBlob(
        (blob) => {
          if (blob) {
            const fileName = `photo_${Date.now()}.jpg`;
            // Save in background without blocking UI
            saveFileInBackground(blob, fileName, "image/jpeg", "image");
          }
        },
        "image/jpeg",
        0.95
      );
    }
  };

  const startRecording = () => {
    if (!stream) return;

    recordedChunksRef.current = [];
    setRecordingTime(0);

    const options = { mimeType: "video/webm;codecs=vp9,opus" };
    let mediaRecorder: MediaRecorder;

    try {
      mediaRecorder = new MediaRecorder(stream, options);
    } catch {
      try {
        mediaRecorder = new MediaRecorder(stream, { mimeType: "video/webm" });
      } catch {
        mediaRecorder = new MediaRecorder(stream);
      }
    }

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        recordedChunksRef.current.push(event.data);
      }
    };

    mediaRecorder.onstop = async () => {
      const blob = new Blob(recordedChunksRef.current, { type: "video/webm" });
      const fileName = `video_${Date.now()}.webm`;
      // Save in background without blocking UI
      saveFileInBackground(blob, fileName, "video/webm", "video");
    };

    mediaRecorderRef.current = mediaRecorder;
    mediaRecorder.start(100);
    setIsRecording(true);

    recordingTimerRef.current = setInterval(() => {
      setRecordingTime((prev) => prev + 1);
    }, 1000);
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);

      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const handleClose = () => {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }
    setStream(null);
    setRecordingTime(0);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent
        className="max-w-full h-[100dvh] p-0 bg-black border-none overflow-hidden"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <div className="relative w-full h-full flex flex-col">
          {/* Close button */}
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-4 right-4 z-50 text-white hover:bg-white/20"
            onClick={handleClose}
          >
            <X className="w-6 h-6" />
          </Button>

          {/* "Đã chụp" Notification */}
          {showCapturedNotification && (
            <div className="absolute top-16 left-1/2 -translate-x-1/2 z-50 animate-fade-in">
              <div className="bg-green-500/90 text-white px-4 py-2 rounded-full text-sm font-medium shadow-lg">
                ✓ Đã chụp
              </div>
            </div>
          )}

          {/* Mode indicator */}
          <div className="absolute top-4 left-4 z-50 flex items-center gap-2 text-white">
            {mode === "photo" ? (
              <Camera className="w-5 h-5" />
            ) : (
              <Video className="w-5 h-5" />
            )}
            <span className="font-medium">
              {mode === "photo" ? "Chụp ảnh" : "Quay video"}
            </span>
            {isRecording && (
              <span className="ml-2 px-2 py-1 bg-red-500 rounded-full text-sm animate-pulse">
                {formatTime(recordingTime)}
              </span>
            )}
          </div>

          {/* Camera preview */}
          <div className="flex-1 flex items-center justify-center bg-black">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
              style={{
                transform: facingMode === "user" ? "scaleX(-1)" : "none",
              }}
            />
          </div>

          {/* Canvas for photo capture */}
          <canvas ref={canvasRef} className="hidden" />

          {/* Controls */}
          <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-black/80 to-transparent">
            <div className="flex items-center justify-center gap-8">
              <Button
                variant="ghost"
                size="icon"
                className="w-12 h-12 rounded-full bg-white/20 text-white hover:bg-white/30"
                onClick={switchCamera}
                disabled={isRecording}
              >
                <SwitchCamera className="w-6 h-6" />
              </Button>

              {mode === "photo" ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="w-20 h-20 rounded-full bg-white border-4 border-white/50 hover:bg-white/90"
                  onClick={capturePhoto}
                >
                  <Circle className="w-16 h-16 text-black" />
                </Button>
              ) : isRecording ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="w-20 h-20 rounded-full bg-red-500 hover:bg-red-600"
                  onClick={stopRecording}
                >
                  <Square className="w-10 h-10 text-white fill-white" />
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="icon"
                  className="w-20 h-20 rounded-full bg-red-500 hover:bg-red-600"
                  onClick={startRecording}
                >
                  <Circle className="w-16 h-16 text-white fill-red-500" />
                </Button>
              )}

              <div className="w-12 h-12" /> {/* Spacer */}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
