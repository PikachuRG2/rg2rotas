CREATE TABLE public.delivery_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  name text NOT NULL DEFAULT 'Rota',
  stops jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw_path jsonb NOT NULL DEFAULT '[]'::jsonb,
  snapped_path jsonb NOT NULL DEFAULT '[]'::jsonb,
  distance_m double precision NOT NULL DEFAULT 0,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.delivery_routes TO authenticated;
GRANT ALL ON public.delivery_routes TO service_role;
ALTER TABLE public.delivery_routes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own select" ON public.delivery_routes FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own insert" ON public.delivery_routes FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own update" ON public.delivery_routes FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own delete" ON public.delivery_routes FOR DELETE TO authenticated USING (auth.uid() = user_id);