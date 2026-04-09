| ddl                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| -- Table: CompanyHolidays
CREATE TABLE public.CompanyHolidays (
  id int8 NOT NULL,
  created_at timestamptz NOT NULL,
  date date NOT NULL,
  description text
);
                                                                                                                                                                                                                                              |
| -- Table: Customers
CREATE TABLE public.Customers (
  id int8 NOT NULL,
  created_at timestamptz NOT NULL,
  name text,
  address text,
  contactPerson text,
  phone text
);
                                                                                                                                                                                                                                   |
| -- Table: Materials
CREATE TABLE public.Materials (
  id int8 NOT NULL,
  created_at timestamptz NOT NULL,
  name text,
  category text,
  unit text,
  unitPrice int8,
  colorInfo text,
  packagingOptions jsonb,
  size int8,
  Standardusageamount float4
);
                                                                                                                                                |
| -- Table: DailyReports
CREATE TABLE public.DailyReports (
  id int8 NOT NULL,
  created_at timestamptz NOT NULL,
  workerId int8,
  date date,
  weather text,
  generalComments text,
  materialsTakenOut text
);
                                                                                                                                                                                              |
| -- Table: ProjectTasks
CREATE TABLE public.ProjectTasks (
  id int8 NOT NULL,
  created_at timestamptz NOT NULL,
  startDate date,
  endDate date,
  order int8,
  status text,
  projectId int8,
  serviceMasterId int8,
  target_hours int8,
  progress_percentage int8,
  name text,
  estimated_amount numeric NOT NULL
);
                                                                                  |
| -- Table: ServiceMaster
CREATE TABLE public.ServiceMaster (
  id int8 NOT NULL,
  created_at timestamptz NOT NULL,
  name text,
  category text,
  defaultUnitPrice int8,
  unit text
);
                                                                                                                                                                                                                        |
| -- Table: WorkerCertifications
CREATE TABLE public.WorkerCertifications (
  id int8 NOT NULL,
  created_at timestamptz NOT NULL,
  workerId int8,
  name text,
  acquisitionDate date,
  expiryDate date
);
                                                                                                                                                                                                     |
| -- Table: Assignments
CREATE TABLE public.Assignments (
  id int8 NOT NULL,
  created_at timestamptz,
  projectTaskId int8,
  workerId int8,
  date date,
  projectId int8,
  title text,
  assignment_order int8
);
                                                                                                                                                                                            |
| -- Table: Projects
CREATE TABLE public.Projects (
  id int8 NOT NULL,
  created_at timestamptz NOT NULL,
  name text,
  order int8 NOT NULL,
  startDate date,
  endDate date,
  estimatedAmount int8,
  finalAmount int8,
  taxAmount int8,
  isPaid bool,
  estimatePdfUrl text,
  contractPdfUrl text,
  status text,
  customerId int8,
  display_order int8,
  bar_color text,
  foreman_worker_id int8
);
 |
| -- Table: MaterialUsageLogs
CREATE TABLE public.MaterialUsageLogs (
  id int8 NOT NULL,
  created_at timestamptz NOT NULL,
  dailyReportId int8,
  materialId int8,
  quantityUsed float8
);
                                                                                                                                                                                                                    |
| -- Table: WorkLogs
CREATE TABLE public.WorkLogs (
  id int8 NOT NULL,
  created_at timestamptz NOT NULL,
  dailyReportId int8,
  projectTaskId int8,
  startTime time,
  endTime time
);
                                                                                                                                                                                                                        |
| -- Table: Workers
CREATE TABLE public.Workers (
  id int8 NOT NULL,
  created_at timestamptz NOT NULL,
  name text,
  order int8,
  birthDate date,
  hireDate date,
  address text,
  contactInfo text,
  cpdsNumber text,
  kana text,
  display_order int8,
  resignation_date date
);
                                                                                                                                                |
| -- Table: TaskRecords
CREATE TABLE public.TaskRecords (
  id int8 NOT NULL,
  created_at timestamptz NOT NULL,
  date date NOT NULL,
  project_id int8 NOT NULL,
  project_task_id int8 NOT NULL,
  worker_name text NOT NULL,
  hours float8 NOT NULL,
  note text,
  overtime_hours numeric NOT NULL
);
                                                                                                       |
| -- Table: system_settings
CREATE TABLE public.system_settings (
  id int4 NOT NULL,
  hourly_wage int4 NOT NULL,
  updated_at timestamptz NOT NULL
);
                                                                                                                                                                                                                                                           |
| -- Table: SubcontractorRecords
CREATE TABLE public.SubcontractorRecords (
  id uuid NOT NULL,
  project_id int4 NOT NULL,
  date date NOT NULL,
  company_name text NOT NULL,
  worker_count numeric NOT NULL,
  unit_price numeric NOT NULL,
  worker_name text,
  created_at timestamptz NOT NULL
);
                                                                                                          |