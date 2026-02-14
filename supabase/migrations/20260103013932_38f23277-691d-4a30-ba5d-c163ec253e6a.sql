-- Make chat-files bucket public for images to display
UPDATE storage.buckets SET public = true WHERE id = 'chat-files';

-- Create blocked_users table for block feature
CREATE TABLE public.blocked_users (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  blocker_id UUID NOT NULL,
  blocked_id UUID NOT NULL,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(blocker_id, blocked_id, conversation_id)
);

-- Enable RLS
ALTER TABLE public.blocked_users ENABLE ROW LEVEL SECURITY;

-- RLS policies for blocked_users
CREATE POLICY "Users can view blocks in their conversations" 
ON public.blocked_users 
FOR SELECT 
USING (blocker_id = auth.uid() OR blocked_id = auth.uid());

CREATE POLICY "Users can insert their own blocks" 
ON public.blocked_users 
FOR INSERT 
WITH CHECK (blocker_id = auth.uid());

CREATE POLICY "Users can delete their own blocks" 
ON public.blocked_users 
FOR DELETE 
USING (blocker_id = auth.uid());

-- Enable realtime for blocked_users
ALTER PUBLICATION supabase_realtime ADD TABLE public.blocked_users;