-- Private temporary PDFs: each staff member can access only their own prefix.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('estimate-pdf-previews', 'estimate-pdf-previews', false, 52428800, ARRAY['application/pdf'])
ON CONFLICT (id) DO NOTHING;
CREATE POLICY estimate_pdf_previews_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'estimate-pdf-previews' AND (storage.foldername(name))[1] = auth.uid()::text AND COALESCE(public.is_admin() OR public.current_staff_role()='office', false));
CREATE POLICY estimate_pdf_previews_select ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'estimate-pdf-previews' AND (storage.foldername(name))[1] = auth.uid()::text AND COALESCE(public.is_admin() OR public.current_staff_role()='office', false));
CREATE POLICY estimate_pdf_previews_delete ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'estimate-pdf-previews' AND (storage.foldername(name))[1] = auth.uid()::text AND COALESCE(public.is_admin() OR public.current_staff_role()='office', false));
