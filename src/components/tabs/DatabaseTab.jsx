import React, { useState } from 'react';
import { FlaskConical, ClipboardList } from 'lucide-react';
import PaintDatabaseTab from './paint/PaintDatabaseTab';
import PurchaseLedgerTab from './PurchaseLedgerTab';

const SECTIONS = [
    { key: 'paint', label: '塗料データベース', Icon: FlaskConical },
    { key: 'purchase_ledger', label: '仕入帳データベース', Icon: ClipboardList },
];

const DatabaseTab = () => {
    const [activeSection, setActiveSection] = useState('paint');

    return (
        <div>
            <div className="flex gap-1 mb-4 border-b border-slate-200 overflow-x-auto">
                {SECTIONS.map(({ key, label, Icon }) => (
                    <button
                        key={key}
                        onClick={() => setActiveSection(key)}
                        className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-bold rounded-t-lg transition whitespace-nowrap border-b-2 -mb-px ${
                            activeSection === key
                                ? 'text-blue-600 border-blue-600 bg-blue-50/50'
                                : 'text-slate-500 border-transparent hover:text-slate-700 hover:bg-slate-50'
                        }`}
                    >
                        <Icon size={16} />
                        {label}
                    </button>
                ))}
            </div>

            {activeSection === 'paint' && <PaintDatabaseTab />}
            {activeSection === 'purchase_ledger' && <PurchaseLedgerTab />}
        </div>
    );
};

export default DatabaseTab;
