// @ts-nocheck
import { useState, useRef, useEffect } from "react";
import { Edit2, Trash2, Ban } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
const db = supabase as any;
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

interface ConversationContextMenuProps {
  isOpen: boolean;
  position: { x: number; y: number };
  onClose: () => void;
  conversationId: string;
  currentUserId: string;
  currentNickname: string | null;
  participantUsername: string;
  onNicknameChange: (newNickname: string | null) => void;
  onDelete: () => void;
}

export const ConversationContextMenu = ({
  isOpen,
  position,
  onClose,
  conversationId,
  currentUserId,
  currentNickname,
  participantUsername,
  onNicknameChange,
  onDelete,
}: ConversationContextMenuProps) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [newNickname, setNewNickname] = useState(currentNickname || "");
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      // Don't close context menu if a dialog is open
      if (showRenameDialog || showDeleteDialog) {
        return;
      }
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen, onClose, showRenameDialog, showDeleteDialog]);

  useEffect(() => {
    setNewNickname(currentNickname || participantUsername);
  }, [currentNickname, participantUsername]);

  const handleRename = async () => {
    if (!conversationId || !currentUserId) return;
    
    setIsLoading(true);
    try {
      const nicknameValue = newNickname.trim() || null;

      // Update directly using conversation_id and user_id
      const { error } = await supabase
        .from("conversation_participants")
        .update({ nickname: nicknameValue })
        .eq("conversation_id", conversationId)
        .eq("user_id", currentUserId);

      if (error) throw error;

      toast({
        title: "Thành công",
        description: "Đã đổi tên cuộc trò chuyện",
      });

      onNicknameChange(nicknameValue);
      setShowRenameDialog(false);
      onClose();
    } catch (err) {
      console.error("Rename error:", err);
      toast({
        variant: "destructive",
        title: "Lỗi",
        description: "Không thể đổi tên cuộc trò chuyện",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!conversationId || !currentUserId) return;
    
    setIsLoading(true);
    try {
      // First mark all messages as deleted for this user
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

      // Then add to deleted_conversations table
      const { error } = await supabase.from("deleted_conversations").insert({
        user_id: currentUserId,
        conversation_id: conversationId,
      });

      if (error) throw error;

      toast({
        title: "Thành công",
        description: "Đã xóa cuộc trò chuyện phía bạn",
      });

      onDelete();
      setShowDeleteDialog(false);
      onClose();
    } catch (err) {
      console.error("Delete error:", err);
      toast({
        variant: "destructive",
        title: "Lỗi",
        description: "Không thể xóa cuộc trò chuyện",
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <div
        ref={menuRef}
        className="fixed z-50 bg-card border border-border rounded-lg shadow-xl py-1 min-w-[180px] animate-fade-in"
        style={{
          left: `${Math.min(position.x, window.innerWidth - 200)}px`,
          top: `${Math.min(position.y, window.innerHeight - 120)}px`,
        }}
      >
        <button
          onClick={() => {
            setNewNickname(currentNickname || participantUsername);
            setShowRenameDialog(true);
          }}
          className="w-full px-4 py-2 text-left text-sm text-foreground hover:bg-muted flex items-center gap-2"
        >
          <Edit2 className="w-4 h-4" />
          Đổi tên cuộc trò chuyện
        </button>
        <button
          onClick={() => setShowDeleteDialog(true)}
          className="w-full px-4 py-2 text-left text-sm text-rose-500 hover:bg-destructive/10 flex items-center gap-2"
        >
          <Trash2 className="w-4 h-4" />
          Xóa cuộc trò chuyện phía mình
        </button>
      </div>

      {/* Rename Dialog */}
      <Dialog open={showRenameDialog} onOpenChange={() => {}}>
        <DialogContent 
          className="bg-card border-border [&>button]:hidden"
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Đổi tên cuộc trò chuyện</DialogTitle>
            <DialogDescription>
              Tên này chỉ hiển thị ở phía bạn, người kia vẫn thấy tên gốc.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={newNickname}
            onChange={(e) => setNewNickname(e.target.value)}
            placeholder="Nhập tên mới..."
            className="bg-background border-border"
            onKeyDown={(e) => e.key === "Enter" && handleRename()}
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowRenameDialog(false)}
              disabled={isLoading}
            >
              Hủy
            </Button>
            <Button onClick={handleRename} disabled={isLoading}>
              {isLoading ? "Đang lưu..." : "Lưu"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={() => {}}>
        <DialogContent 
          className="bg-card border-border [&>button]:hidden"
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="text-rose-500">
              Xóa cuộc trò chuyện?
            </DialogTitle>
            <DialogDescription>
              Cuộc trò chuyện và tất cả tin nhắn sẽ bị ẩn khỏi danh sách của bạn. 
              Người kia vẫn có thể xem cuộc trò chuyện bình thường.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDeleteDialog(false)}
              disabled={isLoading}
            >
              Hủy
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isLoading}
            >
              {isLoading ? "Đang xóa..." : "Xóa"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
