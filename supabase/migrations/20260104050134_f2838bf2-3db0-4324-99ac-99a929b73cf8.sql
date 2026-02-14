-- Create user_storage table for storing user files
CREATE TABLE public.user_storage (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  file_url text NOT NULL,
  file_name text NOT NULL,
  file_type text NOT NULL,
  file_size bigint NOT NULL DEFAULT 0,
  storage_type text NOT NULL DEFAULT 'file', -- 'image', 'video', 'file'
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.user_storage ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can view their own storage files"
ON public.user_storage
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own storage files"
ON public.user_storage
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own storage files"
ON public.user_storage
FOR DELETE
USING (auth.uid() = user_id);

-- Create storage bucket for user storage
INSERT INTO storage.buckets (id, name, public)
VALUES ('user-storage', 'user-storage', true)
ON CONFLICT (id) DO NOTHING;

-- Enable realtime for user_storage
ALTER PUBLICATION supabase_realtime ADD TABLE public.user_storage;