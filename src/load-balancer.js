export class LoadBalancer {
	constructor(strategy = "round-robin") {
		this.strategy = strategy;
		this.roundRobinIndex = 0;
	}

	setStrategy(strategy) {
		const validStrategies = [
			"round-robin",
			"random",
			"least-used",
			"least-error",
		];
		if (validStrategies.includes(strategy)) {
			this.strategy = strategy;
		}
	}

	selectAccount(accounts) {
		if (!accounts || accounts.length === 0) return null;

		let selected;
		switch (this.strategy) {
			case "random":
				selected = accounts[Math.floor(Math.random() * accounts.length)];
				break;
			case "least-used":
				selected = accounts.reduce((a, b) =>
					(a.request_count || 0) < (b.request_count || 0) ? a : b,
				);
				break;
			case "least-error":
				selected = accounts.reduce((a, b) =>
					(a.error_count || 0) < (b.error_count || 0) ? a : b,
				);
				break;
			default:
				selected = accounts[this.roundRobinIndex % accounts.length];
				this.roundRobinIndex++;
		}

		return selected;
	}
}
