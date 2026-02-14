import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

interface UnreadCount {
  [conversationId: string]: number;
}

export const useUnreadMessages = (userId: string | undefined, conversationIds: string[]) => {
  const [unreadCounts, setUnreadCounts] = useState<UnreadCount>({});

  const fetchUnreadCounts = useCallback(async () => {
    if (!userId || conversationIds.length === 0) return;

    const counts: UnreadCount = {};

    for (const convId of conversationIds) {
      // Get last read timestamp for this conversation
      const { data: readData } = await supabase
        .from("message_reads")
        .select("last_read_at")
        .eq("conversation_id", convId)
        .eq("user_id", userId)
        .maybeSingle();

      const lastReadAt = readData?.last_read_at || "1970-01-01T00:00:00Z";

      // Count unread messages
      const { count } = await supabase
        .from("messages")
        .select("*", { count: "exact", head: true })
        .eq("conversation_id", convId)
        .neq("sender_id", userId)
        .gt("created_at", lastReadAt)
        .eq("is_deleted", false)
        .eq("is_revoked", false);

      counts[convId] = count || 0;
    }

    setUnreadCounts(counts);
  }, [userId, conversationIds]);

  useEffect(() => {
    fetchUnreadCounts();
  }, [fetchUnreadCounts]);

  // Subscribe to new messages
  useEffect(() => {
    if (!userId || conversationIds.length === 0) return;

    const channel = supabase
      .channel("unread-messages")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
        },
        (payload) => {
          const newMsg = payload.new as { conversation_id: string; sender_id: string };
          if (conversationIds.includes(newMsg.conversation_id) && newMsg.sender_id !== userId) {
            setUnreadCounts((prev) => ({
              ...prev,
              [newMsg.conversation_id]: (prev[newMsg.conversation_id] || 0) + 1,
            }));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, conversationIds]);

  const markAsRead = useCallback(async (conversationId: string) => {
    if (!userId) return;

    // Get the latest message ID
    const { data: latestMsg } = await supabase
      .from("messages")
      .select("id")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Upsert read status
    await supabase.from("message_reads").upsert({
      conversation_id: conversationId,
      user_id: userId,
      last_read_at: new Date().toISOString(),
      last_read_message_id: latestMsg?.id || null,
    }, {
      onConflict: "conversation_id,user_id"
    });

    setUnreadCounts((prev) => ({
      ...prev,
      [conversationId]: 0,
    }));
  }, [userId]);

  return { unreadCounts, markAsRead, refetch: fetchUnreadCounts };
};
