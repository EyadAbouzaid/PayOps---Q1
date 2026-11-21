import React, { useEffect, useState } from 'react';
import { api } from '../api';

export function RbacManager({ mode, apiKey }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    api
      .get('/api/admin/rbac', mode, apiKey)
      .then((res) => {
        setData(res);
        setErr(null);
      })
      .catch((e) => setErr(e.message));
  }, [mode, apiKey]);

  if (err) {
    return <div style={card}>RBAC load error: {err}</div>;
  }
  if (!data) {
    return <div style={card}>Loading RBAC & Tenant Isolation context...</div>;
  }

  return (
    <div style={{ display: 'grid', gap: '1.5rem' }}>
      <div style={card}>
        <h3 style={{ marginTop: 0 }}>Authenticated Session Principal</h3>
        <div style={{ fontSize: '0.88rem', display: 'grid', gap: '0.35rem' }}>
          <div>Merchant Tenant: <code>{data.current_principal?.merchantId}</code> ({data.current_principal?.merchantName})</div>
          <div>Isolated Mode: <strong>{String(data.current_principal?.envMode).toUpperCase()}</strong></div>
          <div>Assigned Role: <code>{data.current_principal?.role}</code></div>
          <div>Permissions: <code>{(data.current_principal?.permissions || []).join(', ')}</code></div>
        </div>
      </div>

      <div style={card}>
        <h3 style={{ marginTop: 0 }}>Mode-Scoped API Keys ({mode.toUpperCase()})</h3>
        <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.86rem' }}>
          {(data.api_keys || []).map((k) => (
            <li key={k.id} style={{ marginBottom: '0.4rem' }}>
              <code>{k.key_prefix}_***</code> — {k.name} (role: <code>{k.role_name}</code>, active: {String(k.active)})
            </li>
          ))}
        </ul>
      </div>

      <div style={card}>
        <h3 style={{ marginTop: 0 }}>Platform RBAC Role Matrix</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem' }}>
          {(data.roles || []).map((r) => (
            <div key={r.id} style={{ padding: '0.75rem', background: '#0f172a', borderRadius: 6, border: '1px solid #334155' }}>
              <strong>{r.name}</strong>
              <p style={{ fontSize: '0.8rem', color: '#94a3b8', margin: '0.3rem 0' }}>{r.description}</p>
              <div style={{ fontSize: '0.75rem', color: '#38bdf8' }}>
                {(r.permissions || []).length} permissions
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const card = { background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: '1.1rem' };
