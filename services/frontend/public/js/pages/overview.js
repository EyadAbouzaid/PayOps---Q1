window.OverviewPage = {
  async refresh() {
    const [payRes, invRes, billRes] = await Promise.all([
      PayOpsAPI.request('/api/payments?limit=50'),
      PayOpsAPI.request('/api/invoices'),
      PayOpsAPI.request('/api/billing/schedules')
    ]);

    PayOpsState.payments = payRes.payments || [];
    PayOpsState.invoices = invRes.invoices || [];
    PayOpsState.schedules = billRes.schedules || [];

    const totalCents = PayOpsState.payments
      .filter((p) => p.status === 'succeeded')
      .reduce((acc, p) => acc + Number(p.amount_cents || 0), 0);

    const readyInvoices = PayOpsState.invoices.filter((i) => i.status === 'ready').length;

    document.getElementById('kpi-volume').textContent = PayOpsAPI.formatMoney(totalCents, 'USD');
    document.getElementById('kpi-count').textContent = String(PayOpsState.payments.length);
    document.getElementById('kpi-invoices').textContent = String(readyInvoices);
    document.getElementById('kpi-schedules').textContent = String(PayOpsState.schedules.length);

    const listEl = document.getElementById('overview-recent-list');
    const recent = PayOpsState.payments.slice(0, 5);
    if (recent.length === 0) {
      listEl.innerHTML = `<div class="empty-state">No payments recorded in this mode yet. Click <strong>+ New Payment</strong> to process your first customer order.</div>`;
      return;
    }

    listEl.innerHTML = recent.map((p) => {
      const invoiceBtn = p.invoice_status === 'ready' && p.invoice_id
        ? `<button class="btn btn-outline btn-sm" onclick="PayOpsAPI.openInvoicePdf('${p.invoice_id}')">PDF Receipt</button>`
        : `<span class="pill pill-warn">Preparing PDF</span>`;

      return `
        <div class="list-row">
          <div>
            <div class="list-primary">${PayOpsAPI.escapeHtml(p.customer_name || p.customer_email)}</div>
            <div class="list-sub">${PayOpsAPI.escapeHtml(p.description || 'Customer Payment')} &bull; ${new Date(p.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
          </div>
          <div class="list-right">
            <strong>${PayOpsAPI.formatMoney(p.amount_cents, p.currency)}</strong>
            <span class="pill pill-success">Paid</span>
            ${invoiceBtn}
          </div>
        </div>
      `;
    }).join('');
  }
};
