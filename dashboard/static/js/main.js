// Shared utilities for the Integration Operations Dashboard

function statusColor(status) {
    const map = {
        'healthy': '#00d4aa',
        'degraded': '#ffc107',
        'critical': '#ff4757',
        'testing': '#5b8def',
        'pending': '#8899aa'
    };
    return map[status] || '#8899aa';
}

function statusLabel(status) {
    return status.charAt(0).toUpperCase() + status.slice(1);
}

function regionClass(region) {
    const map = { 'APAC': 'region-apac', 'EMEA': 'region-emea', 'Americas': 'region-americas' };
    return map[region] || '';
}

function severityClass(sev) {
    const map = { 'P1': 'severity-p1', 'P2': 'severity-p2', 'P3': 'severity-p3' };
    return map[sev] || '';
}

function incidentStatusClass(status) {
    const map = {
        'investigating': 'inc-investigating',
        'monitoring': 'inc-monitoring',
        'resolved': 'inc-resolved'
    };
    return map[status] || '';
}

function timeAgo(dateStr) {
    if (!dateStr) return 'N/A';
    const now = new Date();
    const then = new Date(dateStr);
    const diffMs = now - then;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHrs = Math.floor(diffMin / 60);
    if (diffHrs < 24) return `${diffHrs}h ago`;
    const diffDays = Math.floor(diffHrs / 24);
    return `${diffDays}d ago`;
}

function formatNumber(n) {
    if (n == null) return '-';
    return n.toLocaleString();
}
