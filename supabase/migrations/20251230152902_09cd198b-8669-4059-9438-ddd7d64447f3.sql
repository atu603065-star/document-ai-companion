-- Add new columns to messages table for delete/revoke functionality
ALTER TABLE public.messages 
ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS is_revoked BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS deleted_for_user_ids UUID[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'text' CHECK (type IN ('text', 'image', 'file', 'system'));

-- Create conversation_settings table for 24h auto-delete toggle
CREATE TABLE IF NOT EXISTS public.conversation_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  auto_delete_24h BOOLEAN DEFAULT true,
  auto_delete_pending_from UUID DEFAULT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(conversation_id)
);

-- Enable RLS on conversation_settings
ALTER TABLE public.conversation_settings ENABLE ROW LEVEL SECURITY;

-- RLS policies for conversation_settings
CREATE POLICY "Users can view settings for their conversations"
ON public.conversation_settings FOR SELECT
USING (public.is_conversation_member(conversation_id, auth.uid()));

CREATE POLICY "Users can update settings for their conversations"
ON public.conversation_settings FOR UPDATE
USING (public.is_conversation_member(conversation_id, auth.uid()));

CREATE POLICY "Users can insert settings for their conversations"
ON public.conversation_settings FOR INSERT
WITH CHECK (public.is_conversation_member(conversation_id, auth.uid()));

-- Create message_reads table for tracking read status
CREATE TABLE IF NOT EXISTS public.message_reads (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  last_read_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  last_read_message_id UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  UNIQUE(conversation_id, user_id)
);

-- Enable RLS on message_reads
ALTER TABLE public.message_reads ENABLE ROW LEVEL SECURITY;

-- RLS policies for message_reads
CREATE POLICY "Users can view their own read status"
ON public.message_reads FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own read status"
ON public.message_reads FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own read status"
ON public.message_reads FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Add foreign key from conversation_participants to profiles
ALTER TABLE public.conversation_participants
ADD COLUMN IF NOT EXISTS profile_id UUID REFERENCES public.profiles(id);

-- Update existing records to link profile_id (if any exist)
UPDATE public.conversation_participants cp
SET profile_id = p.id
FROM public.profiles p
WHERE cp.user_id = p.user_id AND cp.profile_id IS NULL;

-- Create trigger to update updated_at for conversation_settings
CREATE TRIGGER update_conversation_settings_updated_at
BEFORE UPDATE ON public.conversation_settings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime for messages, message_reads, and conversation_settings
ALTER PUBLICATION supabase_realtime ADD TABLE public.message_reads;
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_settings;