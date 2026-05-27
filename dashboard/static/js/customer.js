// Customer Detail page

document.addEventListener('DOMContentLoaded', async () => {
    const container = document.getElementById('customer-detail');
    if (!container) return;
    const customerId = container.dataset.customerId;

    const resp = await fetch(`/api/customers/${customerId}`);
    const data = await resp.json();
    const c = data.customer;
    const incidents = data.incidents || [];
    const slo = data.slo || {};

    // Header
    const header = document.getElementById('customer-header');
    if (header) {
        header.innerHTML = `
            <div class="customer-header-content">
                <h2>${c.name}</h2>
                <div class="customer-meta">
                    <span class="region-badge ${regionClass(c.region)}">${c.region}</span>
                    <span class="vendor-tag">${c.pacs_vendor}</span>
                    <span class="vendor-tag">${c.ehr_vendor}</span>
                    <span class="status-badge status-${c.status === 'active' ? 'healthy' : c.status}">${statusLabel(c.status)}</span>
                    <span class="meta-text">Go-live: ${c.go_live_date}</span>
                </div>
                <div class="customer-contacts">
                    <span class="meta-text">${c.contacts.primary}</span>
                    <span class="meta-text">${c.contacts.technical}</span>
                </div>
            </div>
        `;
    }

    // Integration panels
    renderPanel('hl7-panel', 'HL7v2', c.integration.hl7, [
        ['Endpoint', c.integration.hl7.endpoint],
        ['Sending Facility', c.integration.hl7.sending_facility],
        ['Receiving Facility', c.integration.hl7.receiving_facility],
        ['Message Types', (c.integration.hl7.message_types || []).join(', ')],
        ['Messages Today', formatNumber(c.integration.hl7.messages_today)],
        ['Error Rate', c.integration.hl7.error_rate_pct + '%'],
        ['Last Message', timeAgo(c.integration.hl7.last_message)],
    ]);

    renderPanel('dicom-panel', 'DICOM', c.integration.dicom, [
        ['AE Title (Source)', c.integration.dicom.ae_title_source],
        ['AE Title (Dest)', c.integration.dicom.ae_title_dest],
        ['Port', c.integration.dicom.port],
        ['Modalities', (c.integration.dicom.modalities || []).join(', ')],
        ['Studies Today', formatNumber(c.integration.dicom.studies_today)],
        ['Error Rate', c.integration.dicom.error_rate_pct + '%'],
        ['Last Study', timeAgo(c.integration.dicom.last_study)],
    ]);

    renderPanel('fhir-panel', 'FHIR', c.integration.fhir, [
        ['Server URL', c.integration.fhir.server_url || 'Not configured'],
        ['Auth Type', c.integration.fhir.auth_type],
        ['Resources', (c.integration.fhir.resources || []).join(', ')],
        ['Requests Today', formatNumber(c.integration.fhir.requests_today)],
        ['Error Rate', c.integration.fhir.error_rate_pct + '%'],
        ['Last Request', timeAgo(c.integration.fhir.last_request)],
    ]);

    // Incidents
    const incSection = document.getElementById('incidents-section');
    if (incSection) {
        incSection.innerHTML = `
            <h3>Recent Incidents</h3>
            ${incidents.length === 0 ? '<p class="muted">No recent incidents</p>' :
            `<table class="data-table">
                <thead><tr><th>Sev</th><th>Title</th><th>Status</th><th>Opened</th></tr></thead>
                <tbody>
                    ${incidents.map(i => `
                        <tr>
                            <td><span class="severity-badge ${severityClass(i.severity)}">${i.severity}</span></td>
                            <td>${i.title}</td>
                            <td><span class="incident-status ${incidentStatusClass(i.status)}">${i.status}</span></td>
                            <td>${timeAgo(i.opened)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>`}
        `;
    }

    // SLO
    const sloSection = document.getElementById('slo-section');
    if (sloSection && slo.uptime_pct != null) {
        const uptimeColor = slo.slo_met ? '#00d4aa' : '#ff4757';
        sloSection.innerHTML = `
            <h3>SLO Summary (${slo.period})</h3>
            <div class="slo-mini-grid">
                <div class="slo-mini-card">
                    <div class="slo-mini-value" style="color:${uptimeColor}">${slo.uptime_pct}%</div>
                    <div class="slo-mini-label">Uptime (target: ${slo.slo_target_uptime}%)</div>
                </div>
                <div class="slo-mini-card">
                    <div class="slo-mini-value">${slo.avg_time_to_ack_min}m</div>
                    <div class="slo-mini-label">Avg Time to Ack</div>
                </div>
                <div class="slo-mini-card">
                    <div class="slo-mini-value">${slo.avg_time_to_resolve_hrs}h</div>
                    <div class="slo-mini-label">Avg Time to Resolve</div>
                </div>
                <div class="slo-mini-card">
                    <div class="slo-mini-value">${slo.first_contact_resolution_pct}%</div>
                    <div class="slo-mini-label">First Contact Resolution</div>
                </div>
            </div>
        `;
    } else if (sloSection) {
        sloSection.innerHTML = '<h3>SLO Summary</h3><p class="muted">Onboarding - no SLO data yet</p>';
    }
});

function renderPanel(elementId, label, data, rows) {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.innerHTML = `
        <div class="integration-panel">
            <div class="panel-header">
                <span class="status-dot-lg" style="background:${statusColor(data.status)}"></span>
                <h3>${label}</h3>
                <span class="status-text" style="color:${statusColor(data.status)}">${statusLabel(data.status)}</span>
            </div>
            <table class="field-table">
                ${rows.map(([k, v]) => `<tr><td class="field-key">${k}</td><td class="field-val">${v}</td></tr>`).join('')}
            </table>
        </div>
    `;
}
