// 主要エンティティの共通型定義

export interface WorkerCertification {
    id: number;
    workerId: number;
    name: string;
    registrationNumber: string | null;
    acquisitionDate: string | null;
    expiryDate: string | null;
}

export interface Worker {
    id: number;
    name: string;
    kana?: string;
    role?: string;
    joined_date?: string | null;
    resignation_date?: string | null;
    certifications?: WorkerCertification[];
}

export interface Project {
    id: number;
    name?: string; // 内部オブジェクトで siteName を name としてマップすることがある
    siteName?: string; // DB上のフィールド名
    foreman_worker_id?: number | null;
    startDate: string;
    endDate: string;
    status: string;
    bar_color?: string | null;
    display_order?: number | null;
    customerId?: number | null;
    is_prime_contractor?: boolean;
    color?: string; // UI用
}

export interface Assignment {
    id: number | string; // temp- で始まる一時IDも許容するため string も可
    workerId: number;
    projectId: number | null;
    date: string;
    title: string | null;
    assignment_order: number;
}

export interface TaskRecord {
    id: number;
    project_id: number;
    worker_name: string;
    date: string;
}

export interface CompanyHoliday {
    id: number;
    date: string;
    description: string | null;
}

export interface ProjectSuspension {
    id: number;
    project_id: number;
    suspension_date: string;
}
