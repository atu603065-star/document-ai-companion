
-- Table to store push notification subscriptions
CREATE TABLE public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, endpoint)
);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own subscriptions" ON public.push_subscriptions
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Table to store VAPID keys (auto-generated, only one row)
CREATE TABLE public.push_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vapid_public_key text NOT NULL,
  vapid_private_key_jwk jsonb NOT NULL,
  vapid_public_key_base64 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.push_config ENABLE ROW LEVEL SECURITY;

-- No RLS policies = only service_role can access push_config
