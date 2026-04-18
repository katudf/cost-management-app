export const calculateAge = (birthDateString) => {
    if (!birthDateString) return '-';
    const birthDate = new Date(birthDateString);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
        age--;
    }
    return age;
};

export const calculateTenure = (hireDateString, resignationDateString) => {
    if (!hireDateString) return '-';
    const hireDate = new Date(hireDateString);
    const endDate = resignationDateString ? new Date(resignationDateString) : new Date();
    
    let years = endDate.getFullYear() - hireDate.getFullYear();
    let months = endDate.getMonth() - hireDate.getMonth();
    
    if (months < 0 || (months === 0 && endDate.getDate() < hireDate.getDate())) {
        years--;
        months += 12;
    }
    
    // 日単位の調整
    if (endDate.getDate() < hireDate.getDate()) {
        months--;
        if (months < 0) {
            years--;
            months = 11;
        }
    }

    if (years === 0) return `${months}ヶ月`;
    if (months === 0) return `${years}年`;
    return `${years}年${months}ヶ月`;
};


// === 日付ヘルパー関数 (AssignmentChartTab / ScheduleViewApp 共通) ===

export const toDateStr = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
};

export const addDays = (d, n) => {
    const r = new Date(d);
    r.setDate(r.getDate() + n);
    return r;
};

export const getDayOfWeek = (d) => ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];

export const getMonday = (d) => {
    const date = new Date(d);
    const day = date.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    date.setDate(date.getDate() + diff);
    return date;
};
