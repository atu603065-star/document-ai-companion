-- Add RLS policy for messages UPDATE (for delete/revoke functionality)
CREATE POLICY "Users can update their own messages"
ON public.messages
FOR UPDATE
USING (auth.uid() = sender_id);

-- Create user_settings table for PIN code and preferences
CREATE TABLE public.user_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  pin_hash TEXT,
  pin_enabled BOOLEAN DEFAULT false,
  theme TEXT DEFAULT 'dark',
  sound_enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on user_settings
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

-- Users can only view/update their own settings
CREATE POLICY "Users can view their own settings"
ON public.user_settings
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own settings"
ON public.user_settings
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own settings"
ON public.user_settings
FOR UPDATE
USING (auth.uid() = user_id);

-- Add trigger for updated_at on user_settings
CREATE TRIGGER update_user_settings_updated_at
BEFORE UPDATE ON public.user_settings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Add deleted_conversations table to track hidden conversations per user
CREATE TABLE public.deleted_conversations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, conversation_id)
);

-- Enable RLS on deleted_conversations
ALTER TABLE public.deleted_conversations ENABLE ROW LEVEL SECURITY;

-- Users can manage their own deleted conversations
CREATE POLICY "Users can view their deleted conversations"
ON public.deleted_conversations
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their deleted conversations"
ON public.deleted_conversations
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their deleted conversations"
ON public.deleted_conversations
FOR DELETE
USING (auth.uid() = user_id);

-- Add nickname column to conversation_participants
ALTER TABLE public.conversation_participants
ADD COLUMN nickname TEXT;

-- Add policy for updating conversation_participants (for nickname)
CREATE POLICY "Users can update their own participant records"
ON public.conversation_participants
FOR UPDATE
USING (auth.uid() = user_id);

-- Enable realtime for user_settings
ALTER PUBLICATION supabase_realtime ADD TABLE public.user_settings;