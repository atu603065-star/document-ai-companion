
-- Signal Protocol: Identity keys, signed prekeys, and one-time prekeys

-- Identity keys table - stores public identity + signing keys per user
CREATE TABLE public.identity_keys (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  identity_key TEXT NOT NULL,
  signing_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.identity_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view identity keys"
  ON public.identity_keys FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Users can insert own identity key"
  ON public.identity_keys FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own identity key"
  ON public.identity_keys FOR UPDATE
  USING (auth.uid() = user_id);

-- Signed prekeys table
CREATE TABLE public.signed_prekeys (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  key_id INTEGER NOT NULL,
  public_key TEXT NOT NULL,
  signature TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'),
  UNIQUE(user_id, key_id)
);

ALTER TABLE public.signed_prekeys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view signed prekeys"
  ON public.signed_prekeys FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Users can insert own signed prekeys"
  ON public.signed_prekeys FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own signed prekeys"
  ON public.signed_prekeys FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own signed prekeys"
  ON public.signed_prekeys FOR DELETE
  USING (auth.uid() = user_id);

-- One-time prekeys table (pool of 20+ keys per user)
CREATE TABLE public.one_time_prekeys (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  key_id INTEGER NOT NULL,
  public_key TEXT NOT NULL,
  used BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, key_id)
);

ALTER TABLE public.one_time_prekeys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view one-time prekeys"
  ON public.one_time_prekeys FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Users can insert own one-time prekeys"
  ON public.one_time_prekeys FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Authenticated users can claim prekeys"
  ON public.one_time_prekeys FOR UPDATE
  USING (auth.role() = 'authenticated');

CREATE POLICY "Users can delete own one-time prekeys"
  ON public.one_time_prekeys FOR DELETE
  USING (auth.uid() = user_id);

-- Atomic function to claim a one-time prekey (prevents race conditions)
CREATE OR REPLACE FUNCTION public.claim_one_time_prekey(target_user_id UUID)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  claimed RECORD;
BEGIN
  UPDATE public.one_time_prekeys
  SET used = true
  WHERE id = (
    SELECT id FROM public.one_time_prekeys
    WHERE user_id = target_user_id AND used = false
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING key_id, public_key INTO claimed;
  
  IF claimed IS NULL THEN
    RETURN NULL;
  END IF;
  
  RETURN jsonb_build_object('key_id', claimed.key_id, 'public_key', claimed.public_key);
END;
$$;

-- Auto-update updated_at for identity_keys
CREATE TRIGGER update_identity_keys_updated_at
  BEFORE UPDATE ON public.identity_keys
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
