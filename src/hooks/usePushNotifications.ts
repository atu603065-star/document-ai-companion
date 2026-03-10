import { useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

export const usePushNotifications = (userId?: string) => {
  const subscribedRef = useRef(false);

  const getVapidPublicKey = useCallback(async (): Promise<string | null> => {
    try {
      const { data, error } = await supabase.functions.invoke("push-notification", {
        body: { action: "get-vapid-key" },
      });
      if (error) throw error;
      return data?.vapidPublicKey || null;
    } catch (err) {
      console.error("Failed to get VAPID key:", err);
      return null;
    }
  }, []);

  const subscribeToPush = useCallback(async () => {
    if (!userId || subscribedRef.current) return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      console.log("Push notifications not supported");
      return;
    }

    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        console.log("Notification permission denied");
        return;
      }

      // Wait for service worker to be ready
      const registration = await navigator.serviceWorker.ready;

      // Check if already subscribed
      const existingSub = await registration.pushManager.getSubscription();
      if (existingSub) {
        // Send existing subscription to server
        const subJson = existingSub.toJSON();
        await supabase.functions.invoke("push-notification", {
          body: {
            action: "subscribe",
            userId,
            subscription: {
              endpoint: subJson.endpoint,
              keys: subJson.keys,
            },
          },
        });
        subscribedRef.current = true;
        return;
      }

      // Get VAPID public key
      const vapidPublicKey = await getVapidPublicKey();
      if (!vapidPublicKey) {
        console.error("No VAPID public key available");
        return;
      }

      // Convert base64url to Uint8Array for applicationServerKey
      const base64 = vapidPublicKey.replace(/-/g, "+").replace(/_/g, "/");
      const padding = "=".repeat((4 - (base64.length % 4)) % 4);
      const binary = atob(base64 + padding);
      const applicationServerKey = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        applicationServerKey[i] = binary.charCodeAt(i);
      }

      // Subscribe to push
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });

      const subJson = subscription.toJSON();

      // Save subscription to server
      await supabase.functions.invoke("push-notification", {
        body: {
          action: "subscribe",
          userId,
          subscription: {
            endpoint: subJson.endpoint,
            keys: subJson.keys,
          },
        },
      });

      subscribedRef.current = true;
      console.log("Push notification subscription successful");
    } catch (err) {
      console.error("Push subscription error:", err);
    }
  }, [userId, getVapidPublicKey]);

  const sendPushNotification = useCallback(
    async (conversationId: string, senderName: string, content: string) => {
      if (!userId) return;

      try {
        await supabase.functions.invoke("push-notification", {
          body: {
            action: "notify",
            conversationId,
            senderId: userId,
            senderName,
            content: content?.substring(0, 100) || "Tin nhắn mới",
          },
        });
      } catch (err) {
        // Silent fail - push is best effort
        console.error("Push notify error:", err);
      }
    },
    [userId]
  );

  // Auto-subscribe when userId is available
  useEffect(() => {
    if (userId) {
      subscribeToPush();
    }
  }, [userId, subscribeToPush]);

  return { subscribeToPush, sendPushNotification };
};
