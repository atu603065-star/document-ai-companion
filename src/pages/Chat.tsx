import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { User, Session } from "@supabase/supabase-js";
import { Sidebar } from "@/components/chat/Sidebar";
import { ChatArea } from "@/components/chat/ChatArea";
import { EmptyState } from "@/components/chat/EmptyState";
import { VoiceCallDialog } from "@/components/chat/VoiceCallDialog";
import { useUnreadMessages } from "@/hooks/useUnreadMessages";
import { useIsMobile } from "@/hooks/use-mobile";
import { useTheme } from "@/hooks/useTheme";
import { useNotificationSound } from "@/hooks/useNotificationSound";
import { useVoiceCall } from "@/hooks/useVoiceCall";
import { Loader2 } from "lucide-react";

export interface Conversation {
  id: string;
  participant: {
    id: string;
    username: string;
    user_id: string;
    avatar_url?: string | null;
  };
  nickname?: string | null;
  lastMessage?: {
    content: string | null;
    created_at: string;
    file_type?: string | null;
    sender_id?: string;
    is_revoked?: boolean;
  };
}

const Chat = () => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [currentProfile, setCurrentProfile] = useState<{ id: string; username: string; avatar_url?: string | null } | null>(null);
  const [deletedConversationIds, setDeletedConversationIds] = useState<string[]>([]);
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  
  // Use ref to track conversations for realtime callbacks (avoids stale closure)
  const conversationsRef = useRef<Conversation[]>([]);
  conversationsRef.current = conversations;
  
  // Use ref for deleted conversation IDs to avoid stale closure in realtime handlers
  const deletedConversationIdsRef = useRef<string[]>([]);
  deletedConversationIdsRef.current = deletedConversationIds;
  
  // Initialize theme
  useTheme(user?.id);

  const conversationIds = conversations.map((c) => c.id);
  const { unreadCounts, markAsRead, refetch: refetchUnread } = useUnreadMessages(user?.id, conversationIds);
  const { playSound } = useNotificationSound(user?.id);
  
  // Voice call at page level - so calls can be received from mobile sidebar
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
  } = useVoiceCall(user?.id);

  // Find caller/callee info for voice call dialog
  const getCallParticipant = () => {
    const participantId = callState.callerId === user?.id 
      ? callState.calleeId 
      : callState.callerId;
    
    // Try to find from conversations
    const conv = conversations.find(c => 
      c.participant.user_id === participantId
    );
    
    return {
      name: callState.callerName || conv?.participant.username || "Người dùng",
      avatar: conv?.participant.avatar_url,
      conversationId: callState.conversationId,
    };
  };

  const callParticipant = getCallParticipant();
  const isCallOpen = callState.isCalling || callState.isReceivingCall || callState.isInCall;

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        
        if (!session) {
          navigate("/auth");
        }
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (!session) {
        navigate("/auth");
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  useEffect(() => {
    if (user) {
      checkPinRequired();
      fetchCurrentProfile();
      fetchDeletedConversations();
    }
  }, [user]);

  useEffect(() => {
    if (user && deletedConversationIds !== null) {
      fetchConversations();
    }
  }, [user, deletedConversationIds]);

  // Disable Android back button
  useEffect(() => {
    const handlePopState = (e: PopStateEvent) => {
      // Push state back to prevent navigation
      window.history.pushState(null, "", window.location.href);
      
      // If in chat view on mobile, go back to sidebar instead
      if (isMobile && selectedConversation) {
        setSelectedConversation(null);
      }
    };

    // Push initial state
    window.history.pushState(null, "", window.location.href);
    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [isMobile, selectedConversation]);

  // Subscribe to new conversations in realtime - FIXED to use ref to avoid stale closure
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel("new-conversations")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "conversation_participants",
          filter: `user_id=eq.${user.id}`,
        },
        async (payload) => {
          // New conversation added for this user - use ref for current value
          const newParticipation = payload.new as any;
          const existingConv = conversationsRef.current.find(c => c.id === newParticipation.conversation_id);
          // Skip if we already have it OR if it was deleted by this user
          if (!existingConv && !deletedConversationIdsRef.current.includes(newParticipation.conversation_id)) {
            // Only fetch if we don't already have this conversation
            setTimeout(() => fetchConversations(), 100);
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
        },
        async (payload) => {
          const newMessage = payload.new as any;
          
          // Use ref to check if conversation exists - avoids stale closure issue
          const currentConversations = conversationsRef.current;
          const conversationExists = currentConversations.some(c => c.id === newMessage.conversation_id);
          
          // Skip if this conversation was deleted by the user
          if (deletedConversationIdsRef.current.includes(newMessage.conversation_id)) {
            return;
          }
          
          if (!conversationExists) {
            // New conversation, need to fetch it - but use timeout to avoid race
            setTimeout(() => fetchConversations(), 100);
            return;
          }
          
          // Update lastMessage for the conversation - use functional update
          setConversations((prev) => {
            // Double check prev is not empty to avoid clearing conversations
            if (prev.length === 0 && currentConversations.length > 0) {
              // State got cleared somehow, restore from ref
              return currentConversations.map((conv) => {
                if (conv.id === newMessage.conversation_id) {
                  return {
                    ...conv,
                    lastMessage: {
                      content: newMessage.content,
                      created_at: newMessage.created_at,
                      file_type: newMessage.file_type,
                      sender_id: newMessage.sender_id,
                      is_revoked: newMessage.is_revoked || false,
                    },
                  };
                }
                return conv;
              }).sort((a, b) => {
                const aTime = a.lastMessage?.created_at || "";
                const bTime = b.lastMessage?.created_at || "";
                return bTime.localeCompare(aTime);
              });
            }
            
            const updated = prev.map((conv) => {
              if (conv.id === newMessage.conversation_id) {
                return {
                  ...conv,
                  lastMessage: {
                    content: newMessage.content,
                    created_at: newMessage.created_at,
                    file_type: newMessage.file_type,
                    sender_id: newMessage.sender_id,
                    is_revoked: newMessage.is_revoked || false,
                  },
                };
              }
              return conv;
            });
            // Sort by latest message
            return updated.sort((a, b) => {
              const aTime = a.lastMessage?.created_at || "";
              const bTime = b.lastMessage?.created_at || "";
              return bTime.localeCompare(aTime);
            });
          });

          // Play sound if message is not from current user and not in current conversation
          if (newMessage.sender_id !== user.id) {
            const isInCurrentConversation = selectedConversation?.id === newMessage.conversation_id;
            if (!isInCurrentConversation) {
              playSound();
            }
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
        },
        async (payload) => {
          const updatedMessage = payload.new as any;
          
          // Update lastMessage if this was the last message in a conversation
          setConversations((prev) => {
            return prev.map((conv) => {
              if (
                conv.id === updatedMessage.conversation_id &&
                conv.lastMessage
              ) {
                // Update preview if the last message was revoked
                return {
                  ...conv,
                  lastMessage: {
                    ...conv.lastMessage,
                    content: updatedMessage.content,
                    is_revoked: updatedMessage.is_revoked || false,
                  },
                };
              }
              return conv;
            });
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, selectedConversation?.id, playSound]);

  // Mark as read when selecting a conversation
  useEffect(() => {
    if (selectedConversation && user) {
      markAsRead(selectedConversation.id);
    }
  }, [selectedConversation, user, markAsRead]);

  const checkPinRequired = async () => {
    if (!user) return;

    const verified = sessionStorage.getItem("pin_verified");
    if (verified === "true") return;

    const { data } = await supabase
      .from("user_settings")
      .select("pin_enabled")
      .eq("user_id", user.id)
      .maybeSingle();

    if (data?.pin_enabled) {
      navigate("/pin-lock");
    }
  };

  const fetchCurrentProfile = async () => {
    if (!user) return;

    const { data } = await supabase
      .from("profiles")
      .select("id, username, avatar_url")
      .eq("user_id", user.id)
      .single();

    if (data) {
      setCurrentProfile(data);
    }
  };

  const fetchDeletedConversations = async () => {
    if (!user) return;

    const { data } = await supabase
      .from("deleted_conversations")
      .select("conversation_id")
      .eq("user_id", user.id);

    setDeletedConversationIds(data?.map((d) => d.conversation_id) || []);
  };

  const fetchConversations = useCallback(async () => {
    if (!user) return;

    try {
      const { data: participations, error: partError } = await supabase
        .from("conversation_participants")
        .select("conversation_id, nickname")
        .eq("user_id", user.id);

      if (partError) {
        console.error("Error fetching participations:", partError);
        return;
      }

      if (!participations || participations.length === 0) {
        setConversations([]);
        return;
      }

      // Filter out deleted conversations
      const activeParticipations = participations.filter(
        (p) => !deletedConversationIds.includes(p.conversation_id)
      );

      if (activeParticipations.length === 0) {
        setConversations([]);
        return;
      }

      const activeConversationIds = activeParticipations.map((p) => p.conversation_id);

      // Fetch other participants separately
      const { data: allParticipants, error: allPartError } = await supabase
        .from("conversation_participants")
        .select("conversation_id, user_id")
        .in("conversation_id", activeConversationIds)
        .neq("user_id", user.id);

      if (allPartError) {
        console.error("Error fetching all participants:", allPartError);
        return;
      }

      // Get profile info for other participants
      const otherUserIds = [...new Set(allParticipants?.map((p) => p.user_id) || [])];
      
      if (otherUserIds.length === 0) {
        setConversations([]);
        return;
      }

      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("id, username, user_id, avatar_url")
        .in("user_id", otherUserIds);

      if (profilesError) {
        console.error("Error fetching profiles:", profilesError);
        return;
      }

      const { data: messages } = await supabase
        .from("messages")
        .select("conversation_id, content, created_at, file_type, sender_id, is_deleted, is_revoked")
        .in("conversation_id", activeConversationIds)
        .order("created_at", { ascending: false });

      const conversationsData: Conversation[] = [];

      for (const participation of activeParticipations) {
        const convId = participation.conversation_id;
        const participant = allParticipants?.find(
          (p) => p.conversation_id === convId
        );
        
        if (participant) {
          const profile = profiles?.find((p) => p.user_id === participant.user_id);
          if (profile) {
            // Get latest message (including revoked for preview)
            const latestMsg = messages?.find(
              (m) => m.conversation_id === convId && !m.is_deleted
            );
            
            conversationsData.push({
              id: convId,
              participant: {
                id: profile.id,
                username: profile.username,
                user_id: participant.user_id,
                avatar_url: profile.avatar_url,
              },
              nickname: participation.nickname,
              lastMessage: latestMsg
                ? {
                    content: latestMsg.content,
                    created_at: latestMsg.created_at,
                    is_revoked: latestMsg.is_revoked,
                    file_type: latestMsg.file_type,
                    sender_id: latestMsg.sender_id,
                  }
                : undefined,
            });
          }
        }
      }

      // Sort by last message time
      conversationsData.sort((a, b) => {
        const aTime = a.lastMessage?.created_at || "";
        const bTime = b.lastMessage?.created_at || "";
        return bTime.localeCompare(aTime);
      });

      setConversations(conversationsData);
    } catch (err) {
      console.error("Error in fetchConversations:", err);
    }
  }, [user, deletedConversationIds]);

  const handleNewConversation = (conversation: Conversation) => {
    setConversations((prev) => {
      const exists = prev.find((c) => c.id === conversation.id);
      if (exists) return prev;
      return [conversation, ...prev];
    });
    setSelectedConversation(conversation);
  };

  const handleSelectConversation = (conversation: Conversation) => {
    setSelectedConversation(conversation);
    markAsRead(conversation.id);
  };

  const handleBack = () => {
    setSelectedConversation(null);
  };

  const handleConversationDelete = (conversationId: string) => {
    setDeletedConversationIds((prev) => [...prev, conversationId]);
    setConversations((prev) => prev.filter((c) => c.id !== conversationId));
    if (selectedConversation?.id === conversationId) {
      setSelectedConversation(null);
    }
  };

  const handleConversationRename = (conversationId: string, newNickname: string | null) => {
    setConversations((prev) =>
      prev.map((c) =>
        c.id === conversationId ? { ...c, nickname: newNickname } : c
      )
    );
    if (selectedConversation?.id === conversationId) {
      setSelectedConversation((prev) =>
        prev ? { ...prev, nickname: newNickname } : null
      );
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  if (!session || !user) {
    return null;
  }

  // Mobile layout: show either sidebar or chat
  if (isMobile) {
    return (
      <div className="h-screen flex flex-col bg-background overflow-hidden">
        {selectedConversation ? (
          <ChatArea
            conversation={selectedConversation}
            currentUser={user}
            onMessageSent={() => {
              refetchUnread();
            }}
            onBack={handleBack}
            showBackButton={true}
            voiceCallProps={{
              callState,
              isMuted,
              callDuration,
              formatDuration,
              startCall,
              acceptCall,
              rejectCall,
              endCall,
              toggleMute,
            }}
          />
        ) : (
          <>
            <Sidebar
              conversations={conversations}
              selectedConversation={selectedConversation}
              onSelectConversation={handleSelectConversation}
              onNewConversation={handleNewConversation}
              currentUser={user}
              currentProfile={currentProfile}
              onLogout={() => supabase.auth.signOut()}
              unreadCounts={unreadCounts}
              onConversationDelete={handleConversationDelete}
              onConversationRename={handleConversationRename}
            />
            {/* Voice call dialog for when on sidebar but receiving a call */}
            <VoiceCallDialog
              isOpen={isCallOpen}
              isInCall={callState.isInCall}
              isCalling={callState.isCalling}
              isReceivingCall={callState.isReceivingCall}
              participantName={callParticipant.name}
              participantAvatar={callParticipant.avatar}
              isMuted={isMuted}
              callDuration={formatDuration(callDuration)}
              onAccept={acceptCall}
              onReject={rejectCall}
              onEnd={endCall}
              onToggleMute={toggleMute}
            />
          </>
        )}
      </div>
    );
  }

  // Desktop layout: side by side
  return (
    <div className="h-screen flex bg-background overflow-hidden">
      <Sidebar
        conversations={conversations}
        selectedConversation={selectedConversation}
        onSelectConversation={handleSelectConversation}
        onNewConversation={handleNewConversation}
        currentUser={user}
        currentProfile={currentProfile}
        onLogout={() => supabase.auth.signOut()}
        unreadCounts={unreadCounts}
        onConversationDelete={handleConversationDelete}
        onConversationRename={handleConversationRename}
      />
      
      <main className="flex-1 flex">
        {selectedConversation ? (
          <ChatArea
            conversation={selectedConversation}
            currentUser={user}
            onMessageSent={() => {
              refetchUnread();
            }}
            voiceCallProps={{
              callState,
              isMuted,
              callDuration,
              formatDuration,
              startCall,
              acceptCall,
              rejectCall,
              endCall,
              toggleMute,
            }}
          />
        ) : (
          <EmptyState />
        )}
      </main>

      {/* Voice call dialog for desktop when no conversation selected */}
      {!selectedConversation && (
        <VoiceCallDialog
          isOpen={isCallOpen}
          isInCall={callState.isInCall}
          isCalling={callState.isCalling}
          isReceivingCall={callState.isReceivingCall}
          participantName={callParticipant.name}
          participantAvatar={callParticipant.avatar}
          isMuted={isMuted}
          callDuration={formatDuration(callDuration)}
          onAccept={acceptCall}
          onReject={rejectCall}
          onEnd={endCall}
          onToggleMute={toggleMute}
        />
      )}
    </div>
  );
};

export default Chat;
