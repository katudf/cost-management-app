import React, { useState, useEffect } from 'react';
import AdminApp from './AdminApp';
import WorkerApp from './WorkerApp';
import ScheduleViewApp from './ScheduleViewApp';
import InventoryApp from './InventoryApp';
import { ErrorBoundary } from './components/ErrorBoundary';

const App = () => {
    const [mode, setMode] = useState(null);

    useEffect(() => {
        const queryParams = new URLSearchParams(window.location.search);
        // ?mode=worker がURLにあればWorkerAppを表示
        if (queryParams.get('mode') === 'worker') {
            setMode('worker');
        } else if (queryParams.get('mode') === 'schedule') {
            setMode('schedule');
        } else if (queryParams.get('mode') === 'inventory') {
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

    return <ErrorBoundary><AdminApp /></ErrorBoundary>;
};

export default App;

