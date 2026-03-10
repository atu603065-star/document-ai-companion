import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// --- VAPID helpers using Web Crypto API ---

async function generateVapidKeys() {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );

  const publicKeyRaw = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const privateKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
  const publicKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);

  const publicKeyBase64 = uint8ArrayToBase64Url(new Uint8Array(publicKeyRaw));

  return {
    vapid_public_key: JSON.stringify(publicKeyJwk),
    vapid_private_key_jwk: privateKeyJwk,
    vapid_public_key_base64: publicKeyBase64,
  };
}

function uint8ArrayToBase64Url(uint8Array: Uint8Array): string {
  let binary = "";
  for (const byte of uint8Array) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToUint8Array(base64Url: string): Uint8Array {
  const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(base64 + padding);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// --- Web Push Encryption (RFC 8291) ---

async function encryptPayload(
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string
) {
  // Import subscriber's public key
  const subscriberPublicKeyBytes = base64UrlToUint8Array(subscription.keys.p256dh);
  const authSecret = base64UrlToUint8Array(subscription.keys.auth);

  // Generate ephemeral ECDH key pair
  const localKeyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );

  const localPublicKeyRaw = new Uint8Array(
    await crypto.subtle.exportKey("raw", localKeyPair.publicKey)
  );

  // Import subscriber public key for ECDH
  const subscriberPublicKey = await crypto.subtle.importKey(
    "raw",
    subscriberPublicKeyBytes,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );

  // ECDH shared secret
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "ECDH", public: subscriberPublicKey },
      localKeyPair.privateKey,
      256
    )
  );

  // HKDF to derive encryption key and nonce
  const encoder = new TextEncoder();

  // PRK = HKDF-Extract(auth_secret, shared_secret)
  const prkKey = await crypto.subtle.importKey(
    "raw",
    authSecret,
    { name: "HKDF" } as any,
    false,
    ["deriveBits"]
  );

  // Actually, we need to do HKDF properly
  // IKM = ECDH(localPrivate, subscriberPublic)
  // salt = auth_secret
  // Use HMAC-based extract-then-expand

  const ikmKey = await crypto.subtle.importKey(
    "raw",
    sharedSecret,
    "HKDF",
    false,
    ["deriveBits"]
  );

  // Build info for content encryption key
  // "Content-Encoding: aes128gcm\0" + key_id_len + key_id
  const cekInfo = buildInfo("Content-Encoding: aes128gcm", subscriberPublicKeyBytes, localPublicKeyRaw);
  const nonceInfo = buildInfo("Content-Encoding: nonce", subscriberPublicKeyBytes, localPublicKeyRaw);

  const cekBits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: authSecret,
      info: cekInfo,
    },
    ikmKey,
    128
  );

  const nonceBits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: authSecret,
      info: nonceInfo,
    },
    ikmKey,
    96
  );

  // Encrypt with AES-128-GCM
  const contentKey = await crypto.subtle.importKey(
    "raw",
    cekBits,
    "AES-GCM",
    false,
    ["encrypt"]
  );

  const payloadBytes = encoder.encode(payload);
  // Add padding delimiter (RFC 8188): \x02
  const paddedPayload = new Uint8Array(payloadBytes.length + 1);
  paddedPayload.set(payloadBytes);
  paddedPayload[payloadBytes.length] = 2; // delimiter

  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonceBits },
      contentKey,
      paddedPayload
    )
  );

  // Build aes128gcm header: salt(16) + rs(4) + idlen(1) + keyid(65) + encrypted
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // Re-derive with actual salt
  const cekBits2 = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info: cekInfo },
    ikmKey,
    128
  );
  const nonceBits2 = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info: nonceInfo },
    ikmKey,
    96
  );

  const contentKey2 = await crypto.subtle.importKey("raw", cekBits2, "AES-GCM", false, ["encrypt"]);
  const encrypted2 = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonceBits2 }, contentKey2, paddedPayload)
  );

  // Record size (4096 default)
  const rs = 4096;
  const rsBytes = new Uint8Array(4);
  new DataView(rsBytes.buffer).setUint32(0, rs);

  // Header: salt(16) + rs(4) + idlen(1) + keyid(localPublicKey, 65) + ciphertext
  const header = new Uint8Array(16 + 4 + 1 + localPublicKeyRaw.length + encrypted2.length);
  let offset = 0;
  header.set(salt, offset); offset += 16;
  header.set(rsBytes, offset); offset += 4;
  header[offset] = localPublicKeyRaw.length; offset += 1;
  header.set(localPublicKeyRaw, offset); offset += localPublicKeyRaw.length;
  header.set(encrypted2, offset);

  return header;
}

function buildInfo(type: string, subscriberPublicKey: Uint8Array, localPublicKey: Uint8Array): Uint8Array {
  const encoder = new TextEncoder();
  const typeBytes = encoder.encode(type);
  // "WebPush: info\0" + subscriber_key + local_key
  // For aes128gcm, info is just: "Content-Encoding: aes128gcm\0"
  const info = new Uint8Array(typeBytes.length + 1);
  info.set(typeBytes);
  info[typeBytes.length] = 0;
  return info;
}

// --- VAPID JWT ---

async function createVapidAuthHeader(
  endpoint: string,
  privateKeyJwk: JsonWebKey,
  publicKeyBase64: string
) {
  const url = new URL(endpoint);
  const audience = `${url.protocol}//${url.host}`;

  const header = { typ: "JWT", alg: "ES256" };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    aud: audience,
    exp: now + 12 * 3600,
    sub: "mailto:admin@whisper-shield.app",
  };

  const headerB64 = uint8ArrayToBase64Url(new TextEncoder().encode(JSON.stringify(header)));
  const payloadB64 = uint8ArrayToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const unsignedToken = `${headerB64}.${payloadB64}`;

  // Import private key for signing
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    privateKeyJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );

  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      privateKey,
      new TextEncoder().encode(unsignedToken)
    )
  );

  const token = `${unsignedToken}.${uint8ArrayToBase64Url(signature)}`;
  const publicKeyBytes = base64UrlToUint8Array(publicKeyBase64);

  return {
    authorization: `vapid t=${token}, k=${publicKeyBase64}`,
  };
}

// --- Send push notification ---

async function sendPushNotification(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: string,
  vapidPrivateKeyJwk: JsonWebKey,
  vapidPublicKeyBase64: string
) {
  try {
    const encryptedPayload = await encryptPayload(
      { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
      payload
    );

    const vapidHeaders = await createVapidAuthHeader(
      subscription.endpoint,
      vapidPrivateKeyJwk,
      vapidPublicKeyBase64
    );

    const response = await fetch(subscription.endpoint, {
      method: "POST",
      headers: {
        ...vapidHeaders,
        "Content-Type": "application/octet-stream",
        "Content-Encoding": "aes128gcm",
        TTL: "86400",
        Urgency: "high",
      },
      body: encryptedPayload,
    });

    if (response.status === 410 || response.status === 404) {
      // Subscription expired, should be removed
      return { success: false, expired: true };
    }

    return { success: response.ok, status: response.status };
  } catch (error) {
    console.error("Push send error:", error);
    return { success: false, expired: false };
  }
}

// --- Main handler ---

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Get auth header for user identification
    const authHeader = req.headers.get("authorization");
    
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
    const supabaseUser = createClient(supabaseUrl, serviceRoleKey, {
      global: { headers: { authorization: authHeader || "" } },
    });

    const body = await req.json();
    const { action } = body;

    // --- Get or generate VAPID keys ---
    async function getVapidConfig() {
      const { data } = await supabaseAdmin
        .from("push_config")
        .select("*")
        .limit(1)
        .single();

      if (data) return data;

      // Generate new VAPID keys
      const keys = await generateVapidKeys();
      const { data: newConfig, error } = await supabaseAdmin
        .from("push_config")
        .insert(keys)
        .select()
        .single();

      if (error) throw error;
      return newConfig;
    }

    // --- Action: get-vapid-key ---
    if (action === "get-vapid-key") {
      const config = await getVapidConfig();
      return new Response(
        JSON.stringify({ vapidPublicKey: config.vapid_public_key_base64 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --- Action: subscribe ---
    if (action === "subscribe") {
      const { subscription, userId } = body;
      if (!subscription || !userId) {
        return new Response(JSON.stringify({ error: "Missing data" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { error } = await supabaseAdmin
        .from("push_subscriptions")
        .upsert(
          {
            user_id: userId,
            endpoint: subscription.endpoint,
            p256dh: subscription.keys.p256dh,
            auth: subscription.keys.auth,
          },
          { onConflict: "user_id,endpoint" }
        );

      if (error) throw error;

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- Action: unsubscribe ---
    if (action === "unsubscribe") {
      const { userId, endpoint } = body;
      await supabaseAdmin
        .from("push_subscriptions")
        .delete()
        .eq("user_id", userId)
        .eq("endpoint", endpoint);

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- Action: notify ---
    if (action === "notify") {
      const { conversationId, senderId, senderName, content } = body;
      if (!conversationId || !senderId) {
        return new Response(JSON.stringify({ error: "Missing data" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const config = await getVapidConfig();

      // Get other participants in conversation
      const { data: participants } = await supabaseAdmin
        .from("conversation_participants")
        .select("user_id")
        .eq("conversation_id", conversationId)
        .neq("user_id", senderId);

      if (!participants || participants.length === 0) {
        return new Response(JSON.stringify({ sent: 0 }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const recipientIds = participants.map((p) => p.user_id);

      // Get push subscriptions for recipients
      const { data: subscriptions } = await supabaseAdmin
        .from("push_subscriptions")
        .select("*")
        .in("user_id", recipientIds);

      if (!subscriptions || subscriptions.length === 0) {
        return new Response(JSON.stringify({ sent: 0 }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const notificationPayload = JSON.stringify({
        title: senderName || "Tin nhắn mới",
        body: content || "Bạn có tin nhắn mới",
        icon: "/icons/icon-192x192.png",
        badge: "/icons/icon-192x192.png",
        data: {
          conversationId,
          url: `/chat`,
        },
      });

      let sent = 0;
      const expiredEndpoints: string[] = [];

      for (const sub of subscriptions) {
        const result = await sendPushNotification(
          sub,
          notificationPayload,
          config.vapid_private_key_jwk,
          config.vapid_public_key_base64
        );

        if (result.success) sent++;
        if (result.expired) expiredEndpoints.push(sub.endpoint);
      }

      // Clean up expired subscriptions
      if (expiredEndpoints.length > 0) {
        await supabaseAdmin
          .from("push_subscriptions")
          .delete()
          .in("endpoint", expiredEndpoints);
      }

      return new Response(JSON.stringify({ sent }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Push notification error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
