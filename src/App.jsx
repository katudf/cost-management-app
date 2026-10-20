import React, { useState, useEffect } from 'react';
import AdminApp from './AdminApp';
import WorkerApp from './WorkerApp';
import ScheduleViewApp from './ScheduleViewApp';
import InventoryApp from './InventoryApp';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AuthProvider } from './hooks/useAuth';

const App = () => {
    const [mode, setMode] = useState(null);

    useEffect(() => {
        const queryParams = new URLSearchParams(window.location.search);
        const queryMode = queryParams.get('mode');
        // worker.html / inventory.html / schedule.html から開いた場合はホーム画面アイコン用に専用モード固定
        // （PWAとしてインストールした際に正しいアイコン・マニフェストのエントリから起動するため）
        const path = window.location.pathname;

        if (queryMode === 'worker' || path.endsWith('/worker.html')) {
            setMode('worker');
        } else if (queryMode === 'schedule' || path.endsWith('/schedule.html')) {
            // 旧形式の共有URL（/?mode=schedule&key=…）は専用エントリへ移す。
            // index.html のままだとホーム画面追加時に管理者用マニフェスト（start_url: /）が使われてしまう
            if (!path.endsWith('/schedule.html')) {
                queryParams.delete('mode');
                const qs = queryParams.toString();
                window.location.replace(`/schedule.html${qs ? `?${qs}` : ''}`);
                return;
            }
            setMode('schedule');
        } else if (queryMode === 'inventory' || path.endsWith('/inventory.html')) {
            setMode('inventory');
        } else {
            setMode('admin');
        }
    }, []);

    if (mode === null) {
        return null; // 判定中のチラつき防止
    }

    if (mode === 'worker') {
        return <ErrorBoundary><AuthProvider><WorkerApp /></AuthProvider></ErrorBoundary>;
    }

    if (mode === 'schedule') {
        return <ErrorBoundary><AuthProvider><ScheduleViewApp /></AuthProvider></ErrorBoundary>;
    }

    if (mode === 'inventory') {
        return <ErrorBoundary><AuthProvider><InventoryApp /></AuthProvider></ErrorBoundary>;
    }

    return <ErrorBoundary><AuthProvider><AdminApp /></AuthProvider></ErrorBoundary>;
};

export default App;

