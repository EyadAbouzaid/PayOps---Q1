window.PayOpsState = {
  mode: localStorage.getItem('payops_env_mode') || 'live',
  activePage: 'overview',
  payments: [],
  invoices: [],
  schedules: [],
  deliveries: [],
  endpoints: [],
  status: null
};

window.PayOpsAPI = {
  getMode() {
    return window.PayOpsState.mode;
  },

  setMode(newMode) {
    window.PayOpsState.mode = newMode === 'test' ? 'test' : 'live';
    localStorage.setItem('payops_env_mode', window.PayOpsState.mode);
  },

  formatMoney(amountCents, currency = 'USD') {
    const val = (Number(amountCents || 0) / 100);
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currency.toUpperCase()
      }).format(val);
    } catch (_) {
      return `${val.toFixed(2)} ${currency}`;
    }
  },

  toCents(decimalValue) {
    return Math.round( parseFloat(decimalValue || '0') * 100 );
  },

  escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },

  toast(message) {
    const el = document.getElementById('toast');
    el.textContent = message;
    el.classList.remove('hidden');
    clearTimeout(window._toastTimer);
    window._toastTimer = setTimeout(() => el.classList.add('hidden'), 3400);
  },

  async request(path, options = {}) {
    const headers = Object.assign(
      {
        'Content-Type': 'application/json',
        'X-PayOps-Mode': window.PayOpsState.mode
      },
      options.headers || {}
    );
    const res = await fetch(path, Object.assign({}, options, { headers }));
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Request failed (${res.status})`);
    }
    return data;
  },

  async openInvoicePdf(invoiceId) {
    try {
      const data = await this.request(`/api/invoices/${invoiceId}/download-url`);
      window.open(data.downloadUrl, '_blank');
    } catch (err) {
      this.toast(err.message);
    }
  }
};
