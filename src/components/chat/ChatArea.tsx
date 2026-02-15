// @ts-nocheck
import { useState, useEffect, useRef, useCallback, useMemo, memo } from "react";
import { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
const db = supabase as any;
import { useToast } from "@/hooks/use-toast";
import { useNotificationSound } from "@/hooks/useNotificationSound";
import { useVoiceCall } from "@/hooks/useVoiceCall";
import { useSignalProtocol } from "@/hooks/useSignalProtocol";
import { useE2EEncryption } from "@/hooks/useE2EEncryption";
import { sanitizeInput, isAllowedFileType } from "@/lib/security";
import { isEncryptedMessage } from "@/lib/encryption";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Conversation } from "@/pages/Chat";
import { MessageContextMenu } from "./MessageContextMenu";
import { ConversationMenu } from "./ConversationMenu";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { MessageBubble } from "./MessageBubble";
import { StorageModal } from "./StorageModal";
import { VoiceCallDialog } from "./VoiceCallDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Send,
  Paperclip,
  Image as ImageIcon,
  FileText,
  Loader2,
  X,
  Shield,
  Lock,
  LockOpen,
  ArrowLeft,
  Phone,
  CornerDownRight,
  Archive,
  Upload,
  FolderOpen,
  Fingerprint,
  Copy,
  Check,
} from "lucide-react";

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

interface UploadingMessage {
  id: string;
  fileName: string;
  fileType: string;
  progress: number;
  content?: string;
}

interface ConversationSettings {
  auto_delete_24h: boolean;
  auto_delete_pending_from: string | null;
}

interface VoiceCallProps {
  callState: {
    isInCall: boolean;
    isCalling: boolean;
    isReceivingCall: boolean;
    callerId: string | null;
    calleeId: string | null;
    conversationId: string | null;
    callerName?: string;
  };
  isMuted: boolean;
  callDuration: number;
  formatDuration: (seconds: number) => string;
  startCall: (calleeId: string, conversationId: string, callerName?: string) => Promise<void>;
  acceptCall: () => Promise<void>;
  rejectCall: () => Promise<void>;
  endCall: () => Promise<void>;
  toggleMute: () => void;
}

interface ChatAreaProps {
  conversation: Conversation;
  currentUser: User;
  onMessageSent: () => void;
  onBack?: () => void;
  showBackButton?: boolean;
  voiceCallProps?: VoiceCallProps;
}

export const ChatArea = ({
  conversation,
  currentUser,
  onMessageSent,
  onBack,
  showBackButton = false,
  voiceCallProps,
}: ChatAreaProps) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [uploadingMessages, setUploadingMessages] = useState<UploadingMessage[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [settings, setSettings] = useState<ConversationSettings>({
    auto_delete_24h: true,
    auto_delete_pending_from: null,
  });
  const [isBlocked, setIsBlocked] = useState(false);
  const [isBlockedByOther, setIsBlockedByOther] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    isOpen: boolean;
    position: { x: number; y: number };
    message: Message | null;
  }>({ isOpen: false, position: { x: 0, y: 0 }, message: null });
  const [longPressTimer, setLongPressTimer] = useState<NodeJS.Timeout | null>(null);
  const [storageOpen, setStorageOpen] = useState(false);
  const [storageSelectMode, setStorageSelectMode] = useState(false);
  // Persist E2E toggle per conversation in localStorage
  const [e2eEnabled, setE2eEnabled] = useState(() => {
    try {
      const stored = localStorage.getItem(`e2e_enabled_${conversation.id}`);
      if (stored !== null) return stored === 'true';
      return false; // Default OFF to avoid broken encryption
    } catch {
      return false;
    }
  });
  const [safetyNumberOpen, setSafetyNumberOpen] = useState(false);
  const [safetyNumberCopied, setSafetyNumberCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { toast } = useToast();
  const { playSound } = useNotificationSound(currentUser.id);
  
  // Signal Protocol hook (primary encryption)
  const {
    isReady: isSignalReady,
    isInitializing: isSignalInitializing,
    encrypt: signalEncrypt,
    decrypt: signalDecrypt,
    safetyNumber,
    isSignalMessage,
  } = useSignalProtocol({
    userId: currentUser.id,
    conversationId: conversation.id,
    remoteUserId: conversation.participant.user_id,
    enabled: e2eEnabled,
  });

  // Legacy E2E Encryption hook (backward compatibility for old messages)
  const {
    isSupported: isE2ESupported,
    isEnabled: isE2EActive,
    isReady: isE2EReady,
    encryptMessage: legacyEncrypt,
    decryptMessage: legacyDecrypt,
    initializeEncryption,
  } = useE2EEncryption({
    conversationId: conversation.id,
    enabled: e2eEnabled,
  });
  
  // Initialize legacy encryption for backward compatibility
  useEffect(() => {
    if (e2eEnabled && isE2ESupported && !isE2EReady) {
      initializeEncryption();
    }
  }, [e2eEnabled, isE2ESupported, isE2EReady, initializeEncryption]);

  // Combined encryption state
  const isEncryptionActive = e2eEnabled && (isSignalReady || isE2EActive);
  // Use voice call props from parent if available, otherwise use local hook
  const localVoiceCall = useVoiceCall(voiceCallProps ? undefined : currentUser.id);
  
  const {
    callState,
    isMuted,
    callDuration,
    formatDuration,
    startCall,
    acceptCall,
    rejectCall,
    endCall,
    toggleMute,
  } = voiceCallProps || localVoiceCall;

  // Get participant name for voice call dialog
  const getParticipantName = () => {
    return conversation.participant.username;
  };

  // Handle voice call button click
  const handleVoiceCall = () => {
    startCall(conversation.participant.user_id, conversation.id, currentProfile?.username);
  };

  // Get current user profile for caller name
  const [currentProfile, setCurrentProfile] = useState<{ username: string } | null>(null);
  
  useEffect(() => {
    const fetchProfile = async () => {
      const { data } = await supabase
        .from("profiles")
        .select("username")
        .eq("user_id", currentUser.id)
        .single();
      if (data) setCurrentProfile(data);
    };
    fetchProfile();
  }, [currentUser.id]);

  // Check if we're in a call with this conversation
  const isCallOpen = callState.conversationId === conversation.id || 
    (callState.isReceivingCall && !!callState.callerId);

  useEffect(() => {
    fetchMessages();
    fetchSettings();

    const channel = supabase
      .channel(`messages:${conversation.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversation.id}`,
        },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const newMsg = payload.new as Message;
            setMessages((prev) => {
              const exists = prev.find((m) => m.id === newMsg.id);
              if (exists) return prev;
              return [...prev, newMsg];
            });
            // Play sound for incoming messages
            if (newMsg.sender_id !== currentUser.id) {
              playSound();
            }
          } else if (payload.eventType === "UPDATE") {
            const updatedMsg = payload.new as Message;
            setMessages((prev) =>
              prev.map((m) => (m.id === updatedMsg.id ? updatedMsg : m))
            );
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversation.id, currentUser.id, playSound]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, uploadingMessages]);

  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: "smooth" });
    }
  };

  const scrollToMessage = (messageId: string) => {
    const element = document.getElementById(`message-${messageId}`);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "center" });
      element.classList.add("bg-primary/10");
      setTimeout(() => element.classList.remove("bg-primary/10"), 2000);
    }
  };

  const fetchMessages = async () => {
    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", conversation.id)
      .order("created_at", { ascending: true });

    if (error) {
      toast({
        variant: "destructive",
        title: "Lỗi",
        description: "Không thể tải tin nhắn",
      });
      return;
    }

    setMessages((data as Message[]) || []);
  };

  const fetchSettings = async () => {
    const { data } = await supabase
      .from("conversation_settings")
      .select("auto_delete_24h, auto_delete_pending_from")
      .eq("conversation_id", conversation.id)
      .maybeSingle();

    if (data) {
      setSettings(data as ConversationSettings);
    }
  };

  // Delete expired messages permanently from database
  const deleteExpiredMessages = useCallback(async () => {
    if (!settings.auto_delete_24h) return;
    
    const now = new Date();
    const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    // Find expired messages in current conversation
    const expiredMessages = messages.filter(m => {
      const msgDate = new Date(m.created_at);
      return msgDate < cutoff && !m.is_deleted && m.type !== 'system';
    });

    if (expiredMessages.length > 0) {
      const expiredIds = expiredMessages.map(m => m.id);
      
      // Permanently DELETE from database
      await supabase
        .from("messages")
        .delete()
        .in("id", expiredIds);

      // Update local state immediately
      setMessages(prev => prev.filter(m => !expiredIds.includes(m.id)));
    }
  }, [settings.auto_delete_24h, messages]);

  // Check and delete expired messages periodically
  useEffect(() => {
    if (settings.auto_delete_24h) {
      // Check immediately when opening chat
      deleteExpiredMessages();
      
      // Also trigger global cleanup via edge function (runs server-side)
      supabase.functions.invoke("cleanup-expired-messages").catch(() => {});
      
      // Check every 5 minutes for expired messages (less frequent = better performance)
      const interval = setInterval(deleteExpiredMessages, 300000);
      return () => clearInterval(interval);
    }
  }, [settings.auto_delete_24h, deleteExpiredMessages]);

  const uploadFileWithProgress = async (file: File): Promise<{ url: string; name: string; type: string } | null> => {
    const uploadId = Date.now().toString();
    const fileExt = file.name.split(".").pop();
    const filePath = `${currentUser.id}/${Date.now()}.${fileExt}`;

    setUploadingMessages((prev) => [
      ...prev,
      {
        id: uploadId,
        fileName: file.name,
        fileType: file.type,
        progress: 0,
        content: newMessage.trim() || undefined,
      },
    ]);

    try {
      // Use XMLHttpRequest for real progress
      const xhr = new XMLHttpRequest();
      
      const uploadPromise = new Promise<void>((resolve, reject) => {
        xhr.upload.addEventListener("progress", (event) => {
          if (event.lengthComputable) {
            const progress = Math.round((event.loaded / event.total) * 100);
            setUploadingMessages((prev) =>
              prev.map((m) => (m.id === uploadId ? { ...m, progress } : m))
            );
          }
        });

        xhr.addEventListener("load", () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            reject(new Error(`Upload failed with status ${xhr.status}`));
          }
        });

        xhr.addEventListener("error", () => reject(new Error("Upload failed")));
      });

      // Get auth token for upload
      const { data: session } = await supabase.auth.getSession();
      const accessToken = session?.session?.access_token;

      xhr.open("POST", `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/chat-files/${filePath}`);
      xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);
      xhr.setRequestHeader("x-upsert", "true");
      xhr.send(file);

      await uploadPromise;

      setUploadingMessages((prev) =>
        prev.map((m) => (m.id === uploadId ? { ...m, progress: 100 } : m))
      );

      const { data: urlData } = supabase.storage
        .from("chat-files")
        .getPublicUrl(filePath);

      // Remove from uploading after a short delay
      setTimeout(() => {
        setUploadingMessages((prev) => prev.filter((m) => m.id !== uploadId));
      }, 500);

      return {
        url: urlData.publicUrl,
        name: file.name,
        type: file.type,
      };
    } catch (err) {
      console.error("Upload error:", err);
      setUploadingMessages((prev) => prev.filter((m) => m.id !== uploadId));
      toast({
        variant: "destructive",
        title: "Lỗi",
        description: "Không thể tải lên file",
      });
      return null;
    }
  };

  const handleSendMessage = async () => {
    if (!newMessage.trim() && !selectedFile) return;

    // Sanitize message content before sending
    let messageContent = sanitizeInput(newMessage.trim());
    const fileToUpload = selectedFile;
    const currentReplyTo = replyTo;

    // Clear inputs immediately so user can continue typing
    setNewMessage("");
    setSelectedFile(null);
    setReplyTo(null);

    // Encrypt message - prefer Signal Protocol, fallback to legacy
    if (messageContent && isEncryptionActive) {
      try {
        if (isSignalReady) {
          messageContent = await signalEncrypt(messageContent);
        } else if (isE2EActive) {
          messageContent = await legacyEncrypt(messageContent);
        }
      } catch (err) {
        console.error("Failed to encrypt message:", err);
        toast({
          variant: "destructive",
          title: "Lỗi mã hóa",
          description: "Không thể mã hóa tin nhắn",
        });
        return;
      }
    }

    if (fileToUpload) {
      // Upload in background
      const fileData = await uploadFileWithProgress(fileToUpload);
      
      if (fileData) {
        const msgType = fileData.type.startsWith("image/") ? "image" : "file";
        
        const { error } = await supabase.from("messages").insert({
          conversation_id: conversation.id,
          sender_id: currentUser.id,
          content: messageContent || null,
          file_url: fileData.url,
          file_name: fileData.name,
          file_type: fileData.type,
          type: msgType,
          reply_to_id: currentReplyTo?.id || null,
        });

        if (error) {
          toast({
            variant: "destructive",
            title: "Lỗi",
            description: "Không thể gửi tin nhắn",
          });
          return;
        }
        
        // Delay onMessageSent to avoid race condition with realtime
        setTimeout(() => onMessageSent(), 300);
      }
    } else if (messageContent) {
      setIsSending(true);
      
      try {
        const { error } = await supabase.from("messages").insert({
          conversation_id: conversation.id,
          sender_id: currentUser.id,
          content: messageContent,
          type: "text",
          reply_to_id: currentReplyTo?.id || null,
        });

        if (error) {
          toast({
            variant: "destructive",
            title: "Lỗi",
            description: "Không thể gửi tin nhắn",
          });
          return;
        }

        // Delay onMessageSent to avoid race condition with realtime
        setTimeout(() => onMessageSent(), 300);
      } catch {
        toast({
          variant: "destructive",
          title: "Lỗi",
          description: "Có lỗi xảy ra khi gửi tin nhắn",
        });
      } finally {
        setIsSending(false);
      }
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Validate file type
      if (!isAllowedFileType(file.type)) {
        toast({
          variant: "destructive",
          title: "Loại file không được hỗ trợ",
          description: "Vui lòng chọn file ảnh, video, audio, PDF hoặc file nén",
        });
        return;
      }
      
      // Support large files up to 5GB
      const maxSize = 5 * 1024 * 1024 * 1024; // 5GB
      if (file.size > maxSize) {
        toast({
          variant: "destructive",
          title: "File quá lớn",
          description: "Kích thước file tối đa là 5GB",
        });
        return;
      }
      setSelectedFile(file);
    }
  };

  const handleStorageFileSelect = async (file: { file_url: string; file_name: string; file_type: string }) => {
    setStorageSelectMode(false);
    setStorageOpen(false);
    
    const { error } = await supabase.from("messages").insert({
      conversation_id: conversation.id,
      sender_id: currentUser.id,
      content: newMessage.trim() || null,
      file_url: file.file_url,
      file_name: file.file_name,
      file_type: file.file_type,
      type: file.file_type.startsWith("image/") ? "image" : "file",
      reply_to_id: replyTo?.id || null,
    });

    if (error) {
      toast({
        variant: "destructive",
        title: "Lỗi",
        description: "Không thể gửi file",
      });
      return;
    }

    setNewMessage("");
    setReplyTo(null);
    onMessageSent();
  };

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, message: Message) => {
      e.preventDefault();
      setContextMenu({
        isOpen: true,
        position: { x: e.clientX, y: e.clientY },
        message,
      });
    },
    []
  );

  const handleTouchStart = useCallback((message: Message) => {
    const timer = setTimeout(() => {
      setContextMenu({
        isOpen: true,
        position: { x: window.innerWidth / 2 - 80, y: window.innerHeight / 2 },
        message,
      });
    }, 500);
    setLongPressTimer(timer);
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      setLongPressTimer(null);
    }
  }, [longPressTimer]);

  const handleDeleteMessage = async () => {
    if (!contextMenu.message) return;

    try {
      await supabase
        .from("messages")
        .update({ is_deleted: true })
        .eq("id", contextMenu.message.id);

      toast({
        title: "Đã xóa",
        description: "Tin nhắn đã bị xóa",
      });
    } catch {
      toast({
        variant: "destructive",
        title: "Lỗi",
        description: "Không thể xóa tin nhắn",
      });
    }
  };

  const handleRevokeMessage = async (message?: Message) => {
    const msg = message || contextMenu.message;
    if (!msg) return;

    try {
      await supabase
        .from("messages")
        .update({ is_revoked: true, content: null, file_url: null })
        .eq("id", msg.id);

      toast({
        title: "Đã thu hồi",
        description: "Tin nhắn đã được thu hồi",
      });
    } catch {
      toast({
        variant: "destructive",
        title: "Lỗi",
        description: "Không thể thu hồi tin nhắn",
      });
    }
  };

  const handleDeleteForMe = async (message?: Message) => {
    const msg = message || contextMenu.message;
    if (!msg) return;

    try {
      const currentDeleted = msg.deleted_for_user_ids || [];
      if (!currentDeleted.includes(currentUser.id)) {
        await supabase
          .from("messages")
          .update({
            deleted_for_user_ids: [...currentDeleted, currentUser.id],
          })
          .eq("id", msg.id);

        // Update local state immediately
        setMessages((prev) =>
          prev.map((m) =>
            m.id === msg.id
              ? { ...m, deleted_for_user_ids: [...currentDeleted, currentUser.id] }
              : m
          )
        );

        toast({
          title: "Đã xóa",
          description: "Tin nhắn đã bị xóa phía bạn",
        });
      }
    } catch {
      toast({
        variant: "destructive",
        title: "Lỗi",
        description: "Không thể xóa tin nhắn",
      });
    }
  };

  const handleReply = (message: Message) => {
    setReplyTo(message);
    textareaRef.current?.focus();
  };

  const handleDownload = () => {
    if (contextMenu.message?.file_url) {
      window.open(contextMenu.message.file_url, "_blank");
    }
  };


  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Desktop: Enter sends, Shift+Enter for newline
    // Mobile: Always allow newline
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    
    if (e.key === "Enter" && !e.shiftKey && !isMobile) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString("vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const isImageFile = (type: string | null) => {
    return type?.startsWith("image/");
  };

  const isMessageExpired = (createdAt: string) => {
    if (!settings.auto_delete_24h) return false;
    const msgDate = new Date(createdAt);
    const now = new Date();
    const diff = now.getTime() - msgDate.getTime();
    return diff > 24 * 60 * 60 * 1000;
  };

  const getReplyToMessage = (replyToId: string | null | undefined) => {
    if (!replyToId) return null;
    return messages.find((m) => m.id === replyToId) || null;
  };

  const getReplyPreview = (msg: Message | null) => {
    if (!msg) return "";
    if (msg.is_revoked) return "Tin nhắn đã bị thu hồi";
    if (msg.content) return msg.content.length > 30 ? msg.content.substring(0, 30) + "..." : msg.content;
    if (isImageFile(msg.file_type)) return "[Hình ảnh]";
    return "[Tệp đính kèm]";
  };

  const visibleMessages = useMemo(() => 
    messages.filter(
      (m) => !m.deleted_for_user_ids?.includes(currentUser.id)
    ),
    [messages, currentUser.id]
  );

  // State for decrypted messages
  const [decryptedContents, setDecryptedContents] = useState<Record<string, string>>({});

  // Decrypt messages when they change or encryption becomes ready
  useEffect(() => {
    const decryptAllMessages = async () => {
      const newDecrypted: Record<string, string> = {};
      
      for (const msg of visibleMessages) {
        if (msg.content) {
          // Check if message is encrypted
          const isSignalMsg = isSignalMessage(msg.content);
          const isLegacyEncrypted = isEncryptedMessage(msg.content);
          
          if (!isSignalMsg && !isLegacyEncrypted) {
            // Plain text message - no decryption needed
            continue;
          }
          
          // If encryption is not active, show lock icon for encrypted messages
          if (!isEncryptionActive) {
            newDecrypted[msg.id] = '🔒 Tin nhắn đã mã hoá';
            continue;
          }
          
          // Try Signal Protocol first
          if (isSignalReady && isSignalMsg) {
            try {
              const decrypted = await signalDecrypt(msg.content);
              newDecrypted[msg.id] = decrypted;
            } catch {
              newDecrypted[msg.id] = '🔒 Không thể giải mã';
            }
          }
          // Fallback to legacy E2E encryption
          else if (isE2EActive && isLegacyEncrypted) {
            try {
              const decrypted = await legacyDecrypt(msg.content);
              newDecrypted[msg.id] = decrypted;
            } catch {
              newDecrypted[msg.id] = '🔒 Không thể giải mã';
            }
          } else {
            newDecrypted[msg.id] = '🔒 Tin nhắn đã mã hoá';
          }
        }
      }
      
      setDecryptedContents(prev => ({ ...prev, ...newDecrypted }));
    };

    decryptAllMessages();
  }, [visibleMessages.length, isEncryptionActive, isSignalReady, isE2EActive, signalDecrypt, legacyDecrypt, isSignalMessage]);

  // Get display content for a message (decrypted if available)
  const getDisplayContent = useCallback((msg: Message): string | null => {
    if (!msg.content) return null;
    if (decryptedContents[msg.id]) return decryptedContents[msg.id];
    if (isSignalMessage(msg.content) || isEncryptedMessage(msg.content)) return '[Đang giải mã...]';
    return msg.content;
  }, [decryptedContents, isSignalMessage]);
  return (
    <div className="flex-1 flex flex-col bg-background h-full">
      {/* Header */}
      <div className="h-16 border-b border-border flex items-center justify-between px-4 md:px-6 flex-shrink-0">
        <div className="flex items-center gap-3">
          {showBackButton && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onBack}
              className="md:hidden"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
          )}
          <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center overflow-hidden">
            {conversation.participant.avatar_url ? (
              <img 
                src={conversation.participant.avatar_url} 
                alt={conversation.participant.username}
                className="w-full h-full object-cover"
              />
            ) : (
              <span className="text-primary font-semibold">
                {conversation.participant.username.charAt(0).toUpperCase()}
              </span>
            )}
          </div>
          <div>
            <p className="font-medium text-foreground">
              {conversation.participant.username}
            </p>
            <div className="flex items-center gap-2">
              <button 
                onClick={() => {
                  const newVal = !e2eEnabled;
                  setE2eEnabled(newVal);
                  try { localStorage.setItem(`e2e_enabled_${conversation.id}`, String(newVal)); } catch {}
                }}
                className="text-xs flex items-center gap-1 hover:opacity-80 transition-opacity"
                title={isEncryptionActive ? "Nhấn để tắt mã hóa E2E" : "Nhấn để bật mã hóa E2E"}
              >
                {isEncryptionActive ? (
                  <>
                    <Lock className="w-3 h-3 text-primary" />
                    <span className="text-primary">
                      {isSignalReady ? "Signal" : "E2E"}{isSignalInitializing ? " ..." : " đã bật"}
                    </span>
                  </>
                ) : (
                  <>
                    <LockOpen className="w-3 h-3 text-muted-foreground" />
                    <span className="text-muted-foreground">E2E đang tắt</span>
                  </>
                )}
              </button>
              {isSignalReady && safetyNumber && (
                <button
                  onClick={() => setSafetyNumberOpen(true)}
                  className="text-xs flex items-center gap-1 text-muted-foreground hover:text-primary transition-colors"
                  title="Xem Safety Number"
                >
                  <Fingerprint className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => {
              setStorageSelectMode(false);
              setStorageOpen(true);
            }}
          >
            <Archive className="w-5 h-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-foreground"
            onClick={handleVoiceCall}
          >
            <Phone className="w-5 h-5" />
          </Button>
          <ConversationMenu
            conversationId={conversation.id}
            currentUserId={currentUser.id}
            participantUserId={conversation.participant.user_id}
            autoDelete24h={settings.auto_delete_24h}
            pendingRequest={settings.auto_delete_pending_from}
            onSettingsChange={fetchSettings}
            onBlockChange={(blocked, blockedByOther) => {
              setIsBlocked(blocked);
              setIsBlockedByOther(blockedByOther);
            }}
          />
        </div>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 p-4 md:p-6">
        <div className="space-y-4 max-w-3xl mx-auto">
          {visibleMessages.length === 0 && uploadingMessages.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <p>Bắt đầu cuộc trò chuyện với {conversation.participant.username}</p>
            </div>
          ) : (
            <>
              {visibleMessages.map((message, index) => {
                const isOwn = message.sender_id === currentUser.id;
                const expired = isMessageExpired(message.created_at);
                const isDeletedForMe = message.deleted_for_user_ids?.includes(currentUser.id);
                const showTime =
                  index === 0 ||
                  new Date(message.created_at).getTime() -
                    new Date(visibleMessages[index - 1].created_at).getTime() >
                    5 * 60 * 1000;
                const replyToMessage = getReplyToMessage(message.reply_to_id);

                return (
                  <div key={message.id} className="animate-fade-in transition-colors duration-500">
                    {showTime && (
                      <div className="text-center mb-4">
                        <span className="text-xs text-muted-foreground bg-muted px-3 py-1 rounded-full">
                          {formatTime(message.created_at)}
                        </span>
                      </div>
                    )}
                    <MessageBubble
                      message={{
                        ...message,
                        content: getDisplayContent(message),
                      }}
                      isOwn={isOwn}
                      isExpired={expired}
                      isDeletedForMe={isDeletedForMe}
                      currentUserId={currentUser.id}
                      replyToMessage={replyToMessage ? {
                        id: replyToMessage.id,
                        content: getDisplayContent(replyToMessage),
                        sender_id: replyToMessage.sender_id,
                        file_type: replyToMessage.file_type,
                      } : null}
                      onContextMenu={handleContextMenu}
                      onTouchStart={handleTouchStart}
                      onTouchEnd={handleTouchEnd}
                      
                      onRevokeMessage={handleRevokeMessage}
                      onDeleteForMe={handleDeleteForMe}
                      onReply={handleReply}
                      onScrollToMessage={scrollToMessage}
                    />
                  </div>
                );
              })}

              {/* Uploading Messages */}
              {uploadingMessages.map((uploadMsg) => (
                <div key={uploadMsg.id} className="flex justify-end animate-fade-in">
                  <div className="max-w-[70%] rounded-2xl px-4 py-3 bg-primary/50 text-primary-foreground rounded-br-md">
                    <div className="flex items-center gap-2 mb-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span className="text-sm">Đang tải lên...</span>
                    </div>
                    <div className="flex items-center gap-2 mb-2">
                      {uploadMsg.fileType.startsWith("image/") ? (
                        <ImageIcon className="w-5 h-5" />
                      ) : (
                        <FileText className="w-5 h-5" />
                      )}
                      <span className="text-sm truncate">{uploadMsg.fileName}</span>
                    </div>
                    <Progress value={uploadMsg.progress} className="h-1" />
                    <span className="text-xs opacity-70">{uploadMsg.progress}%</span>
                    {uploadMsg.content && (
                      <p className="mt-2 text-sm">{uploadMsg.content}</p>
                    )}
                  </div>
                </div>
              ))}
            </>
          )}
          <div ref={scrollRef} />
        </div>
      </ScrollArea>

      {/* Input Area */}
      <div className="p-4 border-t border-border bg-card flex-shrink-0">
        <div className="max-w-3xl mx-auto">
          {/* Blocked Status */}
          {(isBlocked || isBlockedByOther) ? (
            <div className="p-4 bg-destructive/10 rounded-lg text-center">
              <p className="text-destructive font-medium">
                {isBlocked
                  ? "Bạn đã chặn người dùng này. Bỏ chặn để tiếp tục trò chuyện."
                  : "Bạn đã bị chặn. Không thể gửi tin nhắn."}
              </p>
              {isBlocked && (
                <p className="text-sm text-muted-foreground mt-1">
                  Vào menu 3 chấm để bỏ chặn
                </p>
              )}
            </div>
          ) : (
            <>
              {/* Reply Preview */}
              {replyTo && (
                <div className="mb-3 p-3 bg-muted rounded-lg flex items-center justify-between animate-slide-up">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <CornerDownRight className="w-4 h-4 text-primary flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">
                        Trả lời {replyTo.sender_id === currentUser.id ? "chính mình" : conversation.participant.username}
                      </p>
                      <p className="text-sm truncate">{getReplyPreview(replyTo)}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setReplyTo(null)}
                    className="text-muted-foreground hover:text-foreground ml-2 flex-shrink-0"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              {selectedFile && (
                <div className="mb-3 p-3 bg-muted rounded-lg flex items-center justify-between animate-slide-up">
                  <div className="flex items-center gap-2">
                    {isImageFile(selectedFile.type) ? (
                      <ImageIcon className="w-5 h-5 text-primary" />
                    ) : (
                      <FileText className="w-5 h-5 text-primary" />
                    )}
                    <span className="text-sm truncate max-w-[200px]">
                      {selectedFile.name}
                    </span>
                  </div>
                  <button
                    onClick={() => setSelectedFile(null)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              <div className="flex items-end gap-2">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileSelect}
                  className="hidden"
                  accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip,.rar,.7z,*"
                />
                
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-foreground hover:bg-muted flex-shrink-0"
                    >
                      <Paperclip className="w-5 h-5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="bg-card border-border">
                    <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
                      <Upload className="w-4 h-4 mr-2" />
                      Tải từ thiết bị
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => {
                      setStorageSelectMode(true);
                      setStorageOpen(true);
                    }}>
                      <FolderOpen className="w-4 h-4 mr-2" />
                      Tải từ lưu trữ
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                <Textarea
                  ref={textareaRef}
                  placeholder="Nhập tin nhắn..."
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={isSending}
                  className="flex-1 min-h-[40px] max-h-[120px] resize-none bg-background border-border focus:border-primary"
                  rows={1}
                />
                <Button
                  onClick={handleSendMessage}
                  disabled={isSending || (!newMessage.trim() && !selectedFile)}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground flex-shrink-0"
                >
                  {isSending ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <Send className="w-5 h-5" />
                  )}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Context Menu */}
      <MessageContextMenu
        isOpen={contextMenu.isOpen}
        position={contextMenu.position}
        onClose={() => setContextMenu({ ...contextMenu, isOpen: false })}
        onDelete={handleDeleteMessage}
        onRevoke={
          contextMenu.message?.sender_id === currentUser.id
            ? () => handleRevokeMessage()
            : undefined
        }
        onDownload={contextMenu.message?.file_url ? handleDownload : undefined}
        isOwnMessage={contextMenu.message?.sender_id === currentUser.id}
        hasFile={!!contextMenu.message?.file_url}
      />


      {/* Storage Modal */}
      <StorageModal
        isOpen={storageOpen}
        onClose={() => {
          setStorageOpen(false);
          setStorageSelectMode(false);
        }}
        currentUserId={currentUser.id}
        selectionMode={storageSelectMode}
        onSelectFile={handleStorageFileSelect}
      />

      {/* Voice Call Dialog */}
      <VoiceCallDialog
        isOpen={isCallOpen}
        isInCall={callState.isInCall}
        isCalling={callState.isCalling}
        isReceivingCall={callState.isReceivingCall}
        participantName={getParticipantName()}
        participantAvatar={conversation.participant.avatar_url}
        isMuted={isMuted}
        callDuration={formatDuration(callDuration)}
        onAccept={acceptCall}
        onReject={rejectCall}
        onEnd={endCall}
        onToggleMute={toggleMute}
      />

      {/* Safety Number Dialog */}
      <Dialog open={safetyNumberOpen} onOpenChange={setSafetyNumberOpen}>
        <DialogContent className="bg-card border-border max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-foreground">
              <Fingerprint className="w-5 h-5 text-primary" />
              Safety Number
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              So sánh số này với {conversation.participant.username} để xác minh mã hóa đầu cuối.
            </p>
            <div className="font-mono text-center text-lg tracking-[0.3em] leading-relaxed p-4 bg-muted rounded-lg break-all select-all text-foreground">
              {safetyNumber.match(/.{1,5}/g)?.join(' ') || safetyNumber}
            </div>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                navigator.clipboard.writeText(safetyNumber);
                setSafetyNumberCopied(true);
                setTimeout(() => setSafetyNumberCopied(false), 2000);
              }}
            >
              {safetyNumberCopied ? (
                <>
                  <Check className="w-4 h-4 mr-2" />
                  Đã sao chép
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4 mr-2" />
                  Sao chép
                </>
              )}
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              Nếu số này khớp với đối phương, cuộc trò chuyện được mã hóa an toàn.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
