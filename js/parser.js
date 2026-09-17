/**
 * Prometheus text exposition format parser
 * Handles gauges, counters, histograms, summaries, labels, scientific notation, and special values (+Inf, NaN).
 */
class PrometheusParser {
  /**
   * Parses Prometheus text data into structured format
   * @param {string} text
   * @returns {{ metrics: Object, help: Object, type: Object, rawLinesCount: number }}
   */
  static parse(text) {
    if (typeof text !== 'string') {
      return { metrics: {}, help: {}, type: {}, rawLinesCount: 0 };
    }

    const lines = text.split(/\r?\n/);
    const metrics = {};
    const help = {};
    const type = {};

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      if (line.startsWith('#')) {
        const helpMatch = line.match(/^#\s+HELP\s+([a-zA-Z_:][a-zA-Z0-9_:]*)\s+(.*)$/);
        if (helpMatch) {
          help[helpMatch[1]] = helpMatch[2];
          continue;
        }

        const typeMatch = line.match(/^#\s+TYPE\s+([a-zA-Z_:][a-zA-Z0-9_:]*)\s+([a-zA-Z]+)$/);
        if (typeMatch) {
          type[typeMatch[1]] = typeMatch[2].toLowerCase();
          continue;
        }

        continue;
      }

      // Parse metric line: metric_name{label1="val1",...} value [timestamp]
      // or metric_name value [timestamp]
      const parsedSample = this.parseMetricLine(line);
      if (parsedSample) {
        if (!metrics[parsedSample.name]) {
          metrics[parsedSample.name] = [];
        }
        metrics[parsedSample.name].push(parsedSample);
      }
    }

    return {
      metrics,
      help,
      type,
      rawLinesCount: lines.length
    };
  }

  /**
   * Parse a single Prometheus sample line
   * @param {string} line
   */
  static parseMetricLine(line) {
    let name = '';
    let labels = {};
    let value = 0;

    const labelStart = line.indexOf('{');
    if (labelStart !== -1) {
      name = line.substring(0, labelStart).trim();
      const labelEnd = line.lastIndexOf('}');
      if (labelEnd === -1 || labelEnd < labelStart) return null;

      const labelsStr = line.substring(labelStart + 1, labelEnd);
      labels = this.parseLabels(labelsStr);

      const rest = line.substring(labelEnd + 1).trim();
      const valMatch = rest.match(/^([-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?|[+-]?Inf|NaN)/i);
      if (!valMatch) return null;
      value = this.parseValue(valMatch[1]);
    } else {
      const parts = line.split(/\s+/);
      if (parts.length < 2) return null;
      name = parts[0];
      value = this.parseValue(parts[1]);
    }

    return {
      name,
      labels,
      value,
      raw: line
    };
  }

  /**
   * Parse comma-separated key="val" labels
   * @param {string} labelsStr
   */
  static parseLabels(labelsStr) {
    const labels = {};
    if (!labelsStr.trim()) return labels;

    // Match key="value" pairs, handling escaped characters
    const regex = /([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*"((?:\\.|[^"\\])*)"/g;
    let match;
    while ((match = regex.exec(labelsStr)) !== null) {
      const key = match[1];
      const val = match[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\').replace(/\\n/g, '\n');
      labels[key] = val;
    }
    return labels;
  }

  /**
   * Parse numeric or float value
   * @param {string} valStr
   */
  static parseValue(valStr) {
    if (valStr === '+Inf' || valStr === 'Inf') return Infinity;
    if (valStr === '-Inf') return -Infinity;
    if (valStr === 'NaN') return NaN;
    const num = parseFloat(valStr);
    return isNaN(num) ? 0 : num;
  }

  /**
   * Extract a scalar or matching metric sample
   * @param {Object} parsed
   * @param {string} name
   * @param {Object} [matchLabels]
   * @returns {number|null}
   */
  static getValue(parsed, name, matchLabels = null) {
    if (!parsed || !parsed.metrics || !parsed.metrics[name]) return null;
    const samples = parsed.metrics[name];
    if (samples.length === 0) return null;

    if (!matchLabels) {
      return samples[0].value;
    }

    const found = samples.find(s => {
      for (const [k, v] of Object.entries(matchLabels)) {
        if (s.labels[k] !== v) return false;
      }
      return true;
    });

    return found ? found.value : null;
  }

  /**
   * Extract sum of metric samples matching criteria
   * @param {Object} parsed
   * @param {string} name
   * @param {Object} [matchLabels]
   * @returns {number}
   */
  static getSum(parsed, name, matchLabels = null) {
    if (!parsed || !parsed.metrics || !parsed.metrics[name]) return 0;
    const samples = parsed.metrics[name];

    let total = 0;
    for (const s of samples) {
      if (matchLabels) {
        let match = true;
        for (const [k, v] of Object.entries(matchLabels)) {
          if (s.labels[k] !== v) {
            match = false;
            break;
          }
        }
        if (!match) continue;
      }
      total += s.value;
    }
    return total;
  }

  /**
   * Extract histogram data (sum, count, average, buckets)
   * @param {Object} parsed
   * @param {string} baseName
   * @param {Object} [matchLabels]
   */
  static getHistogram(parsed, baseName, matchLabels = null) {
    const count = this.getValue(parsed, `${baseName}_count`, matchLabels) ?? 0;
    const sum = this.getValue(parsed, `${baseName}_sum`, matchLabels) ?? 0;
    const avg = count > 0 ? sum / count : 0;

    const bucketMetricName = `${baseName}_bucket`;
    const buckets = [];
    if (parsed && parsed.metrics && parsed.metrics[bucketMetricName]) {
      const samples = parsed.metrics[bucketMetricName];
      for (const s of samples) {
        if (matchLabels) {
          let match = true;
          for (const [k, v] of Object.entries(matchLabels)) {
            if (k !== 'le' && s.labels[k] !== v) {
              match = false;
              break;
            }
          }
          if (!match) continue;
        }
        buckets.push({
          le: s.labels.le === '+Inf' ? Infinity : parseFloat(s.labels.le),
          count: s.value
        });
      }
      buckets.sort((a, b) => a.le - b.le);
    }

    return { count, sum, avg, buckets };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PrometheusParser };
}
