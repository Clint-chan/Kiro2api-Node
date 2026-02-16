let machineTooltipTimer = null;

function showMachineIdTooltip(event, machineId, source, title, desc) {
	const tooltip = document.getElementById("global-machine-tooltip");
	if (machineTooltipTimer) clearTimeout(machineTooltipTimer);

	if (!tooltip) return;

	const contentHtml = `
                <div class="flex items-start justify-between mb-3">
                    <div>
                        <div class="text-xs font-bold text-gray-800 mb-0.5">Machine ID</div>
                        <div class="text-[10px] font-medium text-gray-500 uppercase tracking-wide">${title} (${source})</div>
                    </div>
                    <button onclick="copyText('${machineId}', event)" class="text-gray-400 hover:text-blue-600 transition p-1" title="复制">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
                    </button>
                </div>
                <div class="bg-gray-50 rounded-lg px-3 py-2 mb-3 font-mono text-[10px] leading-relaxed text-gray-600 break-all border border-gray-100 select-all">
                    ${machineId}
                </div>
                <div class="text-[10px] text-gray-500 leading-relaxed border-t border-gray-100 pt-2">
                    ${desc}
                </div>
            `;
	tooltip.innerHTML = contentHtml;

	const rect = event.currentTarget.getBoundingClientRect();
	tooltip.style.left = rect.left + "px";
	tooltip.style.top = rect.bottom + 8 + "px";
	tooltip.classList.remove("hidden", "opacity-0", "invisible");

	const tooltipRect = tooltip.getBoundingClientRect();
	if (tooltipRect.right > window.innerWidth - 20) {
		tooltip.style.left = window.innerWidth - tooltipRect.width - 20 + "px";
	}
}

function hideMachineIdTooltip() {
	const tooltip = document.getElementById("global-machine-tooltip");
	if (tooltip) {
		machineTooltipTimer = setTimeout(() => {
			tooltip.classList.add("opacity-0", "invisible");
			setTimeout(() => tooltip.classList.add("hidden"), 200);
		}, 300);
	}
}

function keepTooltipOpen() {
	if (machineTooltipTimer) clearTimeout(machineTooltipTimer);
}
