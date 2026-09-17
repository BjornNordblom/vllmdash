/**
 * Charts and Sparklines rendering engine for vLLM Telemetry Dashboard.
 * Integrates Chart.js with OKLCH-aligned palettes and lightweight SVG sparklines.
 */

class DashboardCharts {
  constructor() {
    this.charts = {};
    this.isDark = true;
  }

  /**
   * Determine current active theme
   */
  setTheme(isDark) {
    this.isDark = isDark;
    this.updateChartThemeDefaults();
    for (const key in this.charts) {
      if (this.charts[key]) {
        this.applyThemeToChart(this.charts[key]);
        this.charts[key].update('none');
      }
    }
  }

  /**
   * Color palette configurations (OKLCH-derived RGB/HEX equivalents for Chart.js)
   */
  getThemeColors() {
    if (this.isDark) {
      return {
        bg: '#14171f',
        cardBg: '#1b202c',
        text: '#cbd5e1',
        textMuted: '#64748b',
        border: 'rgba(255, 255, 255, 0.08)',
        grid: 'rgba(255, 255, 255, 0.05)',
        tooltipBg: '#0f172a',
        tooltipBorder: 'rgba(255, 255, 255, 0.15)',
        primary: '#38bdf8',       // Sky blue
        primaryAlpha: 'rgba(56, 189, 248, 0.15)',
        secondary: '#818cf8',     // Indigo
        secondaryAlpha: 'rgba(129, 140, 248, 0.15)',
        emerald: '#34d399',       // Emerald green
        emeraldAlpha: 'rgba(52, 211, 153, 0.15)',
        amber: '#fbbf24',         // Amber
        amberAlpha: 'rgba(251, 191, 36, 0.15)',
        rose: '#f87171',          // Rose red
        roseAlpha: 'rgba(248, 113, 113, 0.15)',
        purple: '#c084fc',        // Purple
        purpleAlpha: 'rgba(192, 132, 252, 0.15)',
        teal: '#2dd4bf',          // Teal
        tealAlpha: 'rgba(45, 212, 191, 0.15)'
      };
    } else {
      return {
        bg: '#f8fafc',
        cardBg: '#ffffff',
        text: '#334155',
        textMuted: '#94a3b8',
        border: 'rgba(0, 0, 0, 0.08)',
        grid: 'rgba(0, 0, 0, 0.04)',
        tooltipBg: '#1e293b',
        tooltipBorder: 'rgba(0, 0, 0, 0.1)',
        primary: '#0284c7',
        primaryAlpha: 'rgba(2, 132, 199, 0.12)',
        secondary: '#6366f1',
        secondaryAlpha: 'rgba(99, 102, 241, 0.12)',
        emerald: '#059669',
        emeraldAlpha: 'rgba(5, 150, 105, 0.12)',
        amber: '#d97706',
        amberAlpha: 'rgba(217, 119, 6, 0.12)',
        rose: '#dc2626',
        roseAlpha: 'rgba(220, 38, 38, 0.12)',
        purple: '#9333ea',
        purpleAlpha: 'rgba(147, 51, 234, 0.12)',
        teal: '#0d9488',
        tealAlpha: 'rgba(13, 148, 136, 0.12)'
      };
    }
  }

  updateChartThemeDefaults() {
    if (typeof Chart === 'undefined') return;
    const c = this.getThemeColors();

    Chart.defaults.color = c.textMuted;
    Chart.defaults.font.family = "'Inter', system-ui, -apple-system, sans-serif";
    Chart.defaults.font.size = 11;
    Chart.defaults.plugins.tooltip.backgroundColor = c.tooltipBg;
    Chart.defaults.plugins.tooltip.titleColor = '#ffffff';
    Chart.defaults.plugins.tooltip.bodyColor = '#e2e8f0';
    Chart.defaults.plugins.tooltip.borderColor = c.tooltipBorder;
    Chart.defaults.plugins.tooltip.borderWidth = 1;
    Chart.defaults.plugins.tooltip.padding = 10;
    Chart.defaults.plugins.tooltip.cornerRadius = 6;
    Chart.defaults.plugins.tooltip.titleFont = { weight: '600', size: 12 };
    Chart.defaults.plugins.tooltip.bodyFont = { family: "'JetBrains Mono', monospace", size: 11 };
  }

  applyThemeToChart(chart) {
    const c = this.getThemeColors();
    if (chart.options.scales) {
      for (const scaleKey in chart.options.scales) {
        const scale = chart.options.scales[scaleKey];
        if (scale.grid) scale.grid.color = c.grid;
        if (scaleKey === 'yGen') {
          if (scale.ticks) scale.ticks.color = c.emerald;
          if (scale.title) scale.title.color = c.emerald;
        } else if (scaleKey === 'yPrompt') {
          if (scale.ticks) scale.ticks.color = c.secondary;
          if (scale.title) scale.title.color = c.secondary;
        } else {
          if (scale.ticks) scale.ticks.color = c.textMuted;
          if (scale.title) scale.title.color = c.text;
        }
      }
    }
  }

  /**
   * Initialize all Chart.js instances
   */
  initCharts() {
    if (typeof Chart === 'undefined') {
      console.error('Chart.js is not loaded.');
      return;
    }

    this.updateChartThemeDefaults();
    const c = this.getThemeColors();

    const commonOptions = {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          align: 'end',
          labels: {
            boxWidth: 10,
            boxHeight: 10,
            usePointStyle: true,
            padding: 14,
            font: { size: 11, weight: '500' }
          }
        }
      },
      scales: {
        x: {
          grid: { color: c.grid, drawTicks: false },
          ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 7 }
        },
        y: {
          grid: { color: c.grid, drawTicks: false },
          beginAtZero: true,
          ticks: { padding: 8 }
        }
      }
    };

    // Chart 1: Requests & Concurrency
    const ctxRequests = document.getElementById('chart-requests')?.getContext('2d');
    if (ctxRequests) {
      this.charts.requests = new Chart(ctxRequests, {
        type: 'line',
        data: {
          labels: [],
          datasets: [
            {
              label: 'Running Requests',
              data: [],
              borderColor: c.primary,
              backgroundColor: c.primaryAlpha,
              fill: true,
              tension: 0.25,
              borderWidth: 2,
              pointRadius: 0,
              pointHoverRadius: 4
            },
            {
              label: 'Waiting Requests',
              data: [],
              borderColor: c.amber,
              backgroundColor: c.amberAlpha,
              fill: true,
              tension: 0.25,
              borderWidth: 2,
              pointRadius: 0,
              pointHoverRadius: 4
            },
            {
              label: 'Preemptions Total',
              data: [],
              borderColor: c.rose,
              borderDash: [4, 4],
              borderWidth: 1.5,
              tension: 0,
              pointRadius: 0,
              yAxisID: 'yPreemptions'
            }
          ]
        },
        options: {
          ...commonOptions,
          scales: {
            ...commonOptions.scales,
            y: {
              ...commonOptions.scales.y,
              title: { display: true, text: 'Requests Count' }
            },
            yPreemptions: {
              position: 'right',
              grid: { drawOnChartArea: false },
              beginAtZero: true,
              ticks: { precision: 0 },
              title: { display: false }
            }
          }
        }
      });
    }

    // Chart 2: Token Throughput (tok/s) with Dual Y-Axes by Default
    const ctxTokens = document.getElementById('chart-tokens')?.getContext('2d');
    if (ctxTokens) {
      this.charts.tokens = new Chart(ctxTokens, {
        type: 'line',
        data: {
          labels: [],
          datasets: [
            {
              label: 'Gen Tokens / sec (Decode)',
              data: [],
              borderColor: c.emerald,
              backgroundColor: c.emeraldAlpha,
              fill: true,
              tension: 0.25,
              borderWidth: 2,
              pointRadius: 0,
              pointHoverRadius: 4,
              yAxisID: 'yGen'
            },
            {
              label: 'Prompt Tokens / sec (Prefill)',
              data: [],
              borderColor: c.secondary,
              backgroundColor: c.secondaryAlpha,
              fill: false,
              tension: 0.25,
              borderWidth: 1.5,
              pointRadius: 0,
              pointHoverRadius: 4,
              yAxisID: 'yPrompt'
            }
          ]
        },
        options: {
          ...commonOptions,
          scales: {
            x: commonOptions.scales.x,
            yGen: {
              type: 'linear',
              position: 'left',
              beginAtZero: true,
              grid: { color: c.grid, drawTicks: false },
              ticks: { color: c.emerald, padding: 6 },
              title: { display: true, text: 'Gen Tokens / s (Left)', color: c.emerald, font: { weight: '600', size: 11 } }
            },
            yPrompt: {
              type: 'linear',
              position: 'right',
              beginAtZero: true,
              grid: { drawOnChartArea: false },
              ticks: { color: c.secondary, padding: 6 },
              title: { display: true, text: 'Prompt Tokens / s (Right)', color: c.secondary, font: { weight: '600', size: 11 } }
            }
          }
        }
      });
    }

    // Chart 3: KV Cache & Prefix Cache (%)
    const ctxKVCache = document.getElementById('chart-kvcache')?.getContext('2d');
    if (ctxKVCache) {
      this.charts.kvCache = new Chart(ctxKVCache, {
        type: 'line',
        data: {
          labels: [],
          datasets: [
            {
              label: 'KV Cache Usage %',
              data: [],
              borderColor: c.purple,
              backgroundColor: c.purpleAlpha,
              fill: true,
              tension: 0.25,
              borderWidth: 2,
              pointRadius: 0,
              pointHoverRadius: 4
            },
            {
              label: 'Prefix Cache Hit Rate %',
              data: [],
              borderColor: c.teal,
              backgroundColor: c.tealAlpha,
              fill: false,
              tension: 0.25,
              borderWidth: 2,
              pointRadius: 0,
              pointHoverRadius: 4
            }
          ]
        },
        options: {
          ...commonOptions,
          scales: {
            ...commonOptions.scales,
            y: {
              ...commonOptions.scales.y,
              min: 0,
              max: 100,
              ticks: { callback: v => v + '%' },
              title: { display: true, text: 'Percentage (%)' }
            }
          }
        }
      });
    }

    // Chart 4: Latency Profiling (ms)
    const ctxLatency = document.getElementById('chart-latency')?.getContext('2d');
    if (ctxLatency) {
      this.charts.latency = new Chart(ctxLatency, {
        type: 'line',
        data: {
          labels: [],
          datasets: [
            {
              label: 'TTFT (Time to First Token)',
              data: [],
              borderColor: c.primary,
              tension: 0.25,
              borderWidth: 2,
              pointRadius: 0,
              pointHoverRadius: 4
            },
            {
              label: 'ITL / TPOT (Inter-Token)',
              data: [],
              borderColor: c.emerald,
              tension: 0.25,
              borderWidth: 2,
              pointRadius: 0,
              pointHoverRadius: 4
            },
            {
              label: 'E2E Request Latency',
              data: [],
              borderColor: c.rose,
              tension: 0.25,
              borderWidth: 1.5,
              pointRadius: 0,
              pointHoverRadius: 4
            }
          ]
        },
        options: {
          ...commonOptions,
          scales: {
            ...commonOptions.scales,
            y: {
              ...commonOptions.scales.y,
              ticks: { callback: v => v + ' ms' },
              title: { display: true, text: 'Latency (ms)' }
            }
          }
        }
      });
    }

    // Chart 5: Speculative Decoding Performance
    const ctxSpecDecode = document.getElementById('chart-specdecode')?.getContext('2d');
    if (ctxSpecDecode) {
      this.charts.specDecode = new Chart(ctxSpecDecode, {
        type: 'line',
        data: {
          labels: [],
          datasets: [
            {
              label: 'Draft Tokens / sec',
              data: [],
              borderColor: c.secondary,
              backgroundColor: c.secondaryAlpha,
              fill: false,
              tension: 0.25,
              borderWidth: 1.5,
              pointRadius: 0
            },
            {
              label: 'Accepted Tokens / sec',
              data: [],
              borderColor: c.emerald,
              backgroundColor: c.emeraldAlpha,
              fill: true,
              tension: 0.25,
              borderWidth: 2,
              pointRadius: 0
            },
            {
              label: 'Acceptance Rate %',
              data: [],
              borderColor: c.amber,
              tension: 0.25,
              borderWidth: 2,
              pointRadius: 0,
              yAxisID: 'yAcceptance'
            }
          ]
        },
        options: {
          ...commonOptions,
          scales: {
            ...commonOptions.scales,
            y: {
              ...commonOptions.scales.y,
              title: { display: true, text: 'Tokens / sec' }
            },
            yAcceptance: {
              position: 'right',
              min: 0,
              max: 100,
              grid: { drawOnChartArea: false },
              ticks: { callback: v => v + '%' },
              title: { display: false }
            }
          }
        }
      });
    }

    // Chart 6: Request Stage Timing Breakdown (Prefill / Decode / Queue)
    const ctxStages = document.getElementById('chart-stages')?.getContext('2d');
    if (ctxStages) {
      this.charts.stages = new Chart(ctxStages, {
        type: 'line',
        data: {
          labels: [],
          datasets: [
            {
              label: 'Decode Phase (ms)',
              data: [],
              borderColor: c.purple,
              backgroundColor: c.purpleAlpha,
              fill: true,
              tension: 0.25,
              borderWidth: 2,
              pointRadius: 0
            },
            {
              label: 'Prefill Phase (ms)',
              data: [],
              borderColor: c.primary,
              backgroundColor: c.primaryAlpha,
              fill: true,
              tension: 0.25,
              borderWidth: 1.5,
              pointRadius: 0
            },
            {
              label: 'Queue Phase (ms)',
              data: [],
              borderColor: c.amber,
              backgroundColor: c.amberAlpha,
              fill: true,
              tension: 0.25,
              borderWidth: 1.5,
              pointRadius: 0
            }
          ]
        },
        options: {
          ...commonOptions,
          scales: {
            ...commonOptions.scales,
            y: {
              ...commonOptions.scales.y,
              stacked: false,
              ticks: { callback: v => v + ' ms' },
              title: { display: true, text: 'Phase Duration (ms)' }
            }
          }
        }
      });
    }
  }

  /**
   * Update all charts with historical data slice
   * @param {Array} historySlice
   */
  updateCharts(historySlice) {
    if (!historySlice || historySlice.length === 0) return;

    const labels = historySlice.map(s => s.timeLabel);

    // Chart 1: Requests
    if (this.charts.requests) {
      this.charts.requests.data.labels = labels;
      this.charts.requests.data.datasets[0].data = historySlice.map(s => s.requests.running);
      this.charts.requests.data.datasets[1].data = historySlice.map(s => s.requests.waiting);
      this.charts.requests.data.datasets[2].data = historySlice.map(s => s.requests.preemptionsTotal);
      this.charts.requests.update('none');
    }

    // Chart 2: Tokens
    if (this.charts.tokens) {
      this.charts.tokens.data.labels = labels;
      this.charts.tokens.data.datasets[0].data = historySlice.map(s => s.tokens.generationRate);
      this.charts.tokens.data.datasets[1].data = historySlice.map(s => s.tokens.promptRate);
      this.charts.tokens.update('none');
    }

    // Chart 3: KV Cache & Prefix
    if (this.charts.kvCache) {
      this.charts.kvCache.data.labels = labels;
      this.charts.kvCache.data.datasets[0].data = historySlice.map(s => s.kvCache.usagePercent);
      this.charts.kvCache.data.datasets[1].data = historySlice.map(s => s.kvCache.prefixCacheHitRateInterval);
      this.charts.kvCache.update('none');
    }

    // Chart 4: Latency
    if (this.charts.latency) {
      this.charts.latency.data.labels = labels;
      this.charts.latency.data.datasets[0].data = historySlice.map(s => s.latency.ttftIntervalMs);
      this.charts.latency.data.datasets[1].data = historySlice.map(s => s.latency.itlIntervalMs);
      this.charts.latency.data.datasets[2].data = historySlice.map(s => s.latency.e2eIntervalMs);
      this.charts.latency.update('none');
    }

    // Chart 5: Speculative Decoding
    if (this.charts.specDecode) {
      this.charts.specDecode.data.labels = labels;
      this.charts.specDecode.data.datasets[0].data = historySlice.map(s => s.specDecode.draftRate);
      this.charts.specDecode.data.datasets[1].data = historySlice.map(s => s.specDecode.acceptedRate);
      this.charts.specDecode.data.datasets[2].data = historySlice.map(s => s.specDecode.acceptanceRateInterval);
      this.charts.specDecode.update('none');
    }

    // Chart 6: Stages
    if (this.charts.stages) {
      this.charts.stages.data.labels = labels;
      this.charts.stages.data.datasets[0].data = historySlice.map(s => s.latency.decodeIntervalMs);
      this.charts.stages.data.datasets[1].data = historySlice.map(s => s.latency.prefillIntervalMs);
      this.charts.stages.data.datasets[2].data = historySlice.map(s => s.latency.queueIntervalMs);
      this.charts.stages.update('none');
    }
  }

  /**
   * Render an ultra-crisp SVG sparkline inside a container element
   * @param {HTMLElement|string} container
   * @param {number[]} data
   * @param {Object} options
   */
  renderSparkline(container, data, options = {}) {
    const el = typeof container === 'string' ? document.getElementById(container) : container;
    if (!el) return;

    if (!data || data.length < 2) {
      el.innerHTML = '<div class="sparkline-empty">Awaiting data...</div>';
      return;
    }

    const width = options.width || el.clientWidth || 160;
    const height = options.height || el.clientHeight || 36;
    const strokeColor = options.color || '#38bdf8';
    const fillColor = options.fillColor || 'rgba(56, 189, 248, 0.12)';
    const padding = 4;

    const min = options.min !== undefined ? options.min : Math.min(...data);
    let max = options.max !== undefined ? options.max : Math.max(...data);
    if (max === min) {
      max = min + 1;
    }

    const dx = (width - padding * 2) / (data.length - 1);
    const scaleY = val => height - padding - ((val - min) / (max - min)) * (height - padding * 2);

    const points = data.map((val, i) => ({
      x: padding + i * dx,
      y: scaleY(val)
    }));

    // Build smooth Bezier path
    let pathD = `M ${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i];
      const p1 = points[i + 1];
      const cpx = (p0.x + p1.x) / 2;
      pathD += ` C ${cpx.toFixed(1)},${p0.y.toFixed(1)} ${cpx.toFixed(1)},${p1.y.toFixed(1)} ${p1.x.toFixed(1)},${p1.y.toFixed(1)}`;
    }

    const lastPoint = points[points.length - 1];
    const firstPoint = points[0];
    const fillD = `${pathD} L ${lastPoint.x.toFixed(1)},${height} L ${firstPoint.x.toFixed(1)},${height} Z`;

    const svg = `
      <svg class="sparkline-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
        <path d="${fillD}" fill="${fillColor}" />
        <path d="${pathD}" fill="none" stroke="${strokeColor}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" />
        <circle cx="${lastPoint.x.toFixed(1)}" cy="${lastPoint.y.toFixed(1)}" r="2.5" fill="${strokeColor}" />
      </svg>
    `;

    el.innerHTML = svg;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DashboardCharts };
}
