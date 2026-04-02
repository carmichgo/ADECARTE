-- Add fraudulent_signature column to transactions
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS fraudulent_signature BOOLEAN DEFAULT NULL;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS documents JSONB DEFAULT '[]';

-- Create storage buckets (run these in Supabase Dashboard > Storage > New Bucket)
-- Bucket 1: "transaction-documents" (public: false)
-- Bucket 2: "reference-signatures" (public: false)

-- Or create via SQL:
INSERT INTO storage.buckets (id, name, public) VALUES ('transaction-documents', 'transaction-documents', false) ON CONFLICT DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('reference-signatures', 'reference-signatures', false) ON CONFLICT DO NOTHING;

-- Allow service role to access buckets (already has access by default with service_role key)
