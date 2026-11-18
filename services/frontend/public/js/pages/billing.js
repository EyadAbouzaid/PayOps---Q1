window.BillingPage = {
  cronLabels: {
    '0 0 1 * *': 'Monthly',
    '0 9 1 * *': 'Monthly',
    '0 9 1,15 * *': 'Bi-Weekly',
    '0 9 * * 1': 'Weekly',
    '0 0 * * *': 'Daily'
  },

  init() {
    document.getElementById('billing-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const amountCents = PayOpsAPI.toCents(document.getElementById('bill-amount').value);
      try {
        await PayOpsAPI.request('/api/billing/schedules', {
          method: 'POST',
          body: JSON.stringify({
            schedule_type: document.getElementById('bill-type').value,
            name: document.getElementById('bill-name').value.trim(),
            recipient_email: document.getElementById('bill-email').value.trim(),
            amount_cents: amountCents,
            interval_cron: document.getElementById('bill-frequency').value
          })
        });
        document.getElementById('bill-name').value = '';
        PayOpsAPI.toast('Recurring schedule saved!');
        await this.refresh();
      } catch (err) {
        PayOpsAPI.toast(err.message);
      }
    });

    document.getElementById('run-due-schedules-btn').addEventListener('click', async () => {
      try {
        const res = await PayOpsAPI.request('/api/billing/run-due', { method: 'POST' });
        PayOpsAPI.toast(`Triggered ${res.queuedCount} due billing schedule(s) in background!`);
        setTimeout(() => this.refresh(), 1000);
      } catch (err) {
        PayOpsAPI.toast(err.message);
      }
    });
  },

  async refresh() {
    const data = await PayOpsAPI.request('/api/billing/schedules');
    const schedules = data.schedules || [];
    const tbody = document.getElementById('billing-tbody');

    if (schedules.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty-state">No recurring subscriptions or payroll plans configured yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = schedules.map((s) => {
      const label = this.cronLabels[s.interval_cron] || s.interval_cron;
      const catBadge = s.schedule_type === 'payroll'
        ? `<span class="pill pill-warn">Payroll</span>`
        : `<span class="pill pill-success">Subscription</span>`;

      return `
        <tr>
          <td>${catBadge}</td>
          <td>
            <strong>${PayOpsAPI.escapeHtml(s.name)}</strong>
            <div class="list-sub">${PayOpsAPI.escapeHtml(s.recipient_email)}</div>
          </td>
          <td><strong>${PayOpsAPI.formatMoney(s.amount_cents, s.currency)}</strong></td>
          <td>${PayOpsAPI.escapeHtml(label)}</td>
          <td>${s.last_run_at ? new Date(s.last_run_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : 'Ready to run'}</td>
        </tr>
      `;
    }).join('');
  }
};
