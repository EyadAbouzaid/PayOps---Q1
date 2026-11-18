window.WebhooksPage = {
  init() {
    document.getElementById('wh-endpoint-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await PayOpsAPI.request('/api/webhooks/endpoints', {
          method: 'POST',
          body: JSON.stringify({ target_url: document.getElementById('wh-target-url').value.trim() })
        });
        PayOpsAPI.toast('Merchant webhook endpoint registered!');
        await this.refresh();
      } catch (err) {
        PayOpsAPI.toast(err.message);
      }
    });

    document.getElementById('refresh-wh-btn').addEventListener('click', () => this.refresh());
  },

  async replay(deliveryId) {
    try {
      await PayOpsAPI.request(`/api/webhooks/deliveries/${deliveryId}/replay`, { method: 'POST' });
      PayOpsAPI.toast('Signed webhook replay queued!');
      setTimeout(() => this.refresh(), 900);
    } catch (err) {
      PayOpsAPI.toast(err.message);
    }
  },

  async refresh() {
    const [epRes, delRes] = await Promise.all([
      PayOpsAPI.request('/api/webhooks/endpoints'),
      PayOpsAPI.request('/api/webhooks/deliveries')
    ]);

    const epContainer = document.getElementById('wh-endpoints-list');
    epContainer.innerHTML = (epRes.endpoints || []).map((ep) =>
      `<span class="endpoint-chip">&#9679; ${PayOpsAPI.escapeHtml(ep.target_url)}</span>`
    ).join('');

    const deliveries = delRes.deliveries || [];
    const tbody = document.getElementById('wh-deliveries-tbody');
    if (deliveries.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty-state">No webhook deliveries logged in this mode yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = deliveries.map((d) => {
      const pillClass = d.delivery_status === 'delivered' ? 'pill-success' : 'pill-danger';
      return `
        <tr>
          <td>${new Date(d.last_attempt_at).toLocaleTimeString()}</td>
          <td><code>${PayOpsAPI.escapeHtml(d.event_type)}</code></td>
          <td class="list-sub">${PayOpsAPI.escapeHtml(d.target_url)}</td>
          <td>${d.http_status || 'TIMEOUT'}</td>
          <td>#${d.attempt_count}</td>
          <td><span class="pill ${pillClass}">${PayOpsAPI.escapeHtml(d.delivery_status)}</span></td>
          <td><button class="btn btn-outline btn-sm" onclick="WebhooksPage.replay('${d.id}')">Resend</button></td>
        </tr>
      `;
    }).join('');
  }
};
