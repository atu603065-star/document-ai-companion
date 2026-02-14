import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  MoreVertical,
  Clock,
  Trash2,
  FileImage,
  Download,
  Loader2,
  Ban,
  CheckCircle,
} from "lucide-react";

interface ConversationMenuProps {
  conversationId: string;
  currentUserId: string;
  participantUserId: string;
  autoDelete24h: boolean;
  pendingRequest: string | null;
  onSettingsChange: () => void;
  onBlockChange?: (isBlocked: boolean, isBlockedByOther: boolean) => void;
}

interface SharedFile {
  id: string;
  file_url: string;
  file_name: string;
  file_type: string;
  created_at: string;
}

export const ConversationMenu = ({
  conversationId,
  currentUserId,
  participantUserId,
  autoDelete24h,
  pendingRequest,
  onSettingsChange,
  onBlockChange,
}: ConversationMenuProps) => {
  const [showFilesDialog, setShowFilesDialog] = useState(false);
  const [showClearDialog, setShowClearDialog] = useState(false);
  const [showBlockDialog, setShowBlockDialog] = useState(false);
  const [sharedFiles, setSharedFiles] = useState<SharedFile[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isBlocked, setIsBlocked] = useState(false);
  const [isBlockedByOther, setIsBlockedByOther] = useState(false);
  const { toast } = useToast();

  // Check block status on mount and subscribe to changes
  useEffect(() => {
    checkBlockStatus();

    const channel = supabase
      .channel(`blocks:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "blocked_users",
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => {
          checkBlockStatus();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId, currentUserId, participantUserId]);

  const checkBlockStatus = async () => {
    // Check if current user blocked the other
    const { data: blockedByMe } = await supabase
      .from("blocked_users")
      .select("id")
      .eq("blocker_id", currentUserId)
      .eq("blocked_id", participantUserId)
      .eq("conversation_id", conversationId)
      .maybeSingle();

    // Check if other user blocked current user
    const { data: blockedByOther } = await supabase
      .from("blocked_users")
      .select("id")
      .eq("blocker_id", participantUserId)
      .eq("blocked_id", currentUserId)
      .eq("conversation_id", conversationId)
      .maybeSingle();

    const blocked = !!blockedByMe;
    const blockedByOtherUser = !!blockedByOther;
    
    setIsBlocked(blocked);
    setIsBlockedByOther(blockedByOtherUser);
    onBlockChange?.(blocked, blockedByOtherUser);
  };

  const handleToggleAutoDelete = async () => {
    try {
      if (autoDelete24h) {
        // Request to disable auto-delete - needs other party's consent
        await supabase.from("messages").insert({
          conversation_id: conversationId,
          sender_id: currentUserId,
          content: "đã yêu cầu tắt chế độ xóa tin nhắn sau 24 giờ. Bạn có đồng ý không?",
          type: "system",
        });

        await supabase.from("conversation_settings").upsert({
          conversation_id: conversationId,
          auto_delete_pending_from: currentUserId,
        }, { onConflict: "conversation_id" });

        toast({
          title: "Đã gửi yêu cầu",
          description: "Chờ người kia đồng ý để tắt tự động xóa tin nhắn",
        });
      } else {
        // Re-enable auto-delete - also needs other party's consent
        await supabase.from("messages").insert({
          conversation_id: conversationId,
          sender_id: currentUserId,
          content: "đã yêu cầu bật lại chế độ xóa tin nhắn sau 24 giờ. Bạn có đồng ý không?",
          type: "system",
        });

        await supabase.from("conversation_settings").upsert({
          conversation_id: conversationId,
          auto_delete_pending_from: currentUserId,
        }, { onConflict: "conversation_id" });

        toast({
          title: "Đã gửi yêu cầu",
          description: "Chờ người kia đồng ý để bật lại xóa tự động",
        });
      }
      onSettingsChange();
    } catch {
      toast({
        variant: "destructive",
        title: "Lỗi",
        description: "Không thể thay đổi cài đặt",
      });
    }
  };

  const handleRespondToRequest = async (accept: boolean, isEnableRequest: boolean) => {
    try {
      if (accept) {
        await supabase.from("conversation_settings").upsert({
          conversation_id: conversationId,
          auto_delete_24h: isEnableRequest ? true : false,
          auto_delete_pending_from: null,
        }, { onConflict: "conversation_id" });

        await supabase.from("messages").insert({
          conversation_id: conversationId,
          sender_id: currentUserId,
          content: isEnableRequest 
            ? "đã đồng ý bật lại chế độ xóa tin nhắn sau 24 giờ."
            : "đã đồng ý tắt chế độ xóa tin nhắn sau 24 giờ.",
          type: "system",
        });

        toast({
          title: isEnableRequest ? "Đã bật tự động xóa" : "Đã tắt tự động xóa",
          description: isEnableRequest 
            ? "Tin nhắn sẽ tự động xóa sau 24 giờ" 
            : "Tin nhắn sẽ không bị xóa sau 24 giờ",
        });
      } else {
        await supabase.from("conversation_settings").upsert({
          conversation_id: conversationId,
          auto_delete_pending_from: null,
        }, { onConflict: "conversation_id" });

        await supabase.from("messages").insert({
          conversation_id: conversationId,
          sender_id: currentUserId,
          content: isEnableRequest 
            ? "đã từ chối yêu cầu bật lại chế độ xóa tin nhắn sau 24 giờ."
            : "đã từ chối yêu cầu tắt chế độ xóa tin nhắn sau 24 giờ.",
          type: "system",
        });

        toast({
          title: "Đã từ chối",
          description: isEnableRequest
            ? "Tin nhắn sẽ không bị tự động xóa"
            : "Tin nhắn vẫn sẽ bị xóa sau 24 giờ",
        });
      }

      onSettingsChange();
    } catch {
      toast({
        variant: "destructive",
        title: "Lỗi",
        description: "Không thể xử lý yêu cầu",
      });
    }
  };

  const handleViewFiles = async () => {
    setIsLoading(true);
    setShowFilesDialog(true);

    const { data } = await supabase
      .from("messages")
      .select("id, file_url, file_name, file_type, created_at")
      .eq("conversation_id", conversationId)
      .not("file_url", "is", null)
      .eq("is_deleted", false)
      .eq("is_revoked", false)
      .order("created_at", { ascending: false });

    setSharedFiles((data as SharedFile[]) || []);
    setIsLoading(false);
  };

  const handleClearForMe = async () => {
    try {
      // Get all messages in the conversation
      const { data: messages } = await supabase
        .from("messages")
        .select("id, deleted_for_user_ids")
        .eq("conversation_id", conversationId);

      if (messages) {
        for (const msg of messages) {
          const currentDeleted = msg.deleted_for_user_ids || [];
          if (!currentDeleted.includes(currentUserId)) {
            await supabase
              .from("messages")
              .update({
                deleted_for_user_ids: [...currentDeleted, currentUserId],
              })
              .eq("id", msg.id);
          }
        }
      }

      toast({
        title: "Đã xóa",
        description: "Đã xóa tất cả tin nhắn cho bạn",
      });

      setShowClearDialog(false);
    } catch {
      toast({
        variant: "destructive",
        title: "Lỗi",
        description: "Không thể xóa tin nhắn",
      });
    }
  };

  const handleBlock = async () => {
    setIsLoading(true);
    try {
      if (isBlocked) {
        // Unblock
        await supabase
          .from("blocked_users")
          .delete()
          .eq("blocker_id", currentUserId)
          .eq("blocked_id", participantUserId)
          .eq("conversation_id", conversationId);

        toast({
          title: "Đã bỏ chặn",
          description: "Bạn đã bỏ chặn người dùng này",
        });
      } else {
        // Block
        await supabase.from("blocked_users").insert({
          blocker_id: currentUserId,
          blocked_id: participantUserId,
          conversation_id: conversationId,
        });

        toast({
          title: "Đã chặn",
          description: "Bạn đã chặn người dùng này",
        });
      }

      await checkBlockStatus();
      setShowBlockDialog(false);
    } catch (err) {
      console.error("Block error:", err);
      toast({
        variant: "destructive",
        title: "Lỗi",
        description: "Không thể thực hiện hành động này",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const isImageFile = (type: string) => type?.startsWith("image/");

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
            <MoreVertical className="w-5 h-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="bg-card border-border">
          {pendingRequest && pendingRequest !== currentUserId && (
            <>
              <div className="px-3 py-2 text-sm text-muted-foreground">
                {autoDelete24h 
                  ? "Người kia muốn tắt xóa tự động"
                  : "Người kia muốn bật lại xóa tự động"}
              </div>
              <div className="flex gap-2 px-3 pb-2">
                <Button size="sm" variant="outline" onClick={() => handleRespondToRequest(false, !autoDelete24h)}>
                  Từ chối
                </Button>
                <Button size="sm" onClick={() => handleRespondToRequest(true, !autoDelete24h)}>
                  Đồng ý
                </Button>
              </div>
              <DropdownMenuSeparator />
            </>
          )}

          <DropdownMenuItem
            onClick={handleToggleAutoDelete}
            disabled={pendingRequest === currentUserId}
          >
            <Clock className="w-4 h-4 mr-2" />
            {pendingRequest === currentUserId
              ? "Đang chờ đồng ý..."
              : autoDelete24h
                ? "Tắt xóa sau 24 giờ"
                : "Bật xóa tự động 24 giờ"}
          </DropdownMenuItem>

          <DropdownMenuItem onClick={handleViewFiles}>
            <FileImage className="w-4 h-4 mr-2" />
            Xem file, ảnh đã gửi
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem
            onClick={() => setShowBlockDialog(true)}
            className={isBlocked ? "text-emerald-500 focus:text-emerald-500" : "text-rose-500 focus:text-rose-500 focus:bg-rose-500/10"}
          >
            {isBlocked ? (
              <>
                <CheckCircle className="w-4 h-4 mr-2" />
                Bỏ chặn người dùng
              </>
            ) : (
              <>
                <Ban className="w-4 h-4 mr-2" />
                Chặn người dùng
              </>
            )}
          </DropdownMenuItem>

          <DropdownMenuItem
            onClick={() => setShowClearDialog(true)}
            className="text-rose-500 focus:text-rose-500 focus:bg-rose-500/10"
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Xóa tất cả tin nhắn (chỉ phía mình)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Files Dialog */}
      <Dialog open={showFilesDialog} onOpenChange={setShowFilesDialog}>
        <DialogContent className="bg-card border-border max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileImage className="w-5 h-5 text-primary" />
              File và ảnh đã gửi
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[400px]">
            {isLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
              </div>
            ) : sharedFiles.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                Chưa có file nào được chia sẻ
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 p-2">
                {sharedFiles.map((file) => (
                  <a
                    key={file.id}
                    href={file.file_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group relative rounded-lg overflow-hidden border border-border hover:border-primary transition-colors"
                  >
                    {isImageFile(file.file_type) ? (
                      <img
                        src={file.file_url}
                        alt={file.file_name}
                        className="w-full h-24 object-cover"
                      />
                    ) : (
                      <div className="w-full h-24 flex flex-col items-center justify-center bg-muted">
                        <FileImage className="w-8 h-8 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground truncate max-w-full px-2 mt-1">
                          {file.file_name}
                        </span>
                      </div>
                    )}
                    <div className="absolute inset-0 bg-background/80 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                      <Download className="w-6 h-6 text-primary" />
                    </div>
                  </a>
                ))}
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* Clear Chat Dialog */}
      <Dialog open={showClearDialog} onOpenChange={setShowClearDialog}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-destructive">Xóa tất cả tin nhắn?</DialogTitle>
            <DialogDescription>
              Tất cả tin nhắn sẽ bị xóa chỉ ở phía bạn. Người kia vẫn có thể xem tin nhắn.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowClearDialog(false)}>
              Hủy
            </Button>
            <Button variant="destructive" onClick={handleClearForMe}>
              Xóa tất cả
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Block User Dialog */}
      <Dialog open={showBlockDialog} onOpenChange={setShowBlockDialog}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle className={isBlocked ? "text-green-500" : "text-destructive"}>
              {isBlocked ? "Bỏ chặn người dùng?" : "Chặn người dùng?"}
            </DialogTitle>
            <DialogDescription>
              {isBlocked
                ? "Bạn sẽ có thể nhận và gửi tin nhắn với người này."
                : "Khi chặn, cả hai sẽ không thể gửi tin nhắn cho nhau. Bạn có thể bỏ chặn bất cứ lúc nào."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBlockDialog(false)}>
              Hủy
            </Button>
            <Button
              variant={isBlocked ? "default" : "destructive"}
              onClick={handleBlock}
              disabled={isLoading}
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : isBlocked ? (
                "Bỏ chặn"
              ) : (
                "Chặn"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
