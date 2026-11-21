import React, { useState } from 'react';
import { DEFAULT_KEYS } from './api';
import { StatusBanner } from './components/StatusBanner';
import { PaymentsTable } from './components/PaymentsTable';
import { RoutingEditor } from './components/RoutingEditor';
import { WebhookLog } from './components/WebhookLog';
import { InvoiceList } from './components/InvoiceList';
import { RbacManager } from './components/RbacManager';

const TABS = [
  { id: 'payments', label: 'Payments & Simulator' },
  { id: 'routing', label: 'Smart Routing & Chaos' },
  { id: 'webhooks', label: 'Webhooks & Replay' },
  { id: 'invoices', label: 'Invoices & Billing' },
  { id: 'rbac', label: 'RBAC & API Keys' },
];

export default function App() {
  const [mode, setMode] = useState('test');
  const [activeTab, setActiveTab] = useState('payments');
  const [customKey, setCustomKey] = useState('');

  const effectiveKey = customKey.trim() || DEFAULT_KEYS[mode];

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <StatusBanner mode={mode} />

      <header
        style={{
          padding: '1rem 2rem',
          background: '#1e293b',
          borderBottom: '1px solid #334155',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '1rem',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <h1 style={{ margin: 0, fontSize: '1.25rem' }}>PayOps Control Center</h1>
          <a
            href="http://localhost:3000/api-docs"
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: '0.82rem', color: '#38bdf8', textDecoration: 'none' }}
          >
            Swagger Sandbox ↗
          </a>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="password"
            placeholder={`Default: ${DEFAULT_KEYS[mode].slice(0, 14)}...`}
            value={customKey}
            onChange={(e) => setCustomKey(e.target.value)}
            style={{
              padding: '0.35rem 0.6rem',
              borderRadius: 6,
              background: '#0f172a',
              color: '#fff',
              border: '1px solid #475569',
              fontSize: '0.82rem',
              width: 220,
            }}
          />
          <select
            value={mode}
            onChange={(e) => {
              setMode(e.target.value);
              setCustomKey('');
            }}
            style={{
              padding: '0.4rem 0.75rem',
              borderRadius: 6,
              background: mode === 'live' ? '#7f1d1d' : '#0f172a',
              color: '#fff',
              border: '1px solid #475569',
              fontWeight: 600,
            }}
          >
            <option value="test">TEST MODE (sk_test_)</option>
            <option value="live">LIVE MODE (sk_live_)</option>
          </select>
        </div>
      </header>

      <nav
        style={{
          display: 'flex',
          gap: '0.5rem',
          padding: '0.75rem 2rem',
          background: '#0f172a',
          borderBottom: '1px solid #1e293b',
          flexWrap: 'wrap',
        }}
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            style={{
              padding: '0.45rem 0.95rem',
              borderRadius: 6,
              border: activeTab === t.id ? '1px solid #3b82f6' : '1px solid #334155',
              background: activeTab === t.id ? '#1e3a8a' : '#1e293b',
              color: '#f8fafc',
              cursor: 'pointer',
              fontWeight: activeTab === t.id ? 600 : 400,
            }}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main style={{ padding: '1.5rem 2rem', flex: 1, maxWidth: 1280, width: '100%', boxSizing: 'border-box', margin: '0 auto' }}>
        {activeTab === 'payments' && <PaymentsTable mode={mode} apiKey={effectiveKey} />}
        {activeTab === 'routing' && <RoutingEditor mode={mode} apiKey={effectiveKey} />}
        {activeTab === 'webhooks' && <WebhookLog mode={mode} apiKey={effectiveKey} />}
        {activeTab === 'invoices' && <InvoiceList mode={mode} apiKey={effectiveKey} />}
        {activeTab === 'rbac' && <RbacManager mode={mode} apiKey={effectiveKey} />}
      </main>
    </div>
  );
}
