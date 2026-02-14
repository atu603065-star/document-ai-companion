import { useState, memo } from "react";
import { MoreVertical, Download, FileText, Reply, CornerDownRight, Loader2, Phone, PhoneIncoming, PhoneOutgoing, PhoneMissed, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ImageViewer } from "./ImageViewer";
import { VideoViewer } from "./VideoViewer";

interface Message {
  id: string;
  content: string | null;
  file_url: string | null;
  file_name: string | null;
  file_type: string | null;
  sender_id: string;
  created_at: string;
  is_deleted: boolean;
  is_revoked: boolean;
  deleted_for_user_ids: string[];
  type: string;
  reply_to_id?: string | null;
}

interface ReplyToMessage {
  id: string;
  content: string | null;
  sender_id: string;
  file_type: string | null;
}

interface MessageBubbleProps {
  message: Message;
  isOwn: boolean;
  isExpired: boolean;
  isDeletedForMe: boolean;
  currentUserId: string;
  replyToMessage?: ReplyToMessage | null;
  senderName?: string;
  onContextMenu: (e: React.MouseEvent, message: Message) => void;
  onTouchStart: (message: Message) => void;
  onTouchEnd: () => void;
  onRevokeMessage: (message: Message) => void;
  onDeleteForMe: (message: Message) => void;
  onReply: (message: Message) => void;
  onScrollToMessage?: (messageId: string) => void;
}

export const MessageBubble = memo(({
  message,
  isOwn,
  isExpired,
  isDeletedForMe,
  currentUserId,
  replyToMessage,
  senderName,
  onContextMenu,
  onTouchStart,
  onTouchEnd,
  onRevokeMessage,
  onDeleteForMe,
  onReply,
  onScrollToMessage,
}: MessageBubbleProps) => {
  const [showMenu, setShowMenu] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [viewingImage, setViewingImage] = useState<{ url: string; name: string } | null>(null);
  const [viewingVideo, setViewingVideo] = useState<{ url: string; name: string } | null>(null);

  const isImageFile = (type: string | null) => type?.startsWith("image/");

  const handleDownload = async () => {
    if (message.file_url) {
      try {
        setDownloadProgress(0);
        
        const xhr = new XMLHttpRequest();
        xhr.open("GET", message.file_url, true);
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
            link.download = message.file_name || "file";
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);
          }
          setDownloadProgress(null);
        };

        xhr.onerror = () => {
          window.open(message.file_url!, "_blank");
          setDownloadProgress(null);
        };

        xhr.send();
      } catch {
        window.open(message.file_url, "_blank");
        setDownloadProgress(null);
      }
    }
  };

  const handleFileClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (downloadProgress === null) {
      handleDownload();
    }
  };

  const getReplyPreview = () => {
    if (!replyToMessage) return null;
    if (replyToMessage.content) {
      return replyToMessage.content.length > 50
        ? replyToMessage.content.substring(0, 50) + "..."
        : replyToMessage.content;
    }
    if (isImageFile(replyToMessage.file_type)) return "[Hình ảnh]";
    return "[Tệp đính kèm]";
  };

  // System messages
  if (message.type === "system") {
    return (
      <div className="text-center py-2">
        <span className="text-xs text-muted-foreground bg-muted px-3 py-1 rounded-full">
          {message.content}
        </span>
      </div>
    );
  }

  // Call messages
  if (message.type === "call") {
    const content = message.content || "";
    const isMissed = content.includes("nhỡ") || content.includes("Không trả lời");
    const isRejected = content.includes("từ chối") || content.includes("Bị từ chối");
    const isCancelled = content.includes("Đã hủy");
    const isOutgoing = content.includes("Cuộc gọi đi");
    const isIncoming = content.includes("Cuộc gọi đến") || content.includes("Cuộc gọi nhỡ");
    
    let IconComponent = Phone;
    let iconColor = "text-primary";
    
    if (isMissed || isRejected || isCancelled) {
      IconComponent = PhoneMissed;
      iconColor = "text-destructive";
    } else if (isOutgoing) {
      IconComponent = PhoneOutgoing;
      iconColor = "text-green-500";
    } else if (isIncoming) {
      IconComponent = PhoneIncoming;
      iconColor = "text-green-500";
    }

    return (
      <div className={`flex ${isOwn ? "justify-end" : "justify-start"}`}>
        <div
          className={`flex items-center gap-3 px-4 py-3 rounded-xl ${
            isOwn
              ? "bg-primary/10 text-foreground"
              : "bg-muted text-foreground"
          }`}
        >
          <div className={`p-2 rounded-full ${isMissed || isRejected || isCancelled ? "bg-destructive/10" : "bg-green-500/10"}`}>
            <IconComponent className={`w-5 h-5 ${iconColor}`} />
          </div>
          <span className="text-sm font-medium">{content}</span>
        </div>
      </div>
    );
  }

  // Deleted for current user
  if (isDeletedForMe) {
    return (
      <div className={`flex ${isOwn ? "justify-end" : "justify-start"}`}>
        <div
          className={`max-w-[70%] rounded-2xl px-4 py-3 ${
            isOwn
              ? "bg-muted text-muted-foreground rounded-br-md"
              : "bg-muted text-muted-foreground rounded-bl-md"
          }`}
        >
          <p className="italic text-sm">Tin nhắn đã bị xóa</p>
        </div>
      </div>
    );
  }

  // Deleted/Revoked/Expired messages
  if (message.is_deleted || message.is_revoked || isExpired) {
    return (
      <div className={`flex ${isOwn ? "justify-end" : "justify-start"}`}>
        <div
          className={`max-w-[70%] rounded-2xl px-4 py-3 ${
            isOwn
              ? "bg-muted text-muted-foreground rounded-br-md"
              : "bg-muted text-muted-foreground rounded-bl-md"
          }`}
        >
          <p className="italic text-sm">
            {message.is_revoked
              ? "Tin nhắn đã được thu hồi"
              : isExpired
              ? "Tin nhắn đã hết hạn"
              : "Tin nhắn đã bị xóa"}
          </p>
        </div>
      </div>
    );
  }

  // Normal message
  return (
    <div
      id={`message-${message.id}`}
      className={`flex ${isOwn ? "justify-end" : "justify-start"} group`}
      onContextMenu={(e) => onContextMenu(e, message)}
      onTouchStart={() => onTouchStart(message)}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
    >
      {/* 3-dot menu for own messages */}
      {isOwn && (
        <div className="flex items-center mr-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <DropdownMenu open={showMenu} onOpenChange={setShowMenu}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
              >
                <MoreVertical className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="bg-card border-border"
            >
              <DropdownMenuItem
                onClick={() => {
                  onReply(message);
                  setShowMenu(false);
                }}
              >
                <Reply className="w-4 h-4 mr-2" />
                Trả lời
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  onRevokeMessage(message);
                  setShowMenu(false);
                }}
              >
                Thu hồi tin nhắn
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  onDeleteForMe(message);
                  setShowMenu(false);
                }}
              >
                Xóa phía mình
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      <div
        className={`max-w-[70%] rounded-2xl px-4 py-3 overflow-hidden ${
          isOwn
            ? "bg-primary text-primary-foreground rounded-br-md"
            : "bg-card border border-border text-card-foreground rounded-bl-md"
        }`}
      >
        {/* Reply preview */}
        {replyToMessage && (
          <div 
            className={`mb-2 p-2 rounded-lg text-sm cursor-pointer ${
              isOwn ? "bg-primary-foreground/10" : "bg-muted"
            }`}
            onClick={() => onScrollToMessage?.(replyToMessage.id)}
          >
            <div className="flex items-center gap-1 mb-1">
              <CornerDownRight className="w-3 h-3 opacity-70" />
              <span className="font-medium opacity-70">
                {senderName || (replyToMessage.sender_id === currentUserId ? "Bạn" : "Người kia")}
              </span>
            </div>
            <p className="opacity-70 truncate">{getReplyPreview()}</p>
          </div>
        )}

        {message.content && (
          <p className="break-words whitespace-pre-wrap overflow-wrap-anywhere" style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{message.content}</p>
        )}
        {message.file_url && (
          <>
            {isImageFile(message.file_type) ? (
              <div
                className="mt-2 rounded-lg overflow-hidden max-w-xs cursor-pointer"
                onClick={() => {
                  if (!imageError) {
                    setViewingImage({ url: message.file_url!, name: message.file_name || "image" });
                  }
                }}
              >
                {imageError ? (
                  <div className="w-full h-32 bg-muted flex items-center justify-center text-muted-foreground">
                    <FileText className="w-8 h-8 mr-2" />
                    <span className="text-sm">Không thể tải ảnh</span>
                  </div>
                ) : (
                  <img
                    src={message.file_url}
                    alt={message.file_name || "Image"}
                    className="w-full h-auto object-cover hover:opacity-90 transition-opacity"
                    loading="lazy"
                    onError={() => setImageError(true)}
                  />
                )}
              </div>
            ) : message.file_type?.startsWith("video/") ? (
              // Video preview with play button overlay and download
              <div className="mt-2 rounded-lg overflow-hidden max-w-xs">
                <div 
                  className="relative cursor-pointer group/video"
                  onClick={() => setViewingVideo({ url: message.file_url!, name: message.file_name || "video" })}
                >
                  <video
                    src={message.file_url}
                    className="w-full h-auto object-cover"
                    preload="metadata"
                    playsInline
                    muted
                  />
                  {/* Play button overlay */}
                  <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover/video:bg-black/40 transition-colors">
                    <div className="w-12 h-12 rounded-full bg-black/50 flex items-center justify-center">
                      <Play className="w-6 h-6 text-white fill-white" />
                    </div>
                  </div>
                </div>
                <div
                  onClick={handleFileClick}
                  className="mt-1 flex items-center gap-2 p-2 bg-background/50 rounded-lg hover:bg-background/70 transition-colors cursor-pointer"
                >
                  <FileText className="w-4 h-4 text-primary flex-shrink-0" />
                  <span className="text-xs truncate flex-1">
                    {message.file_name}
                  </span>
                  {downloadProgress !== null ? (
                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                  ) : (
                    <Download className="w-4 h-4 text-muted-foreground" />
                  )}
                </div>
                {downloadProgress !== null && (
                  <div className="px-2 pb-2">
                    <Progress value={downloadProgress} className="h-1" />
                    <span className="text-xs text-muted-foreground">{downloadProgress}%</span>
                  </div>
                )}
              </div>
            ) : (
              <div
                onClick={handleFileClick}
                className="mt-2 flex flex-col gap-2 p-3 bg-background/50 rounded-lg hover:bg-background/70 transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <FileText className="w-5 h-5 text-primary flex-shrink-0" />
                  <span className="text-sm truncate flex-1">
                    {message.file_name}
                  </span>
                  {downloadProgress !== null ? (
                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                  ) : (
                    <Download className="w-4 h-4 text-muted-foreground" />
                  )}
                </div>
                {downloadProgress !== null && (
                  <div className="w-full">
                    <Progress value={downloadProgress} className="h-1" />
                    <span className="text-xs text-muted-foreground mt-1">{downloadProgress}%</span>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* 3-dot menu for other's messages */}
      {!isOwn && (
        <div className="flex items-center ml-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
              >
                <MoreVertical className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="bg-card border-border"
            >
              <DropdownMenuItem onClick={() => onReply(message)}>
                <Reply className="w-4 h-4 mr-2" />
                Trả lời
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onDeleteForMe(message)}>
                Xóa phía mình
              </DropdownMenuItem>
              {message.file_url && (
                <DropdownMenuItem onClick={handleDownload}>
                  Tải về
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {/* Image Viewer */}
      <ImageViewer
        isOpen={viewingImage !== null}
        imageUrl={viewingImage?.url || ""}
        imageName={viewingImage?.name}
        onClose={() => setViewingImage(null)}
      />

      {/* Video Viewer */}
      <VideoViewer
        isOpen={viewingVideo !== null}
        videoUrl={viewingVideo?.url || ""}
        videoName={viewingVideo?.name}
        onClose={() => setViewingVideo(null)}
      />
    </div>
  );
});

MessageBubble.displayName = "MessageBubble";
