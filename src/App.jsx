import React, { useState, useEffect } from 'react';
import AdminApp from './AdminApp';
import WorkerApp from './WorkerApp';

const App = () => {
    const [mode, setMode] = useState(null);

    useEffect(() => {
        const queryParams = new URLSearchParams(window.location.search);
        // ?mode=worker がURLにあればWorkerAppを表示
        if (queryParams.get('mode') === 'worker') {
            setMode('worker');
        } else {
            setMode('admin');
        }
    }, []);

    if (mode === null) {
        return null; // 判定中のチラつき防止
    }

    if (mode === 'worker') {
        return <WorkerApp />;
    }

    return <AdminApp />;
};

export default App;
