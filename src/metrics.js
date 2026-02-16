/**
 * Prometheus 指标收集器
 * 提供 /metrics 端点所需的指标
 */

export class MetricsCollector {
	constructor() {
		this.counters = new Map();
		this.gauges = new Map();
		this.histograms = new Map();
	}

	// 计数器：累加值
	incrementCounter(name, labels = {}, value = 1) {
		const key = this._makeKey(name, labels);
		const current = this.counters.get(key) || { name, labels, value: 0 };
		current.value += value;
		this.counters.set(key, current);
	}

	// 仪表盘：设置当前值
	setGauge(name, labels = {}, value) {
		const key = this._makeKey(name, labels);
		this.gauges.set(key, { name, labels, value });
	}

	// 直方图：记录延迟分布
	recordHistogram(name, labels = {}, value) {
		const key = this._makeKey(name, labels);
		if (!this.histograms.has(key)) {
			this.histograms.set(key, {
				name,
				labels,
				sum: 0,
				count: 0,
				buckets: new Map(), // bucket -> count
			});
		}
		const hist = this.histograms.get(key);
		hist.sum += value;
		hist.count++;

		// 标准延迟桶 (ms)
		const buckets = [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
		for (const bucket of buckets) {
			if (value <= bucket) {
				hist.buckets.set(bucket, (hist.buckets.get(bucket) || 0) + 1);
			}
		}
	}

	// 生成 Prometheus 格式输出
	toPrometheusFormat() {
		const lines = [];

		// Counters
		for (const metric of this.counters.values()) {
			lines.push(`# TYPE ${metric.name} counter`);
			lines.push(
				`${metric.name}${this._formatLabels(metric.labels)} ${metric.value}`,
			);
		}

		// Gauges
		for (const metric of this.gauges.values()) {
			lines.push(`# TYPE ${metric.name} gauge`);
			lines.push(
				`${metric.name}${this._formatLabels(metric.labels)} ${metric.value}`,
			);
		}

		// Histograms
		for (const hist of this.histograms.values()) {
			lines.push(`# TYPE ${hist.name} histogram`);

			// Buckets
			for (const [bucket, count] of hist.buckets.entries()) {
				const bucketLabels = { ...hist.labels, le: bucket };
				lines.push(
					`${hist.name}_bucket${this._formatLabels(bucketLabels)} ${count}`,
				);
			}

			// +Inf bucket
			const infLabels = { ...hist.labels, le: "+Inf" };
			lines.push(
				`${hist.name}_bucket${this._formatLabels(infLabels)} ${hist.count}`,
			);

			// Sum and count
			lines.push(
				`${hist.name}_sum${this._formatLabels(hist.labels)} ${hist.sum}`,
			);
			lines.push(
				`${hist.name}_count${this._formatLabels(hist.labels)} ${hist.count}`,
			);
		}

		return lines.join("\n") + "\n";
	}

	_makeKey(name, labels) {
		const labelStr = Object.entries(labels)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([k, v]) => `${k}="${v}"`)
			.join(",");
		return `${name}{${labelStr}}`;
	}

	_formatLabels(labels) {
		if (Object.keys(labels).length === 0) return "";
		const labelStr = Object.entries(labels)
			.map(([k, v]) => `${k}="${v}"`)
			.join(",");
		return `{${labelStr}}`;
	}

	// 重置所有指标
	reset() {
		this.counters.clear();
		this.gauges.clear();
		this.histograms.clear();
	}
}

// 全局实例
export const metrics = new MetricsCollector();
