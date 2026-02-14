import { useState, useEffect, useRef } from "react";
import { X, Download, Play, Pause, Volume2, VolumeX, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

interface VideoViewerProps {
  isOpen: boolean;
  videoUrl: string;
  videoName?: string;
  onClose: () => void;
}

export const VideoViewer = ({
  isOpen,
  videoUrl,
  videoName = "video",
  onClose,
}: VideoViewerProps) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
      setIsLoading(true);
      setIsPlaying(false);
      setCurrentTime(0);
    } else {
      document.body.style.overflow = "";
    }

    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen, videoUrl]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === "Escape") onClose();
      if (e.key === " ") {
        e.preventDefault();
        togglePlay();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const toggleMute = () => {
    if (videoRef.current) {
      videoRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
      setIsLoading(false);
    }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (videoRef.current && duration > 0) {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const percent = x / rect.width;
      videoRef.current.currentTime = percent * duration;
    }
  };

  const handleDownload = async () => {
    try {
      setDownloadProgress(0);

      const xhr = new XMLHttpRequest();
      xhr.open("GET", videoUrl, true);
      xhr.responseType = "blob";

      xhr.onprogress = (event) => {
        if (event.lengthComputable) {
          const progress = Math.round((event.loaded / event.total) * 100);
          setDownloadProgress(progress);
        }
      };

      xhr.onload = () => {
        if (xhr.status === 200) {
          const blob = xhr.response;
          const url = window.URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = videoName;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          window.URL.revokeObjectURL(url);
        }
        setDownloadProgress(null);
      };

      xhr.onerror = () => {
        window.open(videoUrl, "_blank");
        setDownloadProgress(null);
      };

      xhr.send();
    } catch {
      window.open(videoUrl, "_blank");
      setDownloadProgress(null);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] bg-background/95 backdrop-blur-sm flex flex-col"
      onClick={onClose}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between p-4 border-b border-border"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="text-foreground font-medium truncate max-w-[200px]">
          {videoName}
        </span>
        <div className="flex items-center gap-2">
          {downloadProgress !== null ? (
            <div className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">{downloadProgress}%</span>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              onClick={handleDownload}
              className="text-muted-foreground hover:text-foreground"
            >
              <Download className="w-5 h-5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="w-5 h-5" />
          </Button>
        </div>
      </div>

      {/* Video Container */}
      <div
        className="flex-1 flex items-center justify-center overflow-hidden p-4"
        onClick={(e) => e.stopPropagation()}
      >
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        <video
          ref={videoRef}
          src={videoUrl}
          className={`max-w-full max-h-full object-contain ${isLoading ? 'opacity-0' : 'opacity-100'}`}
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onEnded={() => setIsPlaying(false)}
          playsInline
          onClick={togglePlay}
        />
      </div>

      {/* Controls */}
      <div
        className="p-4 border-t border-border space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Progress bar */}
        <div
          className="relative h-2 bg-muted rounded-full cursor-pointer"
          onClick={handleSeek}
        >
          <div
            className="absolute h-full bg-primary rounded-full"
            style={{ width: duration > 0 ? `${(currentTime / duration) * 100}%` : '0%' }}
          />
        </div>

        {/* Control buttons */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={togglePlay}>
              {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
            </Button>
            <Button variant="outline" size="icon" onClick={toggleMute}>
              {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
            </Button>
            <span className="text-sm text-muted-foreground">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>
          
          <Button variant="default" onClick={handleDownload} disabled={downloadProgress !== null}>
            {downloadProgress !== null ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {downloadProgress}%
              </>
            ) : (
              <>
                <Download className="w-4 h-4 mr-2" />
                Tải về
              </>
            )}
          </Button>
        </div>

        {/* Download progress */}
        {downloadProgress !== null && (
          <Progress value={downloadProgress} className="h-1" />
        )}
      </div>
    </div>
  );
};
