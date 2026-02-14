
-- Create function to permanently delete expired messages (older than 24h)
-- This deletes actual rows from the database, not just marking as deleted
CREATE OR REPLACE FUNCTION public.cleanup_expired_messages()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  deleted_count INTEGER;
  deleted_files TEXT[];
BEGIN
  -- Collect file URLs before deleting (for storage cleanup)
  SELECT ARRAY_AGG(file_url) INTO deleted_files
  FROM public.messages m
  INNER JOIN public.conversation_settings cs ON cs.conversation_id = m.conversation_id
  WHERE cs.auto_delete_24h = true
    AND m.created_at < now() - interval '24 hours'
    AND m.type != 'system'
    AND m.file_url IS NOT NULL;

  -- Permanently DELETE expired messages from conversations with auto_delete_24h enabled
  DELETE FROM public.messages m
  USING public.conversation_settings cs
  WHERE cs.conversation_id = m.conversation_id
    AND cs.auto_delete_24h = true
    AND m.created_at < now() - interval '24 hours'
    AND m.type != 'system';
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'deleted_count', deleted_count,
    'deleted_files_count', COALESCE(array_length(deleted_files, 1), 0)
  );
END;
$$;
