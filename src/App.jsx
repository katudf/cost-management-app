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
        // worker.html / inventory.html から開いた場合はホーム画面アイコン用に専用モード固定
        // （PWAとしてインストールした際に正しいアイコン・マニフェストのエントリから起動するため）
        const path = window.location.pathname;

        if (queryMode === 'worker' || path.endsWith('/worker.html')) {
            setMode('worker');
        } else if (queryMode === 'schedule') {
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
        return <ErrorBoundary><WorkerApp /></ErrorBoundary>;
    }

    if (mode === 'schedule') {
        return <ErrorBoundary><ScheduleViewApp /></ErrorBoundary>;
    }

    if (mode === 'inventory') {
        return <ErrorBoundary><InventoryApp /></ErrorBoundary>;
    }

    return <ErrorBoundary><AuthProvider><AdminApp /></AuthProvider></ErrorBoundary>;
};

export default App;

