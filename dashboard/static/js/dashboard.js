// Customer Health Overview page

document.addEventListener('DOMContentLoaded', async () => {
    const grid = document.getElementById('customer-grid');
    const summaryBar = document.getElementById('summary-bar');
    if (!grid) return;

    const resp = await fetch('/api/customers');
    const customers = await resp.json();

    // Summary
    const active = customers.filter(c => c.status === 'active').length;
    const onboarding = customers.filter(c => c.status === 'onboarding').length;
    const degraded = customers.filter(c =>
        ['degraded', 'critical'].includes(c.integration.hl7.status) ||
        ['degraded', 'critical'].includes(c.integration.dicom.status) ||
        ['degraded', 'critical'].includes(c.integration.fhir.status)
    ).length;
    const totalStudies = customers.reduce((sum, c) => sum + (c.integration.dicom.studies_today || 0), 0);

    if (summaryBar) {
        summaryBar.innerHTML = `
            <div class="summary-stat"><span class="summary-number">${customers.length}</span> Total Sites</div>
            <div class="summary-stat"><span class="summary-number" style="color:#00d4aa">${active}</span> Active</div>
            <div class="summary-stat"><span class="summary-number" style="color:#ffc107">${degraded}</span> Issues</div>
            <div class="summary-stat"><span class="summary-number" style="color:#5b8def">${onboarding}</span> Onboarding</div>
            <div class="summary-stat"><span class="summary-number">${formatNumber(totalStudies)}</span> Studies Today</div>
        `;
    }

    // Customer cards
    grid.innerHTML = customers.map(c => {
        const hl7 = c.integration.hl7;
        const dicom = c.integration.dicom;
        const fhir = c.integration.fhir;
        const overallStatus = [hl7.status, dicom.status, fhir.status].includes('critical') ? 'critical' :
            [hl7.status, dicom.status, fhir.status].includes('degraded') ? 'degraded' : 'healthy';

        return `
            <a href="/customer/${c.id}" class="card customer-card">
                <div class="card-header">
                    <div>
                        <h3 class="card-title">${c.name}</h3>
                        <span class="region-badge ${regionClass(c.region)}">${c.region}</span>
                        <span class="vendor-tag">${c.pacs_vendor}</span>
                    </div>
                    <span class="status-badge status-${overallStatus}">${statusLabel(c.status)}</span>
                </div>
                <div class="status-row">
                    <div class="status-item">
                        <span class="status-dot" style="background:${statusColor(hl7.status)}"></span>
                        <span class="status-label">HL7</span>
                        <span class="status-metric">${formatNumber(hl7.messages_today)} msgs</span>
                    </div>
                    <div class="status-item">
                        <span class="status-dot" style="background:${statusColor(dicom.status)}"></span>
                        <span class="status-label">DICOM</span>
                        <span class="status-metric">${formatNumber(dicom.studies_today)} studies</span>
                    </div>
                    <div class="status-item">
                        <span class="status-dot" style="background:${statusColor(fhir.status)}"></span>
                        <span class="status-label">FHIR</span>
                        <span class="status-metric">${formatNumber(fhir.requests_today)} req</span>
                    </div>
                </div>
                <div class="card-footer">
                    <span class="card-footer-text">Error: ${Math.max(hl7.error_rate_pct, dicom.error_rate_pct, fhir.error_rate_pct).toFixed(1)}%</span>
                    <span class="card-footer-text">Last activity: ${timeAgo(dicom.last_study || hl7.last_message)}</span>
                </div>
            </a>
        `;
    }).join('');
});
