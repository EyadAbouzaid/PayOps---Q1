const modeSelect = document.getElementById('env-mode-select');

function currentMode() {
  return modeSelect.value || 'test';
}

function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 3200);
}

async function apiFetch(path, options = {}) {
  const headers = Object.assign(
    { 'Content-Type': 'application/json', 'X-PayOps-Mode': currentMode() },
    options.headers || {}
  );
  const res = await fetch(path, Object.assign({}, options, { headers }));
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function refreshTelemetryAndHealth() {
  try {
    const status = await apiFetch('/status');
    document.getElementById('tel-host').textContent = `Host: ${status.hostname}`;
    document.getElementById('tel-az').textContent = `AZ: ${status.availabilityZone}`;
    document.getElementById('tel-sha').textContent = `Commit: ${String(status.gitCommitSha).slice(0, 8)}`;
    document.getElementById('tel-build').textContent = `Jenkins #${status.jenkinsBuildNumber}`;
    document.getElementById('tel-rds').textContent = `RDS: ${status.rds.pingLatencyMs ?? 'ERR'}ms`;
    document.getElementById('tel-queue').textContent = `Queue (${status.queue.driver}): ${status.queue.healthy ? 'OK' : 'ERR'}`;
    document.getElementById('status-dot').className = status.status === 'operational' ? 'dot' : 'dot degraded';
  } catch (_) {
    document.getElementById('status-dot').className = 'dot degraded';
  }

  for (const feat of ['payments', 'invoices', 'webhooks']) {
    const badge = document.getElementById(`${feat}-health-badge`);
    if (!badge) continue;
    try {
      const h = await apiFetch(`/api/${feat}/health`);
      badge.textContent = h.healthy ? `${feat}: healthy` : `${feat}: degraded`;
    } catch (_) {
      badge.textContent = `${feat}: unreachable`;
    }
  }
}

async function refreshDashboardData() {
  const [payData, invData, billData, whData] = await Promise.all([
    apiFetch('/api/payments'),
    apiFetch('/api/invoices'),
    apiFetch('/api/billing/schedules'),
    apiFetch('/api/webhooks/deliveries')
  ]);

  document.getElementById('payments-tbody').innerHTML = payData.payments.map((p) => `
    <tr>
      <td>${p.id.slice(0, 8)}</td>
      <td>${p.customer_email}</td>
      <td>${(p.amount_cents / 100).toFixed(2)} ${p.currency}</td>
      <td>${p.status}</td>
      <td>${p.processed_by_host || '-'}</td>
    </tr>
  `).join('');

  document.getElementById('invoices-tbody').innerHTML = invData.invoices.map((i) => `
    <tr>
      <td>${i.invoice_number}</td>
      <td>${(i.amount_cents / 100).toFixed(2)} ${i.currency}</td>
      <td>${i.storage_driver}</td>
      <td>${i.status}</td>
      <td>
        ${i.status === 'ready'
          ? `<button class="btn btn-outline btn-sm" onclick="downloadInvoice('${i.id}')">Pre-Signed PDF</button>`
          : 'Generating...'}
      </td>
    </tr>
  `).join('');

  document.getElementById('schedules-tbody').innerHTML = billData.schedules.map((s) => `
    <tr>
      <td>${s.schedule_type}</td>
      <td>${s.name}</td>
      <td>${(s.amount_cents / 100).toFixed(2)} ${s.currency}</td>
      <td>${s.last_run_at ? new Date(s.last_run_at).toLocaleTimeString() : 'Due Now'}</td>
    </tr>
  `).join('');

  document.getElementById('webhooks-tbody').innerHTML = whData.deliveries.map((w) => `
    <tr>
      <td>${w.event_type}</td>
      <td>${w.http_status || 'ERR'}</td>
      <td>#${w.attempt_count}</td>
      <td>${w.delivery_status}</td>
      <td><button class="btn btn-outline btn-sm" onclick="replayWebhook('${w.id}')">Replay</button></td>
    </tr>
  `).join('');
}

window.downloadInvoice = async function(invoiceId) {
  try {
    const data = await apiFetch(`/api/invoices/${invoiceId}/download-url`);
    window.open(data.downloadUrl, '_blank');
  } catch (err) {
    showToast(err.message);
  }
};

window.replayWebhook = async function(deliveryId) {
  try {
    await apiFetch(`/api/webhooks/deliveries/${deliveryId}/replay`, { method: 'POST' });
    showToast('Webhook replay queued!');
    setTimeout(refreshDashboardData, 1000);
  } catch (err) {
    showToast(err.message);
  }
};

document.getElementById('payment-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await apiFetch('/api/payments', {
      method: 'POST',
      body: JSON.stringify({
        customer_name: document.getElementById('pay-name').value,
        customer_email: document.getElementById('pay-email').value,
        amount_cents: Number(document.getElementById('pay-amount').value),
        description: document.getElementById('pay-desc').value
      })
    });
    showToast('Payment processed! Generating PDF & dispatching signed webhook...');
    setTimeout(refreshDashboardData, 900);
  } catch (err) {
    showToast(err.message);
  }
});

document.getElementById('schedule-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await apiFetch('/api/billing/schedules', {
      method: 'POST',
      body: JSON.stringify({
        schedule_type: document.getElementById('sched-type').value,
        name: document.getElementById('sched-name').value,
        recipient_email: document.getElementById('sched-email').value,
        amount_cents: Number(document.getElementById('sched-amount').value)
      })
    });
    showToast('Schedule created!');
    refreshDashboardData();
  } catch (err) {
    showToast(err.message);
  }
});

document.getElementById('run-due-btn').addEventListener('click', async () => {
  try {
    const res = await apiFetch('/api/billing/run-due', { method: 'POST' });
    showToast(`Queued ${res.queuedCount} due payroll/subscription run(s)!`);
    setTimeout(refreshDashboardData, 1000);
  } catch (err) {
    showToast(err.message);
  }
});

document.getElementById('webhook-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await apiFetch('/api/webhooks/endpoints', {
      method: 'POST',
      body: JSON.stringify({ target_url: document.getElementById('wh-url').value })
    });
    showToast('Webhook endpoint registered!');
  } catch (err) {
    showToast(err.message);
  }
});

modeSelect.addEventListener('change', () => {
  refreshTelemetryAndHealth();
  refreshDashboardData();
});

refreshTelemetryAndHealth();
refreshDashboardData();
setInterval(() => {
  refreshTelemetryAndHealth();
  refreshDashboardData();
}, 6000);
