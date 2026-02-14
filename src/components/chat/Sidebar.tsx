import { useState, useCallback } from "react";
import { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Conversation } from "@/pages/Chat";
import { ConversationContextMenu } from "./ConversationContextMenu";
import { StorageModal } from "./StorageModal";
import { Shield, Search, Plus, LogOut, MessageCircle, X, Loader2, UserPlus, Settings, Archive, MoreVertical } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useNavigate } from "react-router-dom";
interface SidebarProps {
  conversations: Conversation[];
  selectedConversation: Conversation | null;
  onSelectConversation: (conversation: Conversation) => void;
  onNewConversation: (conversation: Conversation) => void;
  currentUser: User;
  currentProfile: {
    id: string;
    username: string;
    avatar_url?: string | null;
  } | null;
  onLogout: () => void;
  unreadCounts: {
    [key: string]: number;
  };
  onConversationDelete?: (conversationId: string) => void;
  onConversationRename?: (conversationId: string, newNickname: string | null) => void;
  className?: string;
}
export const Sidebar = ({
  conversations,
  selectedConversation,
  onSelectConversation,
  onNewConversation,
  currentUser,
  currentProfile,
  onLogout,
  unreadCounts,
  onConversationDelete,
  onConversationRename,
  className = ""
}: SidebarProps) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [newChatUsername, setNewChatUsername] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [storageOpen, setStorageOpen] = useState(false);
  const [searchResult, setSearchResult] = useState<{
    id: string;
    username: string;
    user_id: string;
  } | null>(null);
  const [searchPerformed, setSearchPerformed] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    isOpen: boolean;
    position: {
      x: number;
      y: number;
    };
    conversation: Conversation | null;
  }>({
    isOpen: false,
    position: {
      x: 0,
      y: 0
    },
    conversation: null
  });
  const {
    toast
  } = useToast();
  const navigate = useNavigate();
  const filteredConversations = conversations.filter(conv => {
    const displayName = conv.nickname || conv.participant.username;
    return displayName.toLowerCase().includes(searchQuery.toLowerCase());
  });

  // Sort conversations by last message time and unread count
  const sortedConversations = [...filteredConversations].sort((a, b) => {
    const aUnread = unreadCounts[a.id] || 0;
    const bUnread = unreadCounts[b.id] || 0;

    // First sort by unread status
    if (aUnread > 0 && bUnread === 0) return -1;
    if (bUnread > 0 && aUnread === 0) return 1;

    // Then by last message time
    const aTime = a.lastMessage?.created_at || "";
    const bTime = b.lastMessage?.created_at || "";
    return bTime.localeCompare(aTime);
  });
  const handleSearchUser = async () => {
    if (!newChatUsername.trim()) {
      toast({
        variant: "destructive",
        title: "Lỗi",
        description: "Vui lòng nhập ID người dùng"
      });
      return;
    }
    const searchInput = newChatUsername.trim();
    const normalizedUsername = searchInput.toLowerCase();
    
    // Check if searching for self
    if (currentProfile?.username.toLowerCase() === normalizedUsername) {
      toast({
        variant: "destructive",
        title: "Lỗi",
        description: "Bạn không thể nhắn tin với chính mình"
      });
      return;
    }
    
    setIsSearching(true);
    setSearchResult(null);
    setSearchPerformed(true);
    
    try {
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(searchInput);
      
      let targetProfile = null;
      
      if (isUUID) {
        // Try searching by user_id first
        const { data: d1 } = await supabase
          .from("profiles")
          .select("id, username, user_id")
          .eq("user_id", searchInput)
          .limit(1);
        
        if (d1 && d1.length > 0) {
          targetProfile = d1[0];
        } else {
          // Try by profile id
          const { data: d2 } = await supabase
            .from("profiles")
            .select("id, username, user_id")
            .eq("id", searchInput)
            .limit(1);
          if (d2 && d2.length > 0) {
            targetProfile = d2[0];
          }
        }
      }
      
      // If not found by UUID or input is not UUID, search by username
      if (!targetProfile) {
        // Try exact match first
        const { data: d3 } = await supabase
          .from("profiles")
          .select("id, username, user_id")
          .eq("username", searchInput)
          .limit(1);
        
        if (d3 && d3.length > 0) {
          targetProfile = d3[0];
        } else {
          // Try case-insensitive match
          const { data: d4 } = await supabase
            .from("profiles")
            .select("id, username, user_id")
            .ilike("username", searchInput)
            .limit(1);
          if (d4 && d4.length > 0) {
            targetProfile = d4[0];
          }
        }
      }
      
      // Check if searching for self
      if (targetProfile && targetProfile.user_id === currentUser.id) {
        toast({
          variant: "destructive",
          title: "Lỗi",
          description: "Bạn không thể nhắn tin với chính mình"
        });
        setSearchResult(null);
        setIsSearching(false);
        return;
      }
      
      if (!targetProfile) {
        setSearchResult(null);
      } else {
        setSearchResult(targetProfile);
      }
    } catch (err) {
      console.error("Search error:", err);
      toast({
        variant: "destructive",
        title: "Lỗi",
        description: "Có lỗi xảy ra, vui lòng thử lại"
      });
    } finally {
      setIsSearching(false);
    }
  };
  const handleStartChat = async () => {
    if (!searchResult) return;
    setIsSearching(true);
    try {
      const existingConv = conversations.find(c => c.participant.username.toLowerCase() === searchResult.username.toLowerCase());
      if (existingConv) {
        onSelectConversation(existingConv);
        setDialogOpen(false);
        setNewChatUsername("");
        setSearchResult(null);
        setSearchPerformed(false);
        setIsSearching(false);
        return;
      }
      const {
        data: newConversationId,
        error: convError
      } = await supabase.rpc("create_conversation_with_participant", {
        target_user_id: searchResult.user_id
      });
      if (convError || !newConversationId) {
        console.error("Error creating conversation:", convError);
        toast({
          variant: "destructive",
          title: "Lỗi",
          description: "Không thể tạo cuộc trò chuyện"
        });
        setIsSearching(false);
        return;
      }

      // Create default conversation settings
      await supabase.from("conversation_settings").insert({
        conversation_id: newConversationId,
        auto_delete_24h: true
      });
      const conversation: Conversation = {
        id: newConversationId,
        participant: {
          id: searchResult.id,
          username: searchResult.username,
          user_id: searchResult.user_id
        }
      };
      onNewConversation(conversation);
      setDialogOpen(false);
      setNewChatUsername("");
      setSearchResult(null);
      setSearchPerformed(false);
      toast({
        title: "Thành công",
        description: `Đã tạo cuộc trò chuyện với ${searchResult.username}`
      });
    } catch (error) {
      console.error("Error:", error);
      toast({
        variant: "destructive",
        title: "Lỗi",
        description: "Có lỗi xảy ra, vui lòng thử lại"
      });
    } finally {
      setIsSearching(false);
    }
  };
  const handleDialogClose = (open: boolean) => {
    setDialogOpen(open);
    if (!open) {
      setNewChatUsername("");
      setSearchResult(null);
      setSearchPerformed(false);
    }
  };
  const handleContextMenu = useCallback((e: React.MouseEvent, conv: Conversation) => {
    e.preventDefault();
    setContextMenu({
      isOpen: true,
      position: {
        x: e.clientX,
        y: e.clientY
      },
      conversation: conv
    });
  }, []);
  const formatTime = (dateString?: string) => {
    if (!dateString) return "";
    const date = new Date(dateString);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) {
      return date.toLocaleTimeString("vi-VN", {
        hour: "2-digit",
        minute: "2-digit"
      });
    } else if (diffDays === 1) {
      return "Hôm qua";
    } else if (diffDays < 7) {
      return date.toLocaleDateString("vi-VN", {
        weekday: "short"
      });
    }
    return date.toLocaleDateString("vi-VN", {
      day: "2-digit",
      month: "2-digit"
    });
  };
  const getMessagePreview = (conv: Conversation) => {
    if (!conv.lastMessage) return "";
    const {
      content,
      file_type,
      is_revoked
    } = conv.lastMessage as {
      content: string | null;
      file_type?: string | null;
      is_revoked?: boolean;
    };

    // Show revoked message preview
    if (is_revoked) {
      return "Tin nhắn đã bị thu hồi";
    }
    if (file_type?.startsWith("image/")) {
      return "[Hình ảnh]";
    }
    if (file_type) {
      return "[Tệp đính kèm]";
    }
    return content || "";
  };
  return <div className={`w-full md:w-80 border-r border-border bg-sidebar flex flex-col h-full ${className}`}>
      {/* Header */}
      <div className="p-4 border-b border-sidebar-border flex-shrink-0">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Shield className="w-4 h-4 text-primary" />
            </div>
            <span className="font-semibold text-sidebar-foreground">AnndChat</span>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={() => setStorageOpen(true)} className="text-muted-foreground hover:text-foreground" title="Kho lưu trữ">
              <Archive className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => navigate("/settings")} className="text-muted-foreground hover:text-foreground">
              <Settings className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={onLogout} className="text-muted-foreground hover:text-destructive hover:bg-destructive/10">
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Current User */}
        <div className="flex items-center gap-3 p-3 rounded-xl bg-sidebar-accent mb-4">
          <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center overflow-hidden">
            {currentProfile?.avatar_url ? <img src={currentProfile.avatar_url} alt={currentProfile.username} className="w-full h-full object-cover" /> : <span className="text-primary font-semibold">
                {currentProfile?.username?.charAt(0).toUpperCase() || "?"}
              </span>}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sidebar-foreground truncate">
              {currentProfile?.username || "Loading..."}
            </p>
            <p className="text-xs text-muted-foreground">Đang hoạt động</p>
          </div>
          <div className="w-2 h-2 rounded-full bg-online" />
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Tìm kiếm cuộc trò chuyện..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="pl-10 bg-background border-sidebar-border focus:border-primary" />
        </div>
      </div>

      {/* New Chat Button */}
      <div className="p-4 flex-shrink-0">
        <Dialog open={dialogOpen} onOpenChange={handleDialogClose}>
          <DialogTrigger asChild>
            <Button className="w-full bg-primary hover:bg-primary/90 text-primary-foreground">
              <Plus className="w-4 h-4 mr-2" />
              Cuộc trò chuyện mới
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-foreground">
                <UserPlus className="w-5 h-5 text-primary" />
                Bắt đầu cuộc trò chuyện mới
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input placeholder="Nhập ID người dùng..." value={newChatUsername} onChange={e => {
                  setNewChatUsername(e.target.value);
                  setSearchPerformed(false);
                  setSearchResult(null);
                }} onKeyDown={e => e.key === "Enter" && handleSearchUser()} className="bg-background border-border pr-10" disabled={isSearching} />
                  {newChatUsername && <button onClick={() => {
                  setNewChatUsername("");
                  setSearchResult(null);
                  setSearchPerformed(false);
                }} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                      <X className="w-4 h-4" />
                    </button>}
                </div>
                <Button onClick={handleSearchUser} disabled={isSearching || !newChatUsername.trim()} variant="secondary" className="px-4">
                  {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                </Button>
              </div>

              {searchPerformed && <div className="animate-fade-in">
                  {searchResult ? <div className="p-4 rounded-xl bg-muted/50 border border-border">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center">
                          <span className="text-primary font-semibold text-lg">
                            {searchResult.username.charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <div className="flex-1">
                          <p className="font-medium text-foreground">
                            {searchResult.username}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            Người dùng đã tìm thấy
                          </p>
                        </div>
                      </div>
                      <Button onClick={handleStartChat} disabled={isSearching} className="w-full mt-4 bg-primary hover:bg-primary/90">
                        {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <>
                            <MessageCircle className="w-4 h-4 mr-2" />
                            Bắt đầu trò chuyện
                          </>}
                      </Button>
                    </div> : <div className="p-4 rounded-xl border text-center border-destructive bg-secondary">
                      <p className="font-medium text-red-500">
                        Không tìm thấy người dùng
                      </p>
                      <p className="text-sm text-muted-foreground mt-1">
                        Vui lòng kiểm tra lại ID
                      </p>
                    </div>}
                </div>}
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Conversations List */}
      <ScrollArea className="flex-1 px-2">
        <div className="space-y-1 pb-4">
          {sortedConversations.length === 0 ? <div className="text-center py-8 text-muted-foreground">
              <MessageCircle className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p className="text-sm">Chưa có cuộc trò chuyện nào</p>
            </div> : sortedConversations.map(conv => {
          const unreadCount = unreadCounts[conv.id] || 0;
          const displayName = conv.nickname || conv.participant.username;
          const preview = getMessagePreview(conv);
          return <div key={conv.id} className={`relative group w-full p-3 rounded-xl flex items-center gap-3 transition-all hover:bg-sidebar-accent ${selectedConversation?.id === conv.id ? "bg-sidebar-accent border-l-2 border-primary" : ""}`}>
                  <button onClick={() => onSelectConversation(conv)} onContextMenu={e => handleContextMenu(e, conv)} className="flex-1 flex items-center gap-3">
                    <div className="relative">
                      <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 overflow-hidden">
                        {conv.participant.avatar_url ? <img src={conv.participant.avatar_url} alt={displayName} className="w-full h-full object-cover" /> : <span className="text-primary font-semibold text-lg">
                            {displayName.charAt(0).toUpperCase()}
                          </span>}
                      </div>
                      {unreadCount > 0 && <div className="absolute -top-1 -right-1 w-5 h-5 bg-primary rounded-full flex items-center justify-center">
                          <span className="text-xs font-bold text-primary-foreground">
                            {unreadCount > 9 ? "9+" : unreadCount}
                          </span>
                        </div>}
                    </div>
                    <div className="flex-1 min-w-0 text-left">
                      <div className="flex items-center justify-between">
                        <p className={`font-medium truncate ${unreadCount > 0 ? "text-foreground" : "text-sidebar-foreground"}`}>
                          {displayName}
                        </p>
                        <span className="text-xs text-muted-foreground">
                          {formatTime(conv.lastMessage?.created_at)}
                        </span>
                      </div>
                      {conv.lastMessage && <p className={`text-sm truncate ${unreadCount > 0 ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                          {preview}
                        </p>}
                    </div>
                  </button>
                  
                  {/* 3-dot menu button */}
                  <button onClick={e => {
              e.stopPropagation();
              handleContextMenu(e, conv);
            }} className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-full hover:bg-muted">
                    <MoreVertical className="w-4 h-4 text-muted-foreground" />
                  </button>
                </div>;
        })}
        </div>
      </ScrollArea>

      {/* Context Menu */}
      <ConversationContextMenu isOpen={contextMenu.isOpen} position={contextMenu.position} onClose={() => setContextMenu({
      ...contextMenu,
      isOpen: false
    })} conversationId={contextMenu.conversation?.id || ""} currentUserId={currentUser.id} currentNickname={contextMenu.conversation?.nickname || null} participantUsername={contextMenu.conversation?.participant.username || ""} onNicknameChange={newNickname => {
      if (contextMenu.conversation && onConversationRename) {
        onConversationRename(contextMenu.conversation.id, newNickname);
      }
    }} onDelete={() => {
      if (contextMenu.conversation && onConversationDelete) {
        onConversationDelete(contextMenu.conversation.id);
      }
    }} />

      {/* Storage Modal */}
      <StorageModal isOpen={storageOpen} onClose={() => setStorageOpen(false)} currentUserId={currentUser.id} />
    </div>;
};