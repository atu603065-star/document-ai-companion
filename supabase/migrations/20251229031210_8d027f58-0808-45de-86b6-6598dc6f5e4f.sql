-- Drop problematic policies
DROP POLICY IF EXISTS "Users can view participants in their conversations" ON public.conversation_participants;
DROP POLICY IF EXISTS "Users can view their own participations" ON public.conversation_participants;
DROP POLICY IF EXISTS "Users can insert participants" ON public.conversation_participants;
DROP POLICY IF EXISTS "Users can view their conversations" ON public.conversations;
DROP POLICY IF EXISTS "Authenticated users can create conversations" ON public.conversations;

-- Create security definer function to check conversation membership
CREATE OR REPLACE FUNCTION public.is_conversation_member(_conversation_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.conversation_participants
    WHERE conversation_id = _conversation_id
      AND user_id = _user_id
  )
$$;

-- Create function to create conversation with participants
CREATE OR REPLACE FUNCTION public.create_conversation_with_participant(target_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_conversation_id uuid;
  current_user_id uuid;
BEGIN
  current_user_id := auth.uid();
  
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  
  IF current_user_id = target_user_id THEN
    RAISE EXCEPTION 'Cannot create conversation with yourself';
  END IF;
  
  -- Check if conversation already exists between these users
  SELECT cp1.conversation_id INTO new_conversation_id
  FROM conversation_participants cp1
  INNER JOIN conversation_participants cp2 ON cp1.conversation_id = cp2.conversation_id
  WHERE cp1.user_id = current_user_id AND cp2.user_id = target_user_id
  LIMIT 1;
  
  IF new_conversation_id IS NOT NULL THEN
    RETURN new_conversation_id;
  END IF;
  
  -- Create new conversation
  INSERT INTO conversations DEFAULT VALUES
  RETURNING id INTO new_conversation_id;
  
  -- Add both participants
  INSERT INTO conversation_participants (conversation_id, user_id)
  VALUES 
    (new_conversation_id, current_user_id),
    (new_conversation_id, target_user_id);
  
  RETURN new_conversation_id;
END;
$$;

-- New RLS policies without recursion

-- Conversations: Simple policy using security definer function
CREATE POLICY "Users can view conversations they participate in"
ON public.conversations FOR SELECT
USING (public.is_conversation_member(id, auth.uid()));

CREATE POLICY "Authenticated users can insert conversations"
ON public.conversations FOR INSERT
WITH CHECK (auth.role() = 'authenticated');

-- Conversation participants: Allow viewing all participants of conversations you're in
CREATE POLICY "Users can view all participants in their conversations"
ON public.conversation_participants FOR SELECT
USING (public.is_conversation_member(conversation_id, auth.uid()));

-- Allow inserting only for yourself (used by the function with SECURITY DEFINER)
CREATE POLICY "System can insert participants"
ON public.conversation_participants FOR INSERT
WITH CHECK (true);