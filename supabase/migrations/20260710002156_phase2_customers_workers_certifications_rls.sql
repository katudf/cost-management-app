-- Customers
DROP POLICY "customers_authenticated_all" ON "Customers";

CREATE POLICY "customers_office_all" ON "Customers"
  FOR ALL TO authenticated
  USING (is_admin() OR current_staff_role() = 'office')
  WITH CHECK (is_admin() OR current_staff_role() = 'office');

-- WorkerCertifications
DROP POLICY "worker_certifications_authenticated_all" ON "WorkerCertifications";

CREATE POLICY "worker_certifications_office_all" ON "WorkerCertifications"
  FOR ALL TO authenticated
  USING (is_admin() OR current_staff_role() = 'office')
  WITH CHECK (is_admin() OR current_staff_role() = 'office');

-- Workers
DROP POLICY "workers_authenticated_all" ON "Workers";

CREATE POLICY "workers_office_all" ON "Workers"
  FOR ALL TO authenticated
  USING (is_admin() OR current_staff_role() = 'office')
  WITH CHECK (is_admin() OR current_staff_role() = 'office');

CREATE POLICY "workers_select_worker" ON "Workers"
  FOR SELECT TO authenticated
  USING (current_staff_role() = 'worker');
