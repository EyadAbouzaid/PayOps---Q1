window.CheckoutPage = {
  lastInvoiceId: null,

  init() {
    const amountInput = document.getElementById('co-amount');
    const currencyInput = document.getElementById('co-currency');
    const descInput = document.getElementById('co-desc');
    const submitBtn = document.getElementById('co-submit-btn');

    const syncLiveSummary = () => {
      const cents = PayOpsAPI.toCents(amountInput.value);
      const cur = currencyInput.value;
      const formatted = PayOpsAPI.formatMoney(cents, cur);
      document.getElementById('live-summary-amount').textContent = formatted;
      document.getElementById('live-summary-currency').textContent = cur;
      document.getElementById('live-summary-desc').textContent = descInput.value || 'Customer Order';
      submitBtn.textContent = `Pay ${formatted} Now`;
    };

    amountInput.addEventListener('input', syncLiveSummary);
    currencyInput.addEventListener('change', syncLiveSummary);
    descInput.addEventListener('input', syncLiveSummary);

    document.querySelectorAll('.method-pill').forEach((pill) => {
      pill.addEventListener('click', () => {
        document.querySelectorAll('.method-pill').forEach((p) => p.classList.remove('selected'));
        pill.classList.add('selected');
      });
    });

    // Standalone Buyer-Only Screen Toggle
    document.getElementById('enter-customer-preview-btn').addEventListener('click', () => {
      document.getElementById('app-layout').classList.add('customer-only');
      document.getElementById('customer-preview-bar').classList.remove('hidden');
    });

    document.getElementById('exit-customer-preview-btn').addEventListener('click', () => {
      document.getElementById('app-layout').classList.remove('customer-only');
      document.getElementById('customer-preview-bar').classList.add('hidden');
    });

    document.getElementById('checkout-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const amountCents = PayOpsAPI.toCents(amountInput.value);
      if (amountCents < 50) {
        PayOpsAPI.toast('Minimum payment amount is 0.50');
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Processing Securely...';

      try {
        const res = await PayOpsAPI.request('/api/payments', {
          method: 'POST',
          body: JSON.stringify({
            customer_name: document.getElementById('co-name').value.trim(),
            customer_email: document.getElementById('co-email').value.trim(),
            amount_cents: amountCents,
            currency: currencyInput.value,
            description: descInput.value.trim() || 'Customer Order'
          })
        });

        this.lastInvoiceId = res.invoice ? res.invoice.id : null;
        this.showReceipt(res.payment, res.invoice);
        PayOpsAPI.toast('Payment completed successfully!');
      } catch (err) {
        PayOpsAPI.toast(err.message);
      } finally {
        submitBtn.disabled = false;
        syncLiveSummary();
      }
    });

    document.getElementById('receipt-download-btn').addEventListener('click', async () => {
      if (!this.lastInvoiceId) return;
      await PayOpsAPI.openInvoicePdf(this.lastInvoiceId);
    });

    document.getElementById('receipt-new-btn').addEventListener('click', () => {
      document.getElementById('checkout-receipt').classList.add('hidden');
      document.getElementById('checkout-form').classList.remove('hidden');
    });
  },

  showReceipt(payment, invoice) {
    document.getElementById('checkout-form').classList.add('hidden');
    const receiptEl = document.getElementById('checkout-receipt');
    receiptEl.classList.remove('hidden');

    document.getElementById('receipt-details').innerHTML = `
      <div><span class="muted">Customer</span><strong>${PayOpsAPI.escapeHtml(payment.customer_name)}</strong></div>
      <div><span class="muted">Email</span><span>${PayOpsAPI.escapeHtml(payment.customer_email)}</span></div>
      <div><span class="muted">Amount Paid</span><strong>${PayOpsAPI.formatMoney(payment.amount_cents, payment.currency)}</strong></div>
      <div><span class="muted">Invoice Number</span><span>${PayOpsAPI.escapeHtml(invoice ? invoice.invoice_number : '-')}</span></div>
    `;
  }
};
