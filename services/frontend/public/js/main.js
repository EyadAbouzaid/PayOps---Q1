(function () {
  const PAGE_META = {
    overview: {
      title: 'Overview',
      subtitle: 'Your live revenue, recent payments, and ready invoices at a glance.',
      refresh: () => OverviewPage.refresh()
    },
    checkout: {
      title: 'Quick Checkout',
      subtitle: 'Simple, distraction-free payment page for your customers with instant PDF receipts.',
      refresh: () => Promise.resolve()
    },
    transactions: {
      title: 'Payments & Official Invoices',
      subtitle: 'Track completed payments and download time-limited official PDF invoices.',
      refresh: () => TransactionsPage.refresh()
    },
    billing: {
      title: 'Subscriptions & Payroll',
      subtitle: 'Automate recurring customer plans and scheduled team payouts.',
      refresh: () => BillingPage.refresh()
    },
    webhooks: {
      title: 'Webhooks & Developer API',
      subtitle: 'Manage HMAC-SHA256 store notifications, inspect delivery logs, and test OpenAPI endpoints.',
      refresh: () => WebhooksPage.refresh()
    },
    logs: {
      title: 'System Health & Live Logs',
      subtitle: 'AWS Fargate & RDS telemetry, per-feature health probes, and structured application logs.',
      refresh: () => SystemLogsPage.refresh()
    }
  };

  function navigateTo(pageKey) {
    const target = PAGE_META[pageKey] ? pageKey : 'overview';
    PayOpsState.activePage = target;

    document.querySelectorAll('.nav-item').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.page === target);
    });
    document.querySelectorAll('.page-view').forEach((sec) => {
      sec.classList.toggle('active', sec.id === `page-${target}`);
    });

    document.getElementById('page-title').textContent = PAGE_META[target].title;
    document.getElementById('page-subtitle').textContent = PAGE_META[target].subtitle;
    document.getElementById('sidebar').classList.remove('open');

    // If navigating directly to webhooks or logs, ensure Developer section is expanded
    if (target === 'webhooks' || target === 'logs') {
      document.getElementById('dev-nav-items').classList.remove('collapsed');
    }

    window.location.hash = target;
    PAGE_META[target].refresh().catch((err) => PayOpsAPI.toast(err.message));
  }

  function applyEnvironmentUX() {
    const isLive = PayOpsAPI.getMode() === 'live';
    document.getElementById('mode-live-btn').classList.toggle('active', isLive);
    document.getElementById('mode-test-btn').classList.toggle('active', !isLive);
    document.getElementById('sandbox-pill').classList.toggle('hidden', isLive);

    // In Production mode, keep Developer & Ops neatly tucked unless currently viewing them
    const devItems = document.getElementById('dev-nav-items');
    const onDevPage = PayOpsState.activePage === 'webhooks' || PayOpsState.activePage === 'logs';
    if (isLive && !onDevPage) {
      devItems.classList.add('collapsed');
    } else {
      devItems.classList.remove('collapsed');
    }
  }

  // Initialize all individual feature page modules
  CheckoutPage.init();
  TransactionsPage.init();
  BillingPage.init();
  WebhooksPage.init();
  SystemLogsPage.init();

  // Sidebar & Quick Action navigation listeners
  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.page));
  });
  document.querySelectorAll('[data-goto]').forEach((btn) => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.goto));
  });
  document.getElementById('header-new-payment-btn').addEventListener('click', () => navigateTo('checkout'));
  document.getElementById('sidebar-sys-pill').addEventListener('click', () => navigateTo('logs'));

  document.getElementById('dev-nav-toggle').addEventListener('click', () => {
    document.getElementById('dev-nav-items').classList.toggle('collapsed');
  });

  document.getElementById('mobile-menu-btn').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
  });

  // Production vs Sandbox Segmented Switch
  document.querySelectorAll('.seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      PayOpsAPI.setMode(btn.dataset.mode);
      applyEnvironmentUX();
      PAGE_META[PayOpsState.activePage].refresh();
      PayOpsAPI.toast(`Switched to ${btn.dataset.mode === 'live' ? 'Production' : 'Sandbox'} mode`);
    });
  });

  // Boot initial route & background refresh
  const hashRoute = window.location.hash.replace('#', '').trim();
  applyEnvironmentUX();
  navigateTo(PAGE_META[hashRoute] ? hashRoute : 'overview');
  SystemLogsPage.refreshGlobalIndicator();

  setInterval(() => {
    SystemLogsPage.refreshGlobalIndicator();
    if (PayOpsState.activePage !== 'checkout') {
      PAGE_META[PayOpsState.activePage].refresh().catch(() => {});
    }
  }, 7000);
})();
