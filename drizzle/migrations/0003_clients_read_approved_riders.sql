DROP POLICY IF EXISTS "all read clients" ON public.clients;
CREATE POLICY "approved riders read clients" ON public.clients
FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'user'::app_role) OR public.has_role(auth.uid(), 'admin'::app_role));