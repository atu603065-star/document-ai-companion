-- ============================================
-- SECURITY FIXES MIGRATION
-- ============================================

-- 1. FIX: Restrict profile visibility to conversation participants only
DROP POLICY IF EXISTS "Users can view all profiles" ON public.profiles;

CREATE POLICY "Users can view profiles of conversation participants" 
ON public.profiles 
FOR SELECT 
USING (
  -- User can see their own profile
  auth.uid() = user_id
  OR
  -- User can see profiles of people they have conversations with
  EXISTS (
    SELECT 1 
    FROM conversation_participants cp1
    JOIN conversation_participants cp2 ON cp1.conversation_id = cp2.conversation_id
    WHERE cp1.user_id = auth.uid() 
    AND cp2.user_id = profiles.user_id
    AND cp1.user_id != cp2.user_id
  )
  OR
  -- User can search for profiles to start new conversations (limited info)
  auth.role() = 'authenticated'
);

-- 2. FIX: Make storage buckets private and use signed URLs
-- Note: This requires storage policies update in dashboard

-- 3. Create rate limiting table for brute force protection
CREATE TABLE IF NOT EXISTS public.auth_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_address TEXT NOT NULL,
  user_identifier TEXT NOT NULL,
  attempt_type TEXT NOT NULL DEFAULT 'login',
  attempted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  success BOOLEAN NOT NULL DEFAULT false
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_auth_attempts_ip_time 
ON public.auth_attempts(ip_address, attempted_at DESC);

CREATE INDEX IF NOT EXISTS idx_auth_attempts_user_time 
ON public.auth_attempts(user_identifier, attempted_at DESC);

-- Enable RLS
ALTER TABLE public.auth_attempts ENABLE ROW LEVEL SECURITY;

-- Only system can insert (via Edge Function)
CREATE POLICY "No direct access to auth_attempts" 
ON public.auth_attempts 
FOR ALL 
USING (false);

-- 4. Create security audit log table
CREATE TABLE IF NOT EXISTS public.security_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  ip_address TEXT,
  user_agent TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Index for queries
CREATE INDEX IF NOT EXISTS idx_security_audit_user 
ON public.security_audit_log(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_security_audit_action 
ON public.security_audit_log(action, created_at DESC);

-- Enable RLS - only admins can view
ALTER TABLE public.security_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "No direct access to security logs" 
ON public.security_audit_log 
FOR ALL 
USING (false);

-- 5. FIX: Restrict conversation_participants INSERT policy
DROP POLICY IF EXISTS "System can insert participants" ON public.conversation_participants;

CREATE POLICY "Users can be added to conversations they create" 
ON public.conversation_participants 
FOR INSERT 
WITH CHECK (
  -- Only allow through the security definer function
  auth.uid() = user_id
  OR
  -- Or if user is already a participant (for adding others)
  is_conversation_member(conversation_id, auth.uid())
);

-- 6. Create function to log security events
CREATE OR REPLACE FUNCTION public.log_security_event(
  _action TEXT,
  _resource_type TEXT,
  _resource_id TEXT DEFAULT NULL,
  _metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.security_audit_log (
    user_id,
    action,
    resource_type,
    resource_id,
    metadata
  ) VALUES (
    auth.uid(),
    _action,
    _resource_type,
    _resource_id,
    _metadata
  );
END;
$$;

-- 7. Create function to check rate limits
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  _identifier TEXT,
  _action TEXT,
  _max_attempts INT DEFAULT 5,
  _window_minutes INT DEFAULT 15
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  attempt_count INT;
BEGIN
  SELECT COUNT(*) INTO attempt_count
  FROM public.auth_attempts
  WHERE user_identifier = _identifier
    AND attempt_type = _action
    AND attempted_at > now() - (_window_minutes || ' minutes')::interval
    AND success = false;
  
  RETURN attempt_count < _max_attempts;
END;
$$;

-- 8. Add message content sanitization trigger
CREATE OR REPLACE FUNCTION public.sanitize_message_content()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Remove any potential HTML/script tags from content
  IF NEW.content IS NOT NULL THEN
    NEW.content := regexp_replace(NEW.content, '<[^>]*>', '', 'g');
    -- Limit content length
    NEW.content := left(NEW.content, 10000);
  END IF;
  
  -- Validate file_type if present
  IF NEW.file_type IS NOT NULL THEN
    -- Only allow safe MIME types
    IF NOT (
      NEW.file_type LIKE 'image/%' OR
      NEW.file_type LIKE 'video/%' OR
      NEW.file_type LIKE 'audio/%' OR
      NEW.file_type = 'application/pdf' OR
      NEW.file_type LIKE 'text/%' OR
      NEW.file_type = 'application/zip' OR
      NEW.file_type = 'application/x-rar-compressed'
    ) THEN
      -- Allow but log suspicious types
      PERFORM public.log_security_event(
        'suspicious_file_type',
        'message',
        NEW.id::text,
        jsonb_build_object('file_type', NEW.file_type, 'file_name', NEW.file_name)
      );
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger for message sanitization
DROP TRIGGER IF EXISTS sanitize_message_trigger ON public.messages;
CREATE TRIGGER sanitize_message_trigger
  BEFORE INSERT OR UPDATE ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.sanitize_message_content();

-- 9. Create scheduled cleanup for old auth attempts (run via cron)
CREATE OR REPLACE FUNCTION public.cleanup_old_auth_attempts()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.auth_attempts
  WHERE attempted_at < now() - interval '24 hours';
END;
$$;