/**
 * vLLM Metrics Store & Telemetry Processor
 * Computes instantaneous values, rates (tokens/s, req/s, CPU %), histogram averages,
 * and maintains historical time-series buffers for sparklines and large charts.
 */
class VLLMMetricsStore {
  constructor(options = {}) {
    this.maxHistoryPoints = options.maxHistoryPoints || 720; // 2 hours at 10s intervals
    this.history = [];
    this.lastRaw = null;
    this.lastParsed = null;
    this.lastTimestamp = null;
    this.previousSnapshot = null;
    this.currentSnapshot = null;
  }

  /**
   * Process incoming raw Prometheus text and compute derived snapshot
   * @param {string} rawText
   * @param {number} [timestamp]
   * @returns {Object} Extracted & derived snapshot
   */
  processMetrics(rawText, timestamp = Date.now()) {
    const parsed = PrometheusParser.parse(rawText);
    this.lastRaw = rawText;
    this.lastParsed = parsed;

    const dt = this.lastTimestamp ? Math.max((timestamp - this.lastTimestamp) / 1000, 0.001) : 0;
    this.lastTimestamp = timestamp;

    const snapshot = this.extractSnapshot(parsed, timestamp, dt);

    // Store snapshot
    this.previousSnapshot = this.currentSnapshot;
    this.currentSnapshot = snapshot;
    this.history.push(snapshot);

    if (this.history.length > this.maxHistoryPoints) {
      this.history.shift();
    }

    return snapshot;
  }

  /**
   * Reset store history
   */
  clearHistory() {
    this.history = [];
    this.previousSnapshot = null;
    this.currentSnapshot = null;
    this.lastTimestamp = null;
  }

  /**
   * Extract and calculate all metrics from parsed data
   */
  extractSnapshot(parsed, timestamp, dt) {
    const prev = this.currentSnapshot;

    // Detect model name & engine id from labels
    let modelName = 'Unknown';
    let engineId = '0';
    if (parsed.metrics['vllm:num_requests_running'] && parsed.metrics['vllm:num_requests_running'][0]) {
      const l = parsed.metrics['vllm:num_requests_running'][0].labels;
      modelName = l.model_name || modelName;
      engineId = l.engine ?? engineId;
    } else if (parsed.metrics['vllm:prompt_tokens_total'] && parsed.metrics['vllm:prompt_tokens_total'][0]) {
      const l = parsed.metrics['vllm:prompt_tokens_total'][0].labels;
      modelName = l.model_name || modelName;
      engineId = l.engine ?? engineId;
    }

    // Engine sleep state
    let sleepState = 'awake';
    if (PrometheusParser.getValue(parsed, 'vllm:engine_sleep_state', { sleep_state: 'discard_all' }) === 1) {
      sleepState = 'discard_all';
    } else if (PrometheusParser.getValue(parsed, 'vllm:engine_sleep_state', { sleep_state: 'weights_offloaded' }) === 1) {
      sleepState = 'weights_offloaded';
    } else if (PrometheusParser.getValue(parsed, 'vllm:engine_sleep_state', { sleep_state: 'awake' }) === 1) {
      sleepState = 'awake';
    }

    // Gauges
    const kvCacheUsagePerc = (PrometheusParser.getValue(parsed, 'vllm:kv_cache_usage_perc') ?? 0) * 100;
    const numRequestsRunning = PrometheusParser.getValue(parsed, 'vllm:num_requests_running') ?? 0;
    const numRequestsWaiting = PrometheusParser.getValue(parsed, 'vllm:num_requests_waiting') ?? 0;
    const waitingCapacity = PrometheusParser.getValue(parsed, 'vllm:num_requests_waiting_by_reason', { reason: 'capacity' }) ?? 0;
    const waitingDeferred = PrometheusParser.getValue(parsed, 'vllm:num_requests_waiting_by_reason', { reason: 'deferred' }) ?? 0;

    // Counters (Cumulative)
    const promptTokensTotal = PrometheusParser.getValue(parsed, 'vllm:prompt_tokens_total') ?? 0;
    const generationTokensTotal = PrometheusParser.getValue(parsed, 'vllm:generation_tokens_total') ?? 0;
    const requestsSuccessTotal = PrometheusParser.getValue(parsed, 'vllm:request_success_total') ?? 0;
    const numPreemptionsTotal = PrometheusParser.getValue(parsed, 'vllm:num_preemptions_total') ?? 0;

    // Prefix cache
    const prefixCacheQueriesTotal = PrometheusParser.getValue(parsed, 'vllm:prefix_cache_queries_total') ?? 0;
    const prefixCacheHitsTotal = PrometheusParser.getValue(parsed, 'vllm:prefix_cache_hits_total') ?? 0;
    const prefixCacheHitRateCumulative = prefixCacheQueriesTotal > 0 ? (prefixCacheHitsTotal / prefixCacheQueriesTotal) * 100 : 0;

    // Speculative decoding
    const specDraftTokensTotal = PrometheusParser.getValue(parsed, 'vllm:spec_decode_num_draft_tokens_total') ?? 0;
    const specAcceptedTokensTotal = PrometheusParser.getValue(parsed, 'vllm:spec_decode_num_accepted_tokens_total') ?? 0;
    const specDraftsTotal = PrometheusParser.getValue(parsed, 'vllm:spec_decode_num_drafts_total') ?? 0;
    const specAcceptanceRateCumulative = specDraftTokensTotal > 0 ? (specAcceptedTokensTotal / specDraftTokensTotal) * 100 : 0;
    const specPos0Accepted = PrometheusParser.getValue(parsed, 'vllm:spec_decode_num_accepted_tokens_per_pos_total', { position: '0' }) ?? 0;
    const specPos1Accepted = PrometheusParser.getValue(parsed, 'vllm:spec_decode_num_accepted_tokens_per_pos_total', { position: '1' }) ?? 0;

    // Tool Parser Invocations
    const toolCallsTotal = PrometheusParser.getSum(parsed, 'vllm:tool_call_parser_invocations_total', { outcome: 'tool_call' });
    const noToolCallsTotal = PrometheusParser.getSum(parsed, 'vllm:tool_call_parser_invocations_total', { outcome: 'no_tool_call' });
    const toolInvocationsTotal = toolCallsTotal + noToolCallsTotal;
    const toolCallRatioCumulative = toolInvocationsTotal > 0 ? (toolCallsTotal / toolInvocationsTotal) * 100 : 0;

    // Process & System
    const processCpuSecondsTotal = PrometheusParser.getValue(parsed, 'process_cpu_seconds_total') ?? 0;
    const processResidentMemoryBytes = PrometheusParser.getValue(parsed, 'process_resident_memory_bytes') ?? 0;
    const processVirtualMemoryBytes = PrometheusParser.getValue(parsed, 'process_virtual_memory_bytes') ?? 0;
    const processStartTimeSeconds = PrometheusParser.getValue(parsed, 'process_start_time_seconds') ?? 0;
    const processOpenFds = PrometheusParser.getValue(parsed, 'process_open_fds') ?? 0;
    const processMaxFds = PrometheusParser.getValue(parsed, 'process_max_fds') ?? 0;

    // Latency Histograms
    const ttftHist = PrometheusParser.getHistogram(parsed, 'vllm:time_to_first_token_seconds');
    const itlHist = PrometheusParser.getHistogram(parsed, 'vllm:inter_token_latency_seconds');
    const e2eHist = PrometheusParser.getHistogram(parsed, 'vllm:e2e_request_latency_seconds');
    const queueHist = PrometheusParser.getHistogram(parsed, 'vllm:request_queue_time_seconds');
    const inferenceHist = PrometheusParser.getHistogram(parsed, 'vllm:request_inference_time_seconds');
    const prefillHist = PrometheusParser.getHistogram(parsed, 'vllm:request_prefill_time_seconds');
    const decodeHist = PrometheusParser.getHistogram(parsed, 'vllm:request_decode_time_seconds');

    // Interval Delta Rates (rates per second over the last polling window dt)
    let promptTokensRate = 0;
    let generationTokensRate = 0;
    let totalTokensRate = 0;
    let requestsSuccessRate = 0;
    let preemptionsRate = 0;
    let cpuPercent = 0;
    let prefixCacheHitRateInterval = prefixCacheHitRateCumulative;
    let specAcceptanceRateInterval = specAcceptanceRateCumulative;
    let specDraftTokensRate = 0;
    let specAcceptedTokensRate = 0;
    let toolCallsRate = 0;
    let toolCallRatioInterval = toolCallRatioCumulative;

    // Interval latency (averages for requests completed within interval)
    let ttftIntervalMs = (ttftHist.avg || 0) * 1000;
    let itlIntervalMs = (itlHist.avg || 0) * 1000;
    let e2eIntervalMs = (e2eHist.avg || 0) * 1000;
    let queueIntervalMs = (queueHist.avg || 0) * 1000;
    let prefillIntervalMs = (prefillHist.avg || 0) * 1000;
    let decodeIntervalMs = (decodeHist.avg || 0) * 1000;

    if (prev && dt > 0) {
      // Calculate token rates
      const promptDelta = Math.max(0, promptTokensTotal - prev.rawCounters.promptTokensTotal);
      const genDelta = Math.max(0, generationTokensTotal - prev.rawCounters.generationTokensTotal);
      const reqDelta = Math.max(0, requestsSuccessTotal - prev.rawCounters.requestsSuccessTotal);
      const preDelta = Math.max(0, numPreemptionsTotal - prev.rawCounters.numPreemptionsTotal);

      promptTokensRate = promptDelta / dt;
      generationTokensRate = genDelta / dt;
      totalTokensRate = promptTokensRate + generationTokensRate;
      requestsSuccessRate = reqDelta / dt;
      preemptionsRate = preDelta / dt;

      // Tool calls delta
      const toolCallsDelta = Math.max(0, toolCallsTotal - (prev.rawCounters.toolCallsTotal || 0));
      const toolInvocationsDelta = Math.max(0, toolInvocationsTotal - (prev.rawCounters.toolInvocationsTotal || 0));
      toolCallsRate = toolCallsDelta / dt;
      if (toolInvocationsDelta > 0) {
        toolCallRatioInterval = (toolCallsDelta / toolInvocationsDelta) * 100;
      }

      // CPU %
      const cpuDelta = Math.max(0, processCpuSecondsTotal - prev.rawCounters.processCpuSecondsTotal);
      cpuPercent = Math.min((cpuDelta / dt) * 100, 3200); // multi-core scale

      // Prefix cache interval hit rate
      const queriesDelta = prefixCacheQueriesTotal - prev.rawCounters.prefixCacheQueriesTotal;
      const hitsDelta = prefixCacheHitsTotal - prev.rawCounters.prefixCacheHitsTotal;
      if (queriesDelta > 0) {
        prefixCacheHitRateInterval = (Math.max(0, hitsDelta) / queriesDelta) * 100;
      }

      // Speculative decoding interval
      const draftDelta = specDraftTokensTotal - prev.rawCounters.specDraftTokensTotal;
      const acceptedDelta = specAcceptedTokensTotal - prev.rawCounters.specAcceptedTokensTotal;
      specDraftTokensRate = Math.max(0, draftDelta) / dt;
      specAcceptedTokensRate = Math.max(0, acceptedDelta) / dt;
      if (draftDelta > 0) {
        specAcceptanceRateInterval = (Math.max(0, acceptedDelta) / draftDelta) * 100;
      }

      // TTFT interval delta
      const ttftCountDelta = ttftHist.count - prev.rawCounters.ttftCount;
      const ttftSumDelta = ttftHist.sum - prev.rawCounters.ttftSum;
      if (ttftCountDelta > 0 && ttftSumDelta >= 0) {
        ttftIntervalMs = (ttftSumDelta / ttftCountDelta) * 1000;
      }

      // ITL interval delta
      const itlCountDelta = itlHist.count - prev.rawCounters.itlCount;
      const itlSumDelta = itlHist.sum - prev.rawCounters.itlSum;
      if (itlCountDelta > 0 && itlSumDelta >= 0) {
        itlIntervalMs = (itlSumDelta / itlCountDelta) * 1000;
      }

      // E2E interval delta
      const e2eCountDelta = e2eHist.count - prev.rawCounters.e2eCount;
      const e2eSumDelta = e2eHist.sum - prev.rawCounters.e2eSum;
      if (e2eCountDelta > 0 && e2eSumDelta >= 0) {
        e2eIntervalMs = (e2eSumDelta / e2eCountDelta) * 1000;
      }

      // Phase timing interval deltas
      const queueCountDelta = queueHist.count - prev.rawCounters.queueCount;
      const queueSumDelta = queueHist.sum - prev.rawCounters.queueSum;
      if (queueCountDelta > 0 && queueSumDelta >= 0) {
        queueIntervalMs = (queueSumDelta / queueCountDelta) * 1000;
      }

      const prefillCountDelta = prefillHist.count - prev.rawCounters.prefillCount;
      const prefillSumDelta = prefillHist.sum - prev.rawCounters.prefillSum;
      if (prefillCountDelta > 0 && prefillSumDelta >= 0) {
        prefillIntervalMs = (prefillSumDelta / prefillCountDelta) * 1000;
      }

      const decodeCountDelta = decodeHist.count - prev.rawCounters.decodeCount;
      const decodeSumDelta = decodeHist.sum - prev.rawCounters.decodeSum;
      if (decodeCountDelta > 0 && decodeSumDelta >= 0) {
        decodeIntervalMs = (decodeSumDelta / decodeCountDelta) * 1000;
      }
    }

    const uptimeSeconds = processStartTimeSeconds > 0 ? Math.max(0, (timestamp / 1000) - processStartTimeSeconds) : 0;

    return {
      timestamp,
      timeLabel: new Date(timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      dt,
      modelInfo: {
        modelName,
        engineId,
        sleepState,
        uptimeSeconds,
        startTime: processStartTimeSeconds > 0 ? new Date(processStartTimeSeconds * 1000).toLocaleString() : 'N/A'
      },
      system: {
        cpuPercent,
        memoryRssBytes: processResidentMemoryBytes,
        memoryRssGb: processResidentMemoryBytes / (1024 * 1024 * 1024),
        memoryVmsBytes: processVirtualMemoryBytes,
        memoryVmsGb: processVirtualMemoryBytes / (1024 * 1024 * 1024),
        openFds: processOpenFds,
        maxFds: processMaxFds
      },
      requests: {
        running: numRequestsRunning,
        waiting: numRequestsWaiting,
        waitingCapacity,
        waitingDeferred,
        successTotal: requestsSuccessTotal,
        successRate: requestsSuccessRate,
        preemptionsTotal: numPreemptionsTotal,
        preemptionsRate
      },
      tokens: {
        promptTotal: promptTokensTotal,
        generationTotal: generationTokensTotal,
        totalCumulative: promptTokensTotal + generationTokensTotal,
        promptRate: promptTokensRate,
        generationRate: generationTokensRate,
        totalRate: totalTokensRate
      },
      kvCache: {
        usagePercent: kvCacheUsagePerc,
        prefixCacheQueriesTotal,
        prefixCacheHitsTotal,
        prefixCacheHitRateCumulative,
        prefixCacheHitRateInterval
      },
      specDecode: {
        active: specDraftTokensTotal > 0,
        draftTokensTotal: specDraftTokensTotal,
        acceptedTokensTotal: specAcceptedTokensTotal,
        draftsTotal: specDraftsTotal,
        acceptanceRateCumulative: specAcceptanceRateCumulative,
        acceptanceRateInterval: specAcceptanceRateInterval,
        draftRate: specDraftTokensRate,
        acceptedRate: specAcceptedTokensRate,
        pos0Accepted: specPos0Accepted,
        pos1Accepted: specPos1Accepted
      },
      tools: {
        active: toolInvocationsTotal > 0,
        callsTotal: toolCallsTotal,
        noCallsTotal: noToolCallsTotal,
        invocationsTotal: toolInvocationsTotal,
        ratioCumulative: toolCallRatioCumulative,
        ratioInterval: toolCallRatioInterval,
        callsRate: toolCallsRate
      },
      latency: {
        ttftAvgMs: ttftHist.avg * 1000,
        ttftIntervalMs,
        itlAvgMs: itlHist.avg * 1000,
        itlIntervalMs,
        e2eAvgMs: e2eHist.avg * 1000,
        e2eIntervalMs,
        queueAvgMs: queueHist.avg * 1000,
        queueIntervalMs,
        prefillAvgMs: prefillHist.avg * 1000,
        prefillIntervalMs,
        decodeAvgMs: decodeHist.avg * 1000,
        decodeIntervalMs,
        ttftHist,
        itlHist,
        e2eHist
      },
      rawCounters: {
        promptTokensTotal,
        generationTokensTotal,
        requestsSuccessTotal,
        numPreemptionsTotal,
        toolCallsTotal,
        toolInvocationsTotal,
        prefixCacheQueriesTotal,
        prefixCacheHitsTotal,
        specDraftTokensTotal,
        specAcceptedTokensTotal,
        processCpuSecondsTotal,
        ttftCount: ttftHist.count,
        ttftSum: ttftHist.sum,
        itlCount: itlHist.count,
        itlSum: itlHist.sum,
        e2eCount: e2eHist.count,
        e2eSum: e2eHist.sum,
        queueCount: queueHist.count,
        queueSum: queueHist.sum,
        prefillCount: prefillHist.count,
        prefillSum: prefillHist.sum,
        decodeCount: decodeHist.count,
        decodeSum: decodeHist.sum
      }
    };
  }

  /**
   * Get filtered history for a specified time duration (in minutes) or count
   * @param {number|string} duration 'all' or minutes (5, 15, 30, 60)
   */
  getHistorySlice(duration = 15) {
    if (this.history.length === 0) return [];
    if (duration === 'all' || duration <= 0) return this.history;

    const cutoff = Date.now() - duration * 60 * 1000;
    const filtered = this.history.filter(s => s.timestamp >= cutoff);
    return filtered.length > 0 ? filtered : this.history.slice(-30);
  }

  /**
   * Get array of recent values for a sparkline
   * @param {string} path Dot-separated path like 'kvCache.usagePercent' or 'tokens.generationRate'
   * @param {number} count Number of points (default 20)
   * @returns {number[]}
   */
  getSparklineData(path, count = 20) {
    const slice = this.history.slice(-count);
    return slice.map(item => {
      const parts = path.split('.');
      let val = item;
      for (const p of parts) {
        val = val ? val[p] : 0;
      }
      return typeof val === 'number' && !isNaN(val) ? val : 0;
    });
  }

  /**
   * Export all recorded history as JSON string
   */
  exportJSON() {
    return JSON.stringify({
      exportedAt: new Date().toISOString(),
      pointsCount: this.history.length,
      history: this.history
    }, null, 2);
  }

  /**
   * Export all recorded history as CSV
   */
  exportCSV() {
    if (this.history.length === 0) return '';
    const headers = [
      'Timestamp',
      'Time',
      'Model',
      'Running Requests',
      'Waiting Requests',
      'KV Cache Usage %',
      'Gen Tokens Rate (tok/s)',
      'Prompt Tokens Rate (tok/s)',
      'Total Tokens Rate (tok/s)',
      'Req Success Rate (req/s)',
      'Total Requests Success',
      'Tool Calls Total',
      'Tool Calls Rate (call/s)',
      'Preemptions Total',
      'TTFT Interval (ms)',
      'ITL Interval (ms)',
      'E2E Latency Interval (ms)',
      'Prefix Cache Hit %',
      'Spec Decode Acceptance %',
      'CPU %',
      'RSS Memory (GB)'
    ];

    const rows = this.history.map(s => [
      s.timestamp,
      `"${s.timeLabel}"`,
      `"${s.modelInfo.modelName}"`,
      s.requests.running,
      s.requests.waiting,
      s.kvCache.usagePercent.toFixed(2),
      s.tokens.generationRate.toFixed(2),
      s.tokens.promptRate.toFixed(2),
      s.tokens.totalRate.toFixed(2),
      s.requests.successRate.toFixed(2),
      s.requests.successTotal,
      s.tools.callsTotal,
      s.tools.callsRate.toFixed(2),
      s.requests.preemptionsTotal,
      s.latency.ttftIntervalMs.toFixed(2),
      s.latency.itlIntervalMs.toFixed(2),
      s.latency.e2eIntervalMs.toFixed(2),
      s.kvCache.prefixCacheHitRateInterval.toFixed(2),
      s.specDecode.acceptanceRateInterval.toFixed(2),
      s.system.cpuPercent.toFixed(1),
      s.system.memoryRssGb.toFixed(3)
    ]);

    return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { VLLMMetricsStore };
}
