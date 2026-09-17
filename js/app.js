/**
 * Main Application Controller for vLLM Telemetry Dashboard
 */

(function () {
  'use strict';

  // Application State
  const state = {
    endpointUrl: localStorage.getItem('vllm_endpoint') || 'http://localhost:8000/metrics',
    intervalSeconds: parseInt(localStorage.getItem('vllm_interval') || '10', 10),
    secondsLeft: 10,
    isPaused: false,
    theme: localStorage.getItem('vllm_theme') || 'dark',
    timeWindow: 15, // minutes
    isRawOpen: false,
    rawFilterText: '',
    status: 'connecting', // connecting, live, paused, error
    lastError: null
  };

  // Instantiations
  const store = new VLLMMetricsStore({ maxHistoryPoints: 720 });
  const charts = new DashboardCharts();
  let timerInterval = null;

  // DOM Elements cache
  const el = {};

  function cacheDOMElements() {
    el.endpointInput = document.getElementById('endpoint-input');
    el.btnConnect = document.getElementById('btn-connect');
    el.btnRefresh = document.getElementById('btn-refresh');
    el.btnPause = document.getElementById('btn-pause');
    el.btnTheme = document.getElementById('btn-theme');
    el.btnExportJson = document.getElementById('btn-export-json');
    el.btnExportCsv = document.getElementById('btn-export-csv');
    el.intervalSelect = document.getElementById('interval-select');
    el.countdownText = document.getElementById('countdown-text');
    el.countdownBar = document.getElementById('countdown-bar');
    el.alertBanner = document.getElementById('alert-banner');
    el.alertMessage = document.getElementById('alert-message');

    // System Ribbon
    el.sysModel = document.getElementById('sys-model');
    el.sysState = document.getElementById('sys-state');
    el.sysUptime = document.getElementById('sys-uptime');
    el.sysCpu = document.getElementById('sys-cpu');
    el.sysMemory = document.getElementById('sys-memory');
    el.sysLastPoll = document.getElementById('sys-lastpoll');

    // KPI Values
    el.kpiKvUsage = document.getElementById('kpi-kv-usage');
    el.kpiKvPrefixRate = document.getElementById('kpi-kv-prefixrate');
    el.kpiKvPeak = document.getElementById('kpi-kv-peak');

    el.kpiRunning = document.getElementById('kpi-running');
    el.kpiWaiting = document.getElementById('kpi-waiting');
    el.kpiPreemptions = document.getElementById('kpi-preemptions');

    el.kpiGenRate = document.getElementById('kpi-gen-rate');
    el.kpiPromptRate = document.getElementById('kpi-prompt-rate');
    el.kpiGenTotal = document.getElementById('kpi-gen-total');
    el.kpiPromptTotal = document.getElementById('kpi-prompt-total');
    el.kpiTokensFooter = document.getElementById('kpi-tokens-footer');

    el.kpiReqRate = document.getElementById('kpi-req-rate');
    el.kpiToolRate = document.getElementById('kpi-tool-rate');
    el.kpiReqSuccess = document.getElementById('kpi-req-success');
    el.kpiToolCalls = document.getElementById('kpi-tool-calls');
    el.kpiReqFooter = document.getElementById('kpi-req-footer');

    el.kpiTtft = document.getElementById('kpi-ttft');
    el.kpiItl = document.getElementById('kpi-itl');
    el.kpiE2e = document.getElementById('kpi-e2e');

    el.kpiSpecAcceptance = document.getElementById('kpi-spec-acceptance');
    el.kpiSpecDrafted = document.getElementById('kpi-spec-drafted');
    el.kpiSpecAccepted = document.getElementById('kpi-spec-accepted');

    // Time window buttons
    el.timeButtons = document.querySelectorAll('.time-btn');

    // Raw Explorer
    el.explorerHeader = document.getElementById('explorer-header');
    el.explorerChevron = document.getElementById('explorer-chevron');
    el.explorerContent = document.getElementById('explorer-content');
    el.rawSearchInput = document.getElementById('raw-search-input');
    el.rawMetricsCount = document.getElementById('raw-metrics-count');
    el.rawMetricsTbody = document.getElementById('raw-metrics-tbody');
  }

  /**
   * Apply theme to DOM and charts
   */
  function applyTheme(theme) {
    state.theme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('vllm_theme', theme);
    charts.setTheme(theme === 'dark');

    if (el.btnTheme) {
      el.btnTheme.innerHTML = theme === 'dark'
        ? '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>'
        : '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>';
    }
  }

  /**
   * Track connection status in state
   */
  function updateStatus(status) {
    state.status = status;
  }

  /**
   * Fetch live metrics from vLLM server
   */
  async function fetchLiveMetrics() {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    try {
      const resp = await fetch(state.endpointUrl, {
        method: 'GET',
        headers: { 'Accept': 'text/plain' },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
      }

      const text = await resp.text();
      return text;
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  }

  /**
   * Main poll trigger
   */
  async function pollMetrics() {
    try {
      const rawText = await fetchLiveMetrics();
      updateStatus(state.isPaused ? 'paused' : 'live');
      hideAlert();

      const snapshot = store.processMetrics(rawText);
      updateDashboardUI(snapshot);
      state.lastError = null;
    } catch (err) {
      console.warn('Metrics fetch error:', err);
      state.lastError = err;
      updateStatus('error');
      showAlert(`Unable to reach metrics endpoint at ${state.endpointUrl} (${err.message}). Check server connectivity, host IP, and CORS.`);
    }
  }

  function showAlert(msg) {
    if (!el.alertBanner) return;
    el.alertMessage.textContent = msg;
    el.alertBanner.classList.add('active');
  }

  function hideAlert() {
    if (!el.alertBanner) return;
    el.alertBanner.classList.remove('active');
  }

  /**
   * Format numbers with commas / suffixes
   */
  function formatNumber(num, decimals = 0) {
    if (num === null || num === undefined || isNaN(num)) return '0';
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M';
    }
    if (num >= 10000) {
      return (num / 1000).toFixed(1) + 'k';
    }
    return Number(num).toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }

  function formatDuration(seconds) {
    if (!seconds || seconds <= 0) return '0s';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    if (hrs > 0) return `${hrs}h ${mins}m ${secs}s`;
    if (mins > 0) return `${mins}m ${secs}s`;
    return `${secs}s`;
  }

  /**
   * Update full UI with fresh snapshot
   */
  function updateDashboardUI(snapshot) {
    if (!snapshot) return;

    // 1. System Ribbon
    el.sysModel.textContent = snapshot.modelInfo.modelName || 'Unknown';

    const isAwake = snapshot.modelInfo.sleepState === 'awake';
    el.sysState.innerHTML = `<span class="badge ${isAwake ? 'badge-awake' : 'badge-sleep'}">${snapshot.modelInfo.sleepState}</span>`;

    el.sysUptime.textContent = formatDuration(snapshot.modelInfo.uptimeSeconds);
    el.sysCpu.textContent = `${snapshot.system.cpuPercent.toFixed(1)}%`;
    el.sysMemory.textContent = `${snapshot.system.memoryRssGb.toFixed(2)} GB / ${snapshot.system.memoryVmsGb.toFixed(1)} GB`;
    el.sysLastPoll.textContent = snapshot.timeLabel;

    // 2. KPI Cards
    // KV Cache
    const kv = snapshot.kvCache.usagePercent;
    el.kpiKvUsage.textContent = kv.toFixed(1);
    el.kpiKvUsage.style.color = kv > 90 ? 'var(--error)' : kv > 75 ? 'var(--warning)' : 'var(--fg-primary)';
    el.kpiKvPrefixRate.textContent = `${snapshot.kvCache.prefixCacheHitRateInterval.toFixed(1)}%`;

    const peakKv = Math.max(...store.history.map(s => s.kvCache.usagePercent), 0);
    el.kpiKvPeak.textContent = `${peakKv.toFixed(1)}%`;

    // Requests
    el.kpiRunning.textContent = snapshot.requests.running;
    el.kpiWaiting.textContent = snapshot.requests.waiting;
    el.kpiWaiting.style.color = snapshot.requests.waiting > 0 ? 'var(--warning)' : 'var(--fg-primary)';
    el.kpiPreemptions.textContent = snapshot.requests.preemptionsTotal;

    // Tokens
    el.kpiGenRate.textContent = formatNumber(snapshot.tokens.generationRate, 1);
    el.kpiPromptRate.textContent = formatNumber(snapshot.tokens.promptRate, 1);
    if (el.kpiGenTotal) {
      el.kpiGenTotal.textContent = formatNumber(snapshot.tokens.generationTotal, 0);
      el.kpiGenTotal.title = `${snapshot.tokens.generationTotal.toLocaleString()} generated tokens`;
    }
    if (el.kpiPromptTotal) {
      el.kpiPromptTotal.textContent = formatNumber(snapshot.tokens.promptTotal, 0);
      el.kpiPromptTotal.title = `${snapshot.tokens.promptTotal.toLocaleString()} prompt tokens`;
    }
    if (el.kpiTokensFooter) {
      el.kpiTokensFooter.title = `Total Combined: ${snapshot.tokens.totalCumulative.toLocaleString()} tokens (Gen: ${snapshot.tokens.generationTotal.toLocaleString()} + Prompt: ${snapshot.tokens.promptTotal.toLocaleString()})`;
    }

    // Request & Tool Throughput
    el.kpiReqRate.textContent = snapshot.requests.successRate.toFixed(2);
    if (el.kpiToolRate) {
      el.kpiToolRate.textContent = snapshot.tools.callsRate.toFixed(2);
    }
    if (el.kpiReqSuccess) {
      el.kpiReqSuccess.textContent = formatNumber(snapshot.requests.successTotal, 0);
      el.kpiReqSuccess.title = `${snapshot.requests.successTotal.toLocaleString()} successfully processed requests`;
    }
    if (el.kpiToolCalls) {
      el.kpiToolCalls.textContent = formatNumber(snapshot.tools.callsTotal, 0);
      el.kpiToolCalls.title = `${snapshot.tools.callsTotal.toLocaleString()} tool calls (${snapshot.tools.ratioCumulative.toFixed(1)}% of ${snapshot.tools.invocationsTotal.toLocaleString()} parser invocations)`;
    }
    if (el.kpiReqFooter) {
      el.kpiReqFooter.title = `Requests: ${snapshot.requests.successTotal.toLocaleString()} | Tool Calls: ${snapshot.tools.callsTotal.toLocaleString()} (${snapshot.tools.ratioCumulative.toFixed(1)}%)`;
    }

    // Latency
    el.kpiTtft.textContent = `${snapshot.latency.ttftIntervalMs.toFixed(1)} ms`;
    el.kpiItl.textContent = `${snapshot.latency.itlIntervalMs.toFixed(1)} ms`;
    el.kpiE2e.textContent = `${snapshot.latency.e2eIntervalMs.toFixed(1)} ms`;

    // Speculative Decoding
    el.kpiSpecAcceptance.textContent = `${snapshot.specDecode.acceptanceRateInterval.toFixed(1)}%`;
    el.kpiSpecDrafted.textContent = formatNumber(snapshot.specDecode.draftTokensTotal, 0);
    el.kpiSpecAccepted.textContent = formatNumber(snapshot.specDecode.acceptedTokensTotal, 0);

    // 3. Render Sparklines
    const c = charts.getThemeColors();

    charts.renderSparkline('spark-kv', store.getSparklineData('kvCache.usagePercent', 25), {
      color: c.purple,
      fillColor: c.purpleAlpha,
      min: 0,
      max: 100
    });

    charts.renderSparkline('spark-requests', store.getSparklineData('requests.running', 25), {
      color: c.primary,
      fillColor: c.primaryAlpha
    });

    charts.renderSparkline('spark-tokens', store.getSparklineData('tokens.generationRate', 25), {
      color: c.emerald,
      fillColor: c.emeraldAlpha
    });

    charts.renderSparkline('spark-req-rate', store.getSparklineData('requests.successRate', 25), {
      color: c.amber,
      fillColor: c.amberAlpha
    });

    charts.renderSparkline('spark-latency', store.getSparklineData('latency.ttftIntervalMs', 25), {
      color: c.primary,
      fillColor: c.primaryAlpha
    });

    charts.renderSparkline('spark-spec', store.getSparklineData('specDecode.acceptanceRateInterval', 25), {
      color: c.teal,
      fillColor: c.tealAlpha,
      min: 0,
      max: 100
    });

    // 4. Update Main Graphs
    const historySlice = store.getHistorySlice(state.timeWindow);
    charts.updateCharts(historySlice);

    // 5. Update Raw Metrics Table if open
    if (state.isRawOpen) {
      renderRawMetricsTable();
    }
  }

  /**
   * Render Raw Metrics Table
   */
  function renderRawMetricsTable() {
    if (!store.lastParsed || !el.rawMetricsTbody) return;

    const parsed = store.lastParsed;
    const filter = state.rawFilterText.toLowerCase().trim();
    let rowsHtml = '';
    let matchCount = 0;

    const keys = Object.keys(parsed.metrics).sort();
    for (const name of keys) {
      const type = parsed.type[name] || 'gauge';
      const samples = parsed.metrics[name];

      for (const sample of samples) {
        const labelsStr = Object.entries(sample.labels)
          .map(([k, v]) => `${k}="${v}"`)
          .join(', ');

        const match = !filter ||
          name.toLowerCase().includes(filter) ||
          labelsStr.toLowerCase().includes(filter) ||
          type.toLowerCase().includes(filter);

        if (match) {
          matchCount++;
          if (matchCount <= 250) { // cap at 250 rows for snappy DOM rendering
            rowsHtml += `
              <tr>
                <td class="metric-name-cell">${escapeHtml(name)}</td>
                <td><span class="metric-type-tag">${escapeHtml(type)}</span></td>
                <td style="color: var(--fg-secondary);">${escapeHtml(labelsStr || '-')}</td>
                <td style="font-weight: 600;">${sample.value}</td>
              </tr>
            `;
          }
        }
      }
    }

    el.rawMetricsCount.textContent = `${matchCount} metrics ${matchCount > 250 ? '(displaying first 250)' : ''}`;
    el.rawMetricsTbody.innerHTML = rowsHtml || '<tr><td colspan="4" style="text-align: center; color: var(--fg-muted); padding: 16px;">No matching metrics found</td></tr>';
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, m => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[m]));
  }

  /**
   * Countdown Tick Loop (Runs every 1s)
   */
  function startTicker() {
    if (timerInterval) clearInterval(timerInterval);

    state.secondsLeft = state.intervalSeconds;

    timerInterval = setInterval(() => {
      if (state.isPaused) {
        updateStatus('paused');
        return;
      }

      state.secondsLeft--;

      if (el.countdownText) {
        el.countdownText.textContent = `${state.secondsLeft}s`;
      }
      if (el.countdownBar) {
        const pct = Math.max(0, (state.secondsLeft / state.intervalSeconds) * 100);
        el.countdownBar.style.width = `${pct}%`;
      }

      if (state.secondsLeft <= 0) {
        state.secondsLeft = state.intervalSeconds;
        pollMetrics();
      }
    }, 1000);
  }

  /**
   * Download helper
   */
  function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * Event Listeners Setup
   */
  function setupEventListeners() {
    // Endpoint Input & Connect
    el.endpointInput.value = state.endpointUrl;
    el.btnConnect.addEventListener('click', () => {
      const url = el.endpointInput.value.trim();
      if (url) {
        state.endpointUrl = url;
        localStorage.setItem('vllm_endpoint', url);
        store.clearHistory();
        state.secondsLeft = state.intervalSeconds;
        pollMetrics();
      }
    });

    el.endpointInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') el.btnConnect.click();
    });

    // Refresh Now
    el.btnRefresh.addEventListener('click', () => {
      state.secondsLeft = state.intervalSeconds;
      pollMetrics();
    });

    // Pause / Resume
    el.btnPause.addEventListener('click', () => {
      state.isPaused = !state.isPaused;
      el.btnPause.innerHTML = state.isPaused
        ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg> Resume'
        : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg> Pause';
      updateStatus(state.isPaused ? 'paused' : 'live');
    });

    // Interval Selector
    el.intervalSelect.value = String(state.intervalSeconds);
    el.intervalSelect.addEventListener('change', (e) => {
      const val = parseInt(e.target.value, 10);
      state.intervalSeconds = val;
      state.secondsLeft = val;
      localStorage.setItem('vllm_interval', String(val));
      if (state.status === 'live') {
        updateStatus('live');
      }
    });

    // Theme Switcher
    el.btnTheme.addEventListener('click', () => {
      applyTheme(state.theme === 'dark' ? 'light' : 'dark');
    });

    // Time Window Buttons
    el.timeButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        el.timeButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const duration = btn.dataset.window === 'all' ? 'all' : parseInt(btn.dataset.window, 10);
        state.timeWindow = duration;
        charts.updateCharts(store.getHistorySlice(duration));
      });
    });

    // Raw Explorer Accordion
    el.explorerHeader.addEventListener('click', () => {
      state.isRawOpen = !state.isRawOpen;
      el.explorerChevron.classList.toggle('open', state.isRawOpen);
      el.explorerContent.classList.toggle('open', state.isRawOpen);
      if (state.isRawOpen) {
        renderRawMetricsTable();
      }
    });

    // Raw Search Filter
    el.rawSearchInput.addEventListener('input', (e) => {
      state.rawFilterText = e.target.value;
      renderRawMetricsTable();
    });

    // Export JSON
    el.btnExportJson.addEventListener('click', () => {
      const data = store.exportJSON();
      downloadFile(data, `vllm-metrics-${Date.now()}.json`, 'application/json');
    });

    // Export CSV
    el.btnExportCsv.addEventListener('click', () => {
      const data = store.exportCSV();
      downloadFile(data, `vllm-metrics-${Date.now()}.csv`, 'text/csv');
    });
  }

  /**
   * Initialization
   */
  function init() {
    cacheDOMElements();
    applyTheme(state.theme);
    setupEventListeners();
    charts.initCharts();
    startTicker();
    pollMetrics();
  }

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
