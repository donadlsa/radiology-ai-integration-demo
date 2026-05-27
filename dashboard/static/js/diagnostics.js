// Diagnostic Tools page

let samples = {};

document.addEventListener('DOMContentLoaded', async () => {
    // Load available samples
    try {
        const resp = await fetch('/api/diagnostics/samples');
        samples = await resp.json();
        populateSampleDropdowns();
    } catch (e) {
        console.error('Failed to load samples:', e);
    }

    // Button handlers
    document.getElementById('hl7-parse-btn')?.addEventListener('click', parseHL7);
    document.getElementById('dicom-inspect-btn')?.addEventListener('click', inspectDICOM);
    document.getElementById('fhir-validate-btn')?.addEventListener('click', validateFHIR);
    document.getElementById('demo-compare-btn')?.addEventListener('click', compareDemographics);

    // Sample selection handlers
    document.getElementById('hl7-sample-select')?.addEventListener('change', loadHL7Sample);
    document.getElementById('fhir-sample-select')?.addEventListener('change', loadFHIRSample);
});

function populateSampleDropdowns() {
    // HL7 samples - API returns hl7_messages as array of {filename, content}
    const hl7Select = document.getElementById('hl7-sample-select');
    const hl7Messages = samples.hl7_messages || [];
    if (hl7Select && hl7Messages.length > 0) {
        // Convert to dict for easy lookup
        samples._hl7Map = {};
        hl7Messages.forEach(m => { samples._hl7Map[m.filename] = m.content; });
        hl7Select.innerHTML = hl7Messages.map(m =>
            `<option value="${m.filename}">${m.filename}</option>`
        ).join('');
        // Load first sample
        if (hl7Messages[0] && hl7Messages[0].content) {
            document.getElementById('hl7-input').value = hl7Messages[0].content;
        }
    }

    // DICOM files
    const dicomSelect = document.getElementById('dicom-file-select');
    if (dicomSelect && samples.dicom_files) {
        dicomSelect.innerHTML = samples.dicom_files.map(f =>
            `<option value="${f}">${f}</option>`
        ).join('');
    }

    // FHIR samples
    const fhirSelect = document.getElementById('fhir-sample-select');
    if (fhirSelect && samples.fhir_files) {
        fhirSelect.innerHTML = samples.fhir_files.map(f =>
            `<option value="${f}">${f.replace('.json', '')}</option>`
        ).join('');
        // Load first sample
        loadFHIRSampleByName(samples.fhir_files[0]);
    }

    // Pre-fill demographics
    prefillDemographics();
}

function loadHL7Sample() {
    const name = document.getElementById('hl7-sample-select').value;
    if (samples._hl7Map && samples._hl7Map[name]) {
        document.getElementById('hl7-input').value = samples._hl7Map[name];
    }
}

async function loadFHIRSample() {
    const name = document.getElementById('fhir-sample-select').value;
    await loadFHIRSampleByName(name);
}

async function loadFHIRSampleByName(filename) {
    try {
        const resp = await fetch(`/api/diagnostics/sample-fhir/${filename}`);
        if (resp.ok) {
            const data = await resp.json();
            document.getElementById('fhir-input').value = JSON.stringify(data, null, 2);
        }
    } catch (e) {
        document.getElementById('fhir-input').value = JSON.stringify({
            "resourceType": "Patient",
            "id": "example",
            "name": [{"family": "Doe", "given": ["Jane"]}],
            "gender": "female",
            "birthDate": "1958-03-12"
        }, null, 2);
    }
}

function prefillDemographics() {
    document.getElementById('demo-hl7').value = JSON.stringify({
        "mrn": "MRN-2024-78432",
        "last_name": "DOE",
        "first_name": "JANE",
        "dob": "19580312",
        "sex": "F"
    }, null, 2);

    document.getElementById('demo-dicom').value = JSON.stringify({
        "mrn": "MRN-2024-78432",
        "last_name": "DOE",
        "first_name": "JANE",
        "dob": "19580312",
        "sex": "F"
    }, null, 2);
}

// ---- HL7 Parser ----
async function parseHL7() {
    const input = document.getElementById('hl7-input').value;
    const results = document.getElementById('hl7-results');
    results.innerHTML = '<p class="loading">Parsing...</p>';

    try {
        const resp = await fetch('/api/diagnostics/parse-hl7', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ raw_message: input })
        });
        const data = await resp.json();

        if (!data.success) {
            results.innerHTML = `<div class="error-result">Error: ${data.error}</div>`;
            return;
        }

        results.innerHTML = `
            <div class="result-section">
                <span class="result-badge">${data.message_type} ^ ${data.trigger_event}</span>
            </div>
            <div class="result-section">
                <h4>Patient Demographics</h4>
                <table class="field-table">
                    ${Object.entries(data.demographics || data.patient).map(([k, v]) =>
                        `<tr><td class="field-key">${k}</td><td class="field-val">${typeof v === 'object' ? JSON.stringify(v) : v}</td></tr>`
                    ).join('')}
                </table>
            </div>
            ${data.orders || data.order.procedure_code ? `
            <div class="result-section">
                <h4>Order Details</h4>
                <table class="field-table">
                    ${Object.entries(data.orders || data.order).map(([k, v]) =>
                        `<tr><td class="field-key">${k}</td><td class="field-val">${v}</td></tr>`
                    ).join('')}
                </table>
            </div>` : ''}
            ${data.ai_findings && data.ai_findings.length > 0 ? `
            <div class="result-section">
                <h4>AI Findings (${data.ai_findings.length})</h4>
                ${data.ai_findings.map(f => `
                    <div class="finding-card">
                        <span class="finding-code">${f.code}</span>
                        <span class="finding-desc">${f.description}</span>
                        ${f.confidence != null ? `<span class="finding-conf">${(f.confidence * 100).toFixed(0)}%</span>` : ''}
                    </div>
                `).join('')}
            </div>` : ''}
            ${data.observations && data.observations.length > 0 ? `
            <div class="result-section">
                <h4>OBX Segments (${data.observations.length})</h4>
                <table class="field-table">
                    <thead><tr><th>#</th><th>Type</th><th>ID</th><th>Value</th></tr></thead>
                    ${data.observations.map(o => `
                        <tr>
                            <td>${o.set_id}</td>
                            <td><span class="type-badge">${o.value_type}</span></td>
                            <td>${o.observation_id_text || o.observation_id}</td>
                            <td class="obs-value">${o.value ? (o.value.length > 80 ? o.value.substring(0, 80) + '...' : o.value) : ''}</td>
                        </tr>
                    `).join('')}
                </table>
            </div>` : ''}
        `;
    } catch (e) {
        results.innerHTML = `<div class="error-result">Request failed: ${e.message}</div>`;
    }
}

// ---- DICOM Inspector ----
async function inspectDICOM() {
    const filename = document.getElementById('dicom-file-select').value;
    const tagGroup = document.getElementById('dicom-group-select').value;
    const results = document.getElementById('dicom-results');
    results.innerHTML = '<p class="loading">Inspecting...</p>';

    try {
        const resp = await fetch('/api/diagnostics/inspect-dicom', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename, tag_group: tagGroup })
        });
        const data = await resp.json();

        if (!data.success) {
            results.innerHTML = `<div class="error-result">Error: ${data.error}</div>`;
            return;
        }

        const valIssues = data.validation_issues || data.validation || [];
        const validationHtml = valIssues.length === 0
            ? '<span class="match-pass">All required tags present</span>'
            : valIssues.map(i => `<div class="match-fail">${i}</div>`).join('');

        results.innerHTML = `
            <div class="result-section">
                <h4>File: ${filename}</h4>
                <h4>Validation</h4>
                ${validationHtml}
            </div>
            ${data.study_metadata ? `
            <div class="result-section">
                <h4>Study Info</h4>
                <table class="field-table">
                    <tr><td class="field-key">Modality</td><td class="field-val">${data.study_metadata.modality}</td></tr>
                    <tr><td class="field-key">Description</td><td class="field-val">${data.study_metadata.study_description}</td></tr>
                    <tr><td class="field-key">Accession</td><td class="field-val">${data.study_metadata.accession_number}</td></tr>
                    <tr><td class="field-key">Study UID</td><td class="field-val" style="font-size:0.75rem">${data.study_metadata.study_instance_uid}</td></tr>
                </table>
            </div>` : ''}
            <div class="result-section">
                <h4>Tags (${Object.keys(data.tags).length})</h4>
                <table class="field-table">
                    ${Object.entries(data.tags).map(([k, v]) =>
                        `<tr><td class="field-key">${k}</td><td class="field-val">${v}</td></tr>`
                    ).join('')}
                </table>
            </div>
        `;
    } catch (e) {
        results.innerHTML = `<div class="error-result">Request failed: ${e.message}</div>`;
    }
}

// ---- FHIR Validator ----
async function validateFHIR() {
    const input = document.getElementById('fhir-input').value;
    const results = document.getElementById('fhir-results');
    results.innerHTML = '<p class="loading">Validating...</p>';

    try {
        const resp = await fetch('/api/diagnostics/validate-fhir', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ resource_json: input })
        });
        const data = await resp.json();

        if (data.success) {
            results.innerHTML = `
                <div class="result-section">
                    <span class="match-pass" style="font-size:1.1rem">Valid ${data.resource_type} Resource</span>
                </div>
                <div class="result-section">
                    <h4>Resource Summary</h4>
                    <table class="field-table">
                        ${Object.entries(data.summary || {}).map(([k, v]) =>
                            `<tr><td class="field-key">${k}</td><td class="field-val">${v}</td></tr>`
                        ).join('')}
                    </table>
                </div>
            `;
        } else {
            results.innerHTML = `
                <div class="result-section">
                    <span class="match-fail" style="font-size:1.1rem">Validation Failed</span>
                    <div class="error-detail">${data.error}</div>
                </div>
            `;
        }
    } catch (e) {
        results.innerHTML = `<div class="error-result">Request failed: ${e.message}</div>`;
    }
}

// ---- Demographics Comparator ----
async function compareDemographics() {
    const hl7Text = document.getElementById('demo-hl7').value;
    const dicomText = document.getElementById('demo-dicom').value;
    const results = document.getElementById('demo-results');
    results.innerHTML = '<p class="loading">Comparing...</p>';

    try {
        const hl7Data = JSON.parse(hl7Text);
        const dicomData = JSON.parse(dicomText);

        const resp = await fetch('/api/diagnostics/compare-demographics', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hl7: hl7Data, dicom: dicomData })
        });
        const data = await resp.json();

        if (!data.success) {
            results.innerHTML = `<div class="error-result">Error: ${data.error}</div>`;
            return;
        }

        const overallMatch = data.all_match || data.overall_match || false;
        const fields = data.fields || data.result || {};
        const overallClass = overallMatch ? 'match-pass' : 'match-fail';
        const overallText = overallMatch ? 'MATCH' : 'MISMATCH';

        results.innerHTML = `
            <div class="result-section">
                <span class="${overallClass}" style="font-size:1.2rem;font-weight:bold">${overallText}</span>
            </div>
            <table class="field-table">
                <thead><tr><th>Field</th><th>HL7</th><th>DICOM</th><th>Match</th></tr></thead>
                <tbody>
                    ${Object.entries(fields).map(([field, info]) => `
                        <tr>
                            <td class="field-key">${field}</td>
                            <td>${info.hl7}</td>
                            <td>${info.dicom}</td>
                            <td><span class="${info.match ? 'match-pass' : 'match-fail'}">${info.match ? 'PASS' : 'FAIL'}</span></td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    } catch (e) {
        results.innerHTML = `<div class="error-result">Invalid JSON: ${e.message}</div>`;
    }
}
