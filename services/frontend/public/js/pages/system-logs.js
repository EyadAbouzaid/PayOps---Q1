window.SystemLogsPage = {
  init() {
    document.getElementById('log-feature-filter').addEventListener('change', () => this.refreshLogsOnly());
    document.getElementById('log-level-filter').addEventListener('change', () => this.refreshLogsOnly());
    document.getElementById('refresh-logs-btn').addEventListener('click', () => this.refresh());
  },

  async refreshGlobalIndicator() {
    try {
      const status = await PayOpsAPI.request('/status');
      PayOpsState.status = status;
      const ok = status.status === 'operational';
      document.getElementById('global-health-dot').className = ok ? 'status-dot' : 'status-dot degraded';
      document.getElementById('global-health-text').textContent = ok
        ? 'All Systems Operational'
        : 'System Degraded';
      return status;
    } catch (_) {
      document.getElementById('global-health-dot').className = 'status-dot degraded';
      document.getElementById('global-health-text').textContent = 'Reconnecting...';
      return null;
    }
  },

  async refresh() {
    const status = await this.refreshGlobalIndicator();
    if (status) {
      document.getElementById('sys-host').textContent = status.hostname;
      document.getElementById('sys-az').textContent = `AWS AZ: ${status.availabilityZone}`;
      document.getElementById('sys-sha').textContent = `Commit: ${String(status.gitCommitSha).slice(0, 10)}`;
      document.getElementById('sys-build').textContent = `Jenkins Build #${status.jenkinsBuildNumber}`;
      document.getElementById('sys-rds').textContent = status.rds.pingLatencyMs != null ? `${status.rds.pingLatencyMs} ms` : 'Unreachable';
      document.getElementById('sys-ssl').textContent = `RDS SSL: ${status.rds.sslEnabled ? 'Enabled' : 'Disabled'}`;
      document.getElementById('sys-queue').textContent = `${status.queue.driver.toUpperCase()} (${status.queue.healthy ? 'Healthy' : 'Error'})`;
      document.getElementById('sys-storage').textContent = `PDF Storage: ${status.storageDriver}`;
    }

    // Probe each isolated backend feature module
    const features = ['payments', 'invoices', 'billing', 'webhooks'];
    const probeResults = await Promise.all(features.map(async (f) => {
      try {
        const res = await PayOpsAPI.request(`/api/${f}/health`);
        return { name: f, healthy: Boolean(res.healthy), latency: res.dbLatencyMs };
      } catch (_) {
        return { name: f, healthy: false, latency: null };
      }
    }));

    document.getElementById('feature-probes-grid').innerHTML = probeResults.map((p) => `
      <div class="probe-card">
        <div>
          <div class="probe-name">/api/${p.name}</div>
          <div class="probe-meta">${p.latency != null ? `DB ${p.latency}ms` : 'Check failed'}</div>
        </div>
        <span class="pill ${p.healthy ? 'pill-success' : 'pill-danger'}">${p.healthy ? 'Healthy' : 'Down'}</span>
      </div>
    `).join('');

    await this.refreshLogsOnly();
  },

  async refreshLogsOnly() {
    const feature = document.getElementById('log-feature-filter').value;
    const level = document.getElementById('log-level-filter').value;
    const term = document.getElementById('logs-terminal');
    try {
      const data = await PayOpsAPI.request(`/status/logs?feature=${encodeURIComponent(feature)}&level=${encodeURIComponent(level)}&limit=80`);
      if (!data.logs || data.logs.length === 0) {
        term.innerHTML = `<div class="log-line">No logs matching current filter (${feature} / ${level}).</div>`;
        return;
      }
      term.innerHTML = data.logs.map((l) => {
        const time = new Date(l.timestamp).toLocaleTimeString();
        return `<div class="log-line">[${time}] <span class="log-lvl-${PayOpsAPI.escapeHtml(l.level)}">${PayOpsAPI.escapeHtml(l.level)}</span> <span class="log-feat">[${PayOpsAPI.escapeHtml(l.feature)}]</span> ${PayOpsAPI.escapeHtml(l.message)}</div>`;
      }).join('');
    } catch (err) {
      term.innerHTML = `<div class="log-line log-lvl-ERROR">Failed loading logs: ${PayOpsAPI.escapeHtml(err.message)}</div>`;
    }
  }
};
