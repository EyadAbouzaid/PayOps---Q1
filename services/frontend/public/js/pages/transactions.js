window.TransactionsPage = {
  init() {
    document.getElementById('tx-search').addEventListener('input', () => this.render());
    document.getElementById('tx-filter-status').addEventListener('change', () => this.render());
  },

  async refresh() {
    const [payRes, invRes] = await Promise.all([
      PayOpsAPI.request('/api/payments?limit=80'),
      PayOpsAPI.request('/api/invoices')
    ]);
    PayOpsState.payments = payRes.payments || [];
    PayOpsState.invoices = invRes.invoices || [];
    this.render();
  },

  render() {
    const q = document.getElementById('tx-search').value.trim().toLowerCase();
    const statusFilter = document.getElementById('tx-filter-status').value;
    const tbody = document.getElementById('tx-tbody');

    const rows = PayOpsState.payments.filter((p) => {
      if (statusFilter !== 'all' && p.invoice_status !== statusFilter) return false;
      if (!q) return true;
      return (
        String(p.customer_email).toLowerCase().includes(q) ||
        String(p.customer_name || '').toLowerCase().includes(q) ||
        String(p.invoice_number || '').toLowerCase().includes(q) ||
        String(p.description || '').toLowerCase().includes(q)
      );
    });

    if (rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-state">No matching transactions or invoices found.</td></tr>`;
      return;
    }

    tbody.innerHTML = rows.map((p) => {
      const invAction = p.invoice_status === 'ready' && p.invoice_id
        ? `<button class="btn btn-outline btn-sm" onclick="PayOpsAPI.openInvoicePdf('${p.invoice_id}')">Download PDF (${PayOpsAPI.escapeHtml(p.invoice_number)})</button>`
        : `<span class="pill pill-warn">Generating PDF...</span>`;

      return `
        <tr>
          <td>${new Date(p.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</td>
          <td>
            <strong>${PayOpsAPI.escapeHtml(p.customer_name || 'Customer')}</strong>
            <div class="list-sub">${PayOpsAPI.escapeHtml(p.customer_email)}</div>
          </td>
          <td>${PayOpsAPI.escapeHtml(p.description || 'Payment')}</td>
          <td><strong>${PayOpsAPI.formatMoney(p.amount_cents, p.currency)}</strong></td>
          <td><span class="pill pill-success">${PayOpsAPI.escapeHtml(p.status)}</span></td>
          <td>${invAction}</td>
        </tr>
      `;
    }).join('');
  }
};
