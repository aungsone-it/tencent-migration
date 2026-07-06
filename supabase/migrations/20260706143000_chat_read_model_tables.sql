-- Normalized chat read-model (dual-written from KV on each message POST).
-- Source of truth for writes remains kv_store_16010b6f; these tables power
-- indexed history reads and cross-device consistency checks.

CREATE TABLE IF NOT EXISTS public.app_chat_conversations (
  id text PRIMARY KEY,
  source_kv_key text UNIQUE,
  customer_email text,
  customer_name text,
  customer_profile_image text,
  vendor_id text,
  vendor_source text,
  last_message text,
  unread integer NOT NULL DEFAULT 0,
  starred boolean NOT NULL DEFAULT false,
  status text,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_message_at timestamptz,
  synced_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_chat_conversations_email
  ON public.app_chat_conversations (lower(customer_email));

CREATE INDEX IF NOT EXISTS idx_app_chat_conversations_vendor_email
  ON public.app_chat_conversations (vendor_id, lower(customer_email));

CREATE TABLE IF NOT EXISTS public.app_chat_messages (
  id text PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES public.app_chat_conversations(id) ON DELETE CASCADE,
  source_kv_key text UNIQUE,
  sender text,
  sender_name text,
  text text,
  image_url text,
  status text,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  message_at timestamptz,
  synced_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_chat_messages_conversation_at
  ON public.app_chat_messages (conversation_id, message_at);
