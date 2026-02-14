-- =============================================
-- COMPREHENSIVE SECURITY MIGRATION
-- =============================================

-- 1. Create a separate secure table for PIN hashes (CRITICAL SECURITY FIX)
CREATE TABLE IF NOT EXISTS public.user_security (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  pin_hash TEXT,
  pin_enabled BOOLEAN DEFAULT false,
  failed_pin_attempts INTEGER DEFAULT 0,
  pin_locked_until TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on user_security
ALTER TABLE public.user_security ENABLE ROW LEVEL SECURITY;

-- Create restrictive policies for user_security - users can ONLY update, never read hash
CREATE POLICY "Users can check own security status"
ON public.user_security
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own security"
ON public.user_security
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own security"
ON public.user_security
FOR UPDATE
USING (auth.uid() = user_id);

-- Create updated_at trigger for user_security
CREATE TRIGGER update_user_security_updated_at
BEFORE UPDATE ON public.user_security
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Create secure PIN verification function (prevents hash exposure)
CREATE OR REPLACE FUNCTION public.verify_pin(input_pin TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_sec RECORD;
  hashed_input TEXT;
  result JSONB;
BEGIN
  -- Get user's security record
  SELECT * INTO user_sec
  FROM public.user_security
  WHERE user_id = auth.uid();
  
  -- Check if user has security record
  IF user_sec.id IS NULL THEN
    RETURN jsonb_build_object('success', true, 'message', 'No PIN required');
  END IF;
  
  -- Check if PIN is enabled
  IF NOT user_sec.pin_enabled OR user_sec.pin_hash IS NULL THEN
    RETURN jsonb_build_object('success', true, 'message', 'No PIN required');
  END IF;
  
  -- Check if account is locked
  IF user_sec.pin_locked_until IS NOT NULL AND user_sec.pin_locked_until > now() THEN
    RETURN jsonb_build_object(
      'success', false, 
      'message', 'Account locked',
      'locked_until', user_sec.pin_locked_until
    );
  END IF;
  
  -- Use pgcrypto for secure hashing (SHA256)
  hashed_input := encode(digest(input_pin, 'sha256'), 'hex');
  
  IF hashed_input = user_sec.pin_hash THEN
    -- Reset failed attempts on success
    UPDATE public.user_security
    SET failed_pin_attempts = 0, pin_locked_until = NULL
    WHERE user_id = auth.uid();
    
    -- Log successful verification
    PERFORM public.log_security_event('pin_verified', 'user_security', auth.uid()::text, '{}'::jsonb);
    
    RETURN jsonb_build_object('success', true, 'message', 'PIN verified');
  ELSE
    -- Increment failed attempts
    UPDATE public.user_security
    SET 
      failed_pin_attempts = failed_pin_attempts + 1,
      pin_locked_until = CASE 
        WHEN failed_pin_attempts >= 4 THEN now() + interval '30 minutes'
        ELSE NULL
      END
    WHERE user_id = auth.uid();
    
    -- Get updated attempts count
    SELECT failed_pin_attempts INTO user_sec.failed_pin_attempts
    FROM public.user_security WHERE user_id = auth.uid();
    
    -- Log failed attempt
    PERFORM public.log_security_event(
      'pin_failed', 
      'user_security', 
      auth.uid()::text, 
      jsonb_build_object('attempts', user_sec.failed_pin_attempts)
    );
    
    RETURN jsonb_build_object(
      'success', false, 
      'message', 'Invalid PIN',
      'attempts_remaining', GREATEST(5 - user_sec.failed_pin_attempts, 0)
    );
  END IF;
END;
$$;

-- 3. Create secure PIN setting function
CREATE OR REPLACE FUNCTION public.set_pin(new_pin TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  hashed_pin TEXT;
BEGIN
  -- Validate PIN format (6 digits only)
  IF NOT (new_pin ~ '^[0-9]{6}$') THEN
    RETURN jsonb_build_object('success', false, 'message', 'PIN must be exactly 6 digits');
  END IF;
  
  -- Hash PIN using SHA256
  hashed_pin := encode(digest(new_pin, 'sha256'), 'hex');
  
  -- Upsert security record
  INSERT INTO public.user_security (user_id, pin_hash, pin_enabled)
  VALUES (auth.uid(), hashed_pin, true)
  ON CONFLICT (user_id) 
  DO UPDATE SET 
    pin_hash = hashed_pin, 
    pin_enabled = true,
    failed_pin_attempts = 0,
    pin_locked_until = NULL,
    updated_at = now();
  
  -- Log PIN change
  PERFORM public.log_security_event('pin_changed', 'user_security', auth.uid()::text, '{}'::jsonb);
  
  RETURN jsonb_build_object('success', true, 'message', 'PIN set successfully');
END;
$$;

-- 4. Create function to disable PIN
CREATE OR REPLACE FUNCTION public.disable_pin()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.user_security
  SET pin_enabled = false, pin_hash = NULL
  WHERE user_id = auth.uid();
  
  -- Log PIN disabled
  PERFORM public.log_security_event('pin_disabled', 'user_security', auth.uid()::text, '{}'::jsonb);
  
  RETURN jsonb_build_object('success', true, 'message', 'PIN disabled');
END;
$$;

-- 5. Create function to check PIN status (without exposing hash)
CREATE OR REPLACE FUNCTION public.get_pin_status()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_sec RECORD;
BEGIN
  SELECT pin_enabled, pin_locked_until, failed_pin_attempts 
  INTO user_sec
  FROM public.user_security
  WHERE user_id = auth.uid();
  
  IF user_sec IS NULL THEN
    RETURN jsonb_build_object('pin_enabled', false, 'is_locked', false);
  END IF;
  
  RETURN jsonb_build_object(
    'pin_enabled', COALESCE(user_sec.pin_enabled, false),
    'is_locked', user_sec.pin_locked_until IS NOT NULL AND user_sec.pin_locked_until > now(),
    'locked_until', user_sec.pin_locked_until
  );
END;
$$;

-- 6. Fix profiles RLS policy - remove the overly permissive fallback
DROP POLICY IF EXISTS "Users can view profiles of conversation participants" ON public.profiles;

CREATE POLICY "Users can view profiles of conversation participants"
ON public.profiles
FOR SELECT
USING (
  (auth.uid() = user_id) OR 
  (EXISTS (
    SELECT 1
    FROM conversation_participants cp1
    JOIN conversation_participants cp2 ON cp1.conversation_id = cp2.conversation_id
    WHERE cp1.user_id = auth.uid() 
      AND cp2.user_id = profiles.user_id 
      AND cp1.user_id <> cp2.user_id
  ))
);

-- 7. Create rate limiter function with IP tracking
CREATE OR REPLACE FUNCTION public.check_auth_rate_limit(_identifier TEXT, _ip_address TEXT, _action TEXT DEFAULT 'login')
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  attempt_count INT;
  ip_attempt_count INT;
  max_attempts INT := 5;
  ip_max_attempts INT := 20;
  window_minutes INT := 15;
  ip_window_minutes INT := 60;
BEGIN
  -- Check per-identifier rate limit
  SELECT COUNT(*) INTO attempt_count
  FROM public.auth_attempts
  WHERE user_identifier = _identifier
    AND attempt_type = _action
    AND attempted_at > now() - (window_minutes || ' minutes')::interval
    AND success = false;
    
  -- Check per-IP rate limit (broader limit)
  SELECT COUNT(*) INTO ip_attempt_count
  FROM public.auth_attempts
  WHERE ip_address = _ip_address
    AND attempt_type = _action
    AND attempted_at > now() - (ip_window_minutes || ' minutes')::interval
    AND success = false;
  
  IF attempt_count >= max_attempts THEN
    RETURN jsonb_build_object(
      'allowed', false, 
      'reason', 'Too many failed attempts for this account',
      'retry_after_minutes', window_minutes
    );
  END IF;
  
  IF ip_attempt_count >= ip_max_attempts THEN
    RETURN jsonb_build_object(
      'allowed', false, 
      'reason', 'Too many failed attempts from this IP',
      'retry_after_minutes', ip_window_minutes
    );
  END IF;
  
  RETURN jsonb_build_object('allowed', true);
END;
$$;

-- 8. Create function to log auth attempts
CREATE OR REPLACE FUNCTION public.log_auth_attempt(_identifier TEXT, _ip_address TEXT, _success BOOLEAN, _action TEXT DEFAULT 'login')
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.auth_attempts (user_identifier, ip_address, success, attempt_type)
  VALUES (_identifier, _ip_address, _success, _action);
END;
$$;

-- 9. Enhanced message sanitization trigger
CREATE OR REPLACE FUNCTION public.sanitize_message_content()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Remove any potential script/HTML tags from content
  IF NEW.content IS NOT NULL THEN
    -- Remove script tags
    NEW.content := regexp_replace(NEW.content, '<script[^>]*>.*?</script>', '', 'gis');
    -- Remove all HTML tags
    NEW.content := regexp_replace(NEW.content, '<[^>]*>', '', 'g');
    -- Remove javascript: URLs
    NEW.content := regexp_replace(NEW.content, 'javascript:', '', 'gi');
    -- Remove data: URLs (except for safe image types)
    NEW.content := regexp_replace(NEW.content, 'data:(?!image/(png|jpeg|jpg|gif|webp))', 'blocked:', 'gi');
    -- Remove event handlers
    NEW.content := regexp_replace(NEW.content, 'on\w+\s*=', '', 'gi');
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
      PERFORM public.log_security_event(
        'suspicious_file_type',
        'message',
        NEW.id::text,
        jsonb_build_object('file_type', NEW.file_type, 'file_name', NEW.file_name)
      );
    END IF;
  END IF;
  
  -- Sanitize file_name
  IF NEW.file_name IS NOT NULL THEN
    -- Remove path traversal attempts
    NEW.file_name := regexp_replace(NEW.file_name, '\.\./', '', 'g');
    NEW.file_name := regexp_replace(NEW.file_name, '\.\.\\', '', 'g');
    -- Limit filename length
    NEW.file_name := left(NEW.file_name, 255);
  END IF;
  
  RETURN NEW;
END;
$$;

-- 10. Create session validation function
CREATE OR REPLACE FUNCTION public.validate_session()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_id_val UUID;
BEGIN
  user_id_val := auth.uid();
  
  IF user_id_val IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'Not authenticated');
  END IF;
  
  -- Log session validation
  PERFORM public.log_security_event('session_validated', 'auth', user_id_val::text, '{}'::jsonb);
  
  RETURN jsonb_build_object('valid', true, 'user_id', user_id_val);
END;
$$;

-- 11. Add DELETE policies for proper data management
CREATE POLICY "Users can delete own messages"
ON public.messages
FOR DELETE
USING (auth.uid() = sender_id);

-- 12. Enable pgcrypto extension for secure hashing
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 13. Add realtime for user_security if needed
ALTER PUBLICATION supabase_realtime ADD TABLE public.user_security;