// SLO Dashboard page

document.addEventListener('DOMContentLoaded', async () => {
    const kpiRow = document.getElementById('kpi-row');
    if (!kpiRow) return;

    const resp = await fetch('/api/slo');
    const metrics = await resp.json();

    // Filter out null/onboarding entries
    const active = metrics.filter(m => m.uptime_pct != null);

    // Calculate aggregates
    const avgUptime = active.length > 0
        ? (active.reduce((s, m) => s + m.uptime_pct, 0) / active.length).toFixed(2)
        : 'N/A';
    const avgAck = active.length > 0
        ? Math.round(active.reduce((s, m) => s + m.avg_time_to_ack_min, 0) / active.length)
        : 'N/A';
    const avgResolve = active.length > 0
        ? (active.reduce((s, m) => s + m.avg_time_to_resolve_hrs, 0) / active.length).toFixed(1)
        : 'N/A';
    const avgFCR = active.length > 0
        ? Math.round(active.reduce((s, m) => s + m.first_contact_resolution_pct, 0) / active.length)
        : 'N/A';
    const sloMet = active.filter(m => m.slo_met).length;

    // KPI cards
    const uptimeColor = parseFloat(avgUptime) >= 99.9 ? '#00d4aa' : '#ffc107';
    kpiRow.innerHTML = `
        <div class="kpi-card">
            <div class="kpi-value" style="color:${uptimeColor}">${avgUptime}%</div>
            <div class="kpi-label">Global Uptime</div>
            <div class="kpi-sub">${sloMet}/${active.length} sites meeting SLO</div>
        </div>
        <div class="kpi-card">
            <div class="kpi-value">${avgAck}m</div>
            <div class="kpi-label">Avg Time to Acknowledge</div>
            <div class="kpi-sub">Target: &lt;15 min</div>
        </div>
        <div class="kpi-card">
            <div class="kpi-value">${avgResolve}h</div>
            <div class="kpi-label">Avg Time to Resolve</div>
            <div class="kpi-sub">Target: &lt;4 hours</div>
        </div>
        <div class="kpi-card">
            <div class="kpi-value">${avgFCR}%</div>
            <div class="kpi-label">First Contact Resolution</div>
            <div class="kpi-sub">Target: &gt;80%</div>
        </div>
    `;

    // Metrics table
    const custResp = await fetch('/api/customers');
    const customers = await custResp.json();
    const custMap = {};
    customers.forEach(c => custMap[c.id] = c.name);

    const tableContainer = document.getElementById('slo-table-container');
    if (tableContainer) {
        tableContainer.innerHTML = `
            <table class="data-table">
                <thead>
                    <tr>
                        <th>Customer</th>
                        <th>Uptime</th>
                        <th>Ack Time</th>
                        <th>Resolve Time</th>
                        <th>FCR</th>
                        <th>P1</th>
                        <th>P2</th>
                        <th>P3</th>
                        <th>SLO Met</th>
                    </tr>
                </thead>
                <tbody>
                    ${metrics.map(m => {
                        const name = custMap[m.customer_id] || m.customer_id;
                        if (m.uptime_pct == null) {
                            return `<tr><td>${name}</td><td colspan="8" class="muted">Onboarding</td></tr>`;
                        }
                        const uptimeClass = m.uptime_pct >= m.slo_target_uptime ? '' : 'cell-warn';
                        const sloClass = m.slo_met ? 'match-pass' : 'match-fail';
                        return `
                            <tr>
                                <td><a href="/customer/${m.customer_id}">${name}</a></td>
                                <td class="${uptimeClass}">${m.uptime_pct}%</td>
                                <td>${m.avg_time_to_ack_min}m</td>
                                <td>${m.avg_time_to_resolve_hrs}h</td>
                                <td>${m.first_contact_resolution_pct}%</td>
                                <td>${m.p1_incidents > 0 ? `<span class="severity-badge severity-p1">${m.p1_incidents}</span>` : '0'}</td>
                                <td>${m.p2_incidents > 0 ? `<span class="severity-badge severity-p2">${m.p2_incidents}</span>` : '0'}</td>
                                <td>${m.p3_incidents}</td>
                                <td><span class="${sloClass}">${m.slo_met ? 'Yes' : 'No'}</span></td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        `;
    }

    // Incident chart
    const ctx = document.getElementById('incident-chart');
    if (ctx && typeof Chart !== 'undefined') {
        const labels = metrics.filter(m => m.uptime_pct != null).map(m => custMap[m.customer_id] || m.customer_id);
        new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels.map(l => l.length > 20 ? l.substring(0, 20) + '...' : l),
                datasets: [
                    {
                        label: 'P1',
                        data: metrics.filter(m => m.uptime_pct != null).map(m => m.p1_incidents),
                        backgroundColor: '#ff4757'
                    },
                    {
                        label: 'P2',
                        data: metrics.filter(m => m.uptime_pct != null).map(m => m.p2_incidents),
                        backgroundColor: '#ffc107'
                    },
                    {
                        label: 'P3',
                        data: metrics.filter(m => m.uptime_pct != null).map(m => m.p3_incidents),
                        backgroundColor: '#5b8def'
                    }
                ]
            },
            options: {
                responsive: true,
                plugins: {
                    title: { display: true, text: 'Incidents by Severity (May 2026)', color: '#e8edf3' },
                    legend: { labels: { color: '#8899aa' } }
                },
                scales: {
                    x: { stacked: true, ticks: { color: '#8899aa' }, grid: { color: '#2a3a4a' } },
                    y: { stacked: true, ticks: { color: '#8899aa', stepSize: 1 }, grid: { color: '#2a3a4a' } }
                }
            }
        });
    }
});
