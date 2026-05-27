// Integration Flow Tracer — orchestrates the full pipeline trace

let samplesData = {};
let traceResults = {};

// Error scenario definitions — each injects a failure at a specific stage
// and links to the relevant troubleshooting runbook
const ERROR_SCENARIOS = {
    'ACC-20260115-5678': {
        name: 'All Healthy',
        errors: {}
    },
    'ACC-20260220-1234': {
        name: 'AE Title Mismatch',
        errors: {
            stage2: {
                type: 'ae_title_mismatch',
                message: 'DICOM routing failure: Source AE title "UNKNOWN_PACS" does not match any configured route. Study was rejected by the AI engine DICOM listener.',
                detail: 'Expected AE title: "CHA_SYNAPSE" | Received: "UNKNOWN_PACS" — The customer likely changed their PACS AE title during a system upgrade without notifying our integration team.',
                runbook_id: 0,
                runbook_name: 'Study Not Reaching AI Engine'
            }
        }
    },
    'ACC-20260305-9012': {
        name: 'Patient Mismatch',
        errors: {
            stage2_demographics: {
                type: 'demographics_mismatch',
                message: 'Patient demographics mismatch between HL7 order and DICOM image. Auto-matching failed.',
                detail: 'HL7 MRN: "MRN-2024-78432" | DICOM Patient ID: "78432" — The RIS sends the full MRN with prefix, but the modality only sends the numeric portion. This is a common integration issue when a new modality is added to the fleet.',
                override_dicom_demo: { mrn: '78432', last_name: 'DOE', first_name: 'JANE', dob: '19580312', sex: 'F' },
                runbook_id: 2,
                runbook_name: 'Order/Image Mismatch'
            }
        }
    },
    'ACC-20260412-3456': {
        name: 'SR Not Linked',
        errors: {
            stage4b: {
                type: 'sr_not_linked',
                message: 'DICOM Structured Report generated but Study Instance UID does not match the original study. SR will not appear alongside source images in PACS.',
                detail: 'Original Study UID: "1.2.826.0.1.3680043.8.498.937..." | SR Study UID: "1.2.826.0.1.3680043.9.999.123..." — The SR builder generated a new Study UID instead of inheriting from the source study. The radiologist will not see the AI findings in their reading worklist.',
                runbook_id: 1,
                runbook_name: 'AI Results Not Appearing in PACS'
            }
        }
    },
    'ACC-20260501-7890': {
        name: 'Critical Result Undelivered',
        errors: {
            stage4a: {
                type: 'critical_not_detected',
                message: 'AI detected pneumothorax (critical finding) but the critical result alerting pathway was not triggered. The ORU^R01 was sent to standard destinations only.',
                detail: 'SNOMED code 36118008 (Pneumothorax) was present in OBX-5 but the critical result routing rule only checks for the text "CRITICAL" in the observation value, not SNOMED codes. The coded finding bypassed the text-based filter.',
                runbook_id: 4,
                runbook_name: 'Critical Result Not Delivered'
            }
        }
    },
    'ACC-20260515-2345': {
        name: 'FHIR Validation Error',
        errors: {
            stage4c: {
                type: 'fhir_validation',
                message: 'FHIR DiagnosticReport submission rejected by customer FHIR server. Validation error: effectiveDateTime format does not conform to FHIR R4 dateTime specification.',
                detail: 'The DiagnosticReport.effectiveDateTime was sent as "2026-05-15 14:30:00" (space-separated) instead of "2026-05-15T14:30:00+00:00" (ISO 8601 with T separator and timezone). The customer\'s FHIR server enforces strict R4 validation.',
                runbook_id: 5,
                runbook_name: 'FHIR API Failures'
            }
        }
    }
};

function getScenario() {
    const accession = document.getElementById('accession-input').value;
    return ERROR_SCENARIOS[accession] || ERROR_SCENARIOS['ACC-20260115-5678'];
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('trace-btn').addEventListener('click', () => runTrace());
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function setStageStatus(stageId, status, statusText) {
    const el = document.getElementById(stageId);
    if (!el) return;
    el.className = 'pipeline-stage stage-' + status;
    const textEl = el.querySelector('.status-text');
    if (textEl) textEl.textContent = statusText || status.toUpperCase();
}

function setStageSummary(stageId, html) {
    const el = document.getElementById(stageId + '-summary');
    if (el) el.innerHTML = html;
}

function setArrowActive(arrowId) {
    const el = document.getElementById(arrowId);
    if (el) el.classList.add('active');
}

function resetPipeline() {
    // Re-enable button in case a previous run left it disabled
    const btn = document.getElementById('trace-btn');
    if (btn) btn.disabled = false;

    ['stage-1', 'stage-2', 'stage-3', 'stage-4a', 'stage-4b', 'stage-4c'].forEach(id => {
        setStageStatus(id, 'pending', 'Pending');
        setStageSummary(id, '');
    });
    ['arrow-1-2', 'arrow-2-3', 'arrow-3-branch'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.remove('active');
    });
    document.getElementById('trace-details').innerHTML = '';
    const summary = document.getElementById('flow-summary');
    summary.className = 'flow-summary';
    summary.innerHTML = '';
}

function escapeHtml(str) {
    if (str == null) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fieldRow(key, value) {
    return `<div class="field-row"><span class="field-key">${escapeHtml(key)}</span><span class="field-val">${escapeHtml(value)}</span></div>`;
}

function makeCollapsibleCode(label, content) {
    const codeId = 'code-' + Math.random().toString(36).substring(2, 9);
    return `
        <span class="code-toggle" onclick="toggleCode('${codeId}')">Show ${escapeHtml(label)}</span>
        <div class="code-block" id="${codeId}" style="display:none">${escapeHtml(content)}</div>
    `;
}

// Global toggle function
window.toggleCode = function(id) {
    const el = document.getElementById(id);
    if (!el) return;
    const toggle = el.previousElementSibling;
    if (el.style.display === 'none') {
        el.style.display = 'block';
        if (toggle) toggle.textContent = toggle.textContent.replace('Show', 'Hide');
    } else {
        el.style.display = 'none';
        if (toggle) toggle.textContent = toggle.textContent.replace('Hide', 'Show');
    }
};

function addTraceSection(stageLabel, status, subtitle, bodyHtml) {
    const container = document.getElementById('trace-details');
    const sectionId = 'section-' + Math.random().toString(36).substring(2, 9);
    const statusClass = status === 'pass' ? 'pass' : status === 'fail' ? 'fail' : status === 'warn' ? 'warn' : '';
    const badgeClass = status === 'pass' ? 'green' : status === 'fail' ? 'red' : status === 'warn' ? 'yellow' : '';
    const badgeText = status.toUpperCase();

    container.insertAdjacentHTML('beforeend', `
        <div class="trace-section ${statusClass}">
            <div class="trace-section-header" onclick="toggleSection('${sectionId}')">
                <div class="section-left">
                    <span class="status-badge ${badgeClass}">${badgeText}</span>
                    <span class="section-title">${escapeHtml(stageLabel)}</span>
                    <span class="section-subtitle">${escapeHtml(subtitle)}</span>
                </div>
                <span class="expand-icon open" id="icon-${sectionId}">&#9654;</span>
            </div>
            <div class="trace-section-body open" id="${sectionId}">
                ${bodyHtml}
            </div>
        </div>
    `);
}

window.toggleSection = function(id) {
    const body = document.getElementById(id);
    const icon = document.getElementById('icon-' + id);
    if (!body) return;
    body.classList.toggle('open');
    if (icon) icon.classList.toggle('open');
};

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function fetchSamples() {
    const resp = await fetch('/api/diagnostics/samples');
    return resp.json();
}

async function parseHL7(rawMessage) {
    const resp = await fetch('/api/diagnostics/parse-hl7', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw_message: rawMessage })
    });
    return resp.json();
}

async function inspectDICOM(filename, tagGroup) {
    const resp = await fetch('/api/diagnostics/inspect-dicom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: filename, tag_group: tagGroup || 'all' })
    });
    return resp.json();
}

async function validateFHIR(resourceJson) {
    const resp = await fetch('/api/diagnostics/validate-fhir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resource_json: resourceJson })
    });
    return resp.json();
}

async function fetchFHIRSample(filename) {
    const resp = await fetch('/api/diagnostics/sample-fhir/' + filename);
    return resp.json();
}

async function compareDemographics(hl7Demo, dicomDemo) {
    const resp = await fetch('/api/diagnostics/compare-demographics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hl7: hl7Demo, dicom: dicomDemo })
    });
    return resp.json();
}

// ---------------------------------------------------------------------------
// Main Trace Orchestrator
// ---------------------------------------------------------------------------

function makeRunbookLink(scenario_error) {
    if (!scenario_error || scenario_error.runbook_name == null) return '';
    return `<a class="runbook-link" href="/runbooks" onclick="sessionStorage.setItem('openRunbook','${scenario_error.runbook_id}')">Open Runbook: ${escapeHtml(scenario_error.runbook_name)}</a>`;
}

async function runTrace() {
    resetPipeline();
    const accession = document.getElementById('accession-input').value.trim();
    const scenario = getScenario();
    const stageOutcomes = [];

    // Disable button during trace
    document.getElementById('trace-btn').disabled = true;

    try {
        // Load samples
        samplesData = await fetchSamples();
        const hl7Map = {};
        (samplesData.hl7_messages || []).forEach(m => { hl7Map[m.filename] = m.content; });

        // =====================================================================
        // Stage 1: Order Received (ORM^O01)
        // =====================================================================
        setStageStatus('stage-1', 'running', 'Parsing...');
        await delay(300);

        let stage1Status = 'fail';
        let stage1Data = null;
        let hl7Demographics = null;
        let ormContent = '';

        try {
            // Find ORM message
            ormContent = hl7Map['orm_o01_order.hl7'] || '';
            if (!ormContent) {
                // Fallback: look for any ORM message
                for (const [name, content] of Object.entries(hl7Map)) {
                    if (name.toLowerCase().includes('orm')) {
                        ormContent = content;
                        break;
                    }
                }
            }

            if (ormContent) {
                stage1Data = await parseHL7(ormContent);
            }

            if (stage1Data && stage1Data.success) {
                hl7Demographics = stage1Data.demographics || stage1Data.patient || {};
                const orderInfo = stage1Data.orders || stage1Data.order || {};
                const parsedAccession = orderInfo.accession_number || orderInfo.accession || '';
                const accessionMatch = !accession || parsedAccession.includes(accession) || accession.includes(parsedAccession) || parsedAccession === accession;

                stage1Status = accessionMatch ? 'pass' : 'fail';
                setStageSummary('stage-1', `${stage1Data.message_type || 'ORM'}^${stage1Data.trigger_event || 'O01'} parsed`);

                // Build detail body
                let body = '<h4>Message Type</h4>';
                body += `<div><span class="status-badge green">${escapeHtml(stage1Data.message_type || 'ORM')} ^ ${escapeHtml(stage1Data.trigger_event || 'O01')}</span></div>`;

                body += '<h4>Patient Demographics</h4>';
                for (const [k, v] of Object.entries(hl7Demographics)) {
                    body += fieldRow(k, typeof v === 'object' ? JSON.stringify(v) : v);
                }

                if (orderInfo && Object.keys(orderInfo).length > 0) {
                    body += '<h4>Order Details</h4>';
                    for (const [k, v] of Object.entries(orderInfo)) {
                        body += fieldRow(k, v);
                    }
                }

                if (!accessionMatch) {
                    body += `<h4>Accession Check</h4>`;
                    body += `<div class="field-row"><span class="field-key">Expected</span><span class="field-val match-fail">${escapeHtml(accession)}</span></div>`;
                    body += `<div class="field-row"><span class="field-key">Found</span><span class="field-val match-fail">${escapeHtml(parsedAccession)}</span></div>`;
                }

                body += makeCollapsibleCode('Raw HL7 Message', ormContent);
                addTraceSection('Stage 1: Order Received', stage1Status, `${stage1Data.message_type || 'ORM'}^${stage1Data.trigger_event || 'O01'}`, body);
            } else {
                setStageSummary('stage-1', 'Parse failed');
                addTraceSection('Stage 1: Order Received', 'fail', 'Parse error', `<p class="match-fail">${escapeHtml(stage1Data ? stage1Data.error : 'ORM sample not found')}</p>`);
            }
        } catch (e) {
            setStageSummary('stage-1', 'Error');
            addTraceSection('Stage 1: Order Received', 'fail', 'Error', `<p class="match-fail">${escapeHtml(e.message)}</p>`);
        }

        setStageStatus('stage-1', stage1Status, stage1Status === 'pass' ? 'Pass' : 'Fail');
        stageOutcomes.push({ name: 'Order Received', status: stage1Status });
        setArrowActive('arrow-1-2');
        await delay(300);

        // =====================================================================
        // Stage 2: Image Arrives (DICOM)
        // =====================================================================
        setStageStatus('stage-2', 'running', 'Inspecting...');
        await delay(300);

        let stage2Status = 'fail';
        let dicomData = null;
        let dicomDemographics = null;

        try {
            dicomData = await inspectDICOM('chest_xray.dcm', 'all');

            // Error injection: AE Title Mismatch
            if (scenario.errors.stage2) {
                const err = scenario.errors.stage2;
                stage2Status = 'fail';
                setStageSummary('stage-2', 'Routing Error');
                let body = `<h4>Error Detected</h4>`;
                body += `<div class="match-fail" style="padding:12px;margin:8px 0;border-radius:6px;background:rgba(255,71,87,0.1)">${escapeHtml(err.message)}</div>`;
                body += `<p style="color:var(--text-secondary);margin:8px 0">${escapeHtml(err.detail)}</p>`;
                body += makeRunbookLink(err);
                addTraceSection('Stage 2: Image Arrives', 'fail', 'DICOM Routing Error', body);
                setStageStatus('stage-2', 'fail', 'Fail');
                stageOutcomes.push({ name: 'Image Arrives', status: 'fail' });
                setArrowActive('arrow-2-3');
                await delay(300);
                // Skip remaining stages
                ['stage-3','stage-4a','stage-4b','stage-4c'].forEach(s => setStageStatus(s, 'pending', 'Skipped'));
                stageOutcomes.push({ name: 'AI Analysis', status: 'fail' });
                stageOutcomes.push({ name: 'HL7 Result', status: 'fail' });
                stageOutcomes.push({ name: 'DICOM SR', status: 'fail' });
                stageOutcomes.push({ name: 'FHIR Bundle', status: 'fail' });
                renderSummary(stageOutcomes, scenario);
                document.getElementById('trace-btn').disabled = false;
                return;
            }

            if (dicomData && dicomData.success) {
                const studyMeta = dicomData.study_metadata || {};
                const tags = dicomData.tags || {};
                const modality = studyMeta.modality || tags['Modality'] || 'Unknown';
                const studyDesc = studyMeta.study_description || tags['StudyDescription'] || '';

                setStageSummary('stage-2', `${modality} study loaded`);

                // Extract DICOM demographics for comparison
                dicomDemographics = {
                    mrn: tags['PatientID'] || '',
                    last_name: (tags['PatientName'] || '').split('^')[0] || '',
                    first_name: (tags['PatientName'] || '').split('^')[1] || '',
                    dob: tags['PatientBirthDate'] || '',
                    sex: tags['PatientSex'] || ''
                };

                let body = '<h4>Study Information</h4>';
                body += fieldRow('Modality', modality);
                body += fieldRow('Study Description', studyDesc);
                body += fieldRow('Accession Number', studyMeta.accession_number || tags['AccessionNumber'] || '');
                body += fieldRow('Study Instance UID', studyMeta.study_instance_uid || tags['StudyInstanceUID'] || '');

                body += '<h4>Patient Information</h4>';
                body += fieldRow('Patient Name', tags['PatientName'] || '');
                body += fieldRow('Patient ID', tags['PatientID'] || '');
                body += fieldRow('Birth Date', tags['PatientBirthDate'] || '');
                body += fieldRow('Sex', tags['PatientSex'] || '');

                if (tags['SourceApplicationEntityTitle'] || tags['CallingAETitle']) {
                    body += '<h4>Routing</h4>';
                    body += fieldRow('Source AE Title', tags['SourceApplicationEntityTitle'] || tags['CallingAETitle'] || '');
                    body += fieldRow('Destination AE Title', tags['CalledAETitle'] || 'AI_ENGINE');
                }

                // Demographics cross-check
                // Error injection: Patient Mismatch
                if (scenario.errors.stage2_demographics) {
                    dicomDemographics = scenario.errors.stage2_demographics.override_dicom_demo;
                }

                if (hl7Demographics) {
                    body += '<h4>Demographics Cross-Check (HL7 vs DICOM)</h4>';
                    try {
                        const compareResult = await compareDemographics(hl7Demographics, dicomDemographics);
                        if (compareResult && compareResult.success !== false) {
                            const allMatch = compareResult.all_match || compareResult.overall_match || false;
                            const fields = compareResult.fields || compareResult.result || {};

                            body += `<table class="field-table"><thead><tr><th>Field</th><th>HL7</th><th>DICOM</th><th>Match</th></tr></thead><tbody>`;
                            for (const [field, info] of Object.entries(fields)) {
                                const matchClass = info.match ? 'match-pass' : 'match-fail';
                                body += `<tr><td>${escapeHtml(field)}</td><td>${escapeHtml(info.hl7)}</td><td>${escapeHtml(info.dicom)}</td><td><span class="${matchClass}">${info.match ? 'PASS' : 'FAIL'}</span></td></tr>`;
                            }
                            body += '</tbody></table>';

                            if (allMatch) {
                                stage2Status = 'pass';
                            } else {
                                stage2Status = scenario.errors.stage2_demographics ? 'fail' : 'warn';
                                if (scenario.errors.stage2_demographics) {
                                    const err = scenario.errors.stage2_demographics;
                                    body += `<div class="match-fail" style="padding:12px;margin:8px 0;border-radius:6px;background:rgba(255,71,87,0.1)">${escapeHtml(err.message)}</div>`;
                                    body += `<p style="color:var(--text-secondary);margin:8px 0">${escapeHtml(err.detail)}</p>`;
                                    body += makeRunbookLink(err);
                                }
                            }
                        } else {
                            stage2Status = 'pass';
                            body += `<p class="text-muted">Demographics comparison not available</p>`;
                        }
                    } catch (e) {
                        stage2Status = 'pass';
                        body += `<p class="text-muted">Demographics comparison unavailable: ${escapeHtml(e.message)}</p>`;
                    }
                } else {
                    stage2Status = 'pass';
                }

                addTraceSection('Stage 2: Image Arrives', stage2Status, `${modality} — ${studyDesc}`, body);
            } else {
                setStageSummary('stage-2', 'Not found');
                addTraceSection('Stage 2: Image Arrives', 'fail', 'Error', `<p class="match-fail">${escapeHtml(dicomData ? dicomData.error : 'DICOM file not found')}</p>`);
            }
        } catch (e) {
            setStageSummary('stage-2', 'Error');
            addTraceSection('Stage 2: Image Arrives', 'fail', 'Error', `<p class="match-fail">${escapeHtml(e.message)}</p>`);
        }

        setStageStatus('stage-2', stage2Status, stage2Status === 'pass' ? 'Pass' : stage2Status === 'warn' ? 'Warn' : 'Fail');
        stageOutcomes.push({ name: 'Image Arrives', status: stage2Status });
        setArrowActive('arrow-2-3');
        await delay(300);

        // =====================================================================
        // Stage 3: AI Analysis (Simulated)
        // =====================================================================
        setStageStatus('stage-3', 'running', 'Analyzing...');
        await delay(600); // Slightly longer delay for dramatic effect

        let stage3Status = 'pass';
        let oruContent = '';
        let oruData = null;
        let aiFindings = [];

        try {
            // Parse ORU to extract AI findings
            oruContent = hl7Map['oru_r01_ai_result.hl7'] || '';
            if (!oruContent) {
                for (const [name, content] of Object.entries(hl7Map)) {
                    if (name.toLowerCase().includes('oru')) {
                        oruContent = content;
                        break;
                    }
                }
            }

            if (oruContent) {
                oruData = await parseHL7(oruContent);
                aiFindings = (oruData && oruData.ai_findings) || [];
            }

            setStageSummary('stage-3', `${aiFindings.length} finding${aiFindings.length !== 1 ? 's' : ''} detected`);

            let body = '<h4>AI Engine</h4>';
            body += fieldRow('Engine', 'Radiology AI Engine v3.2');
            body += fieldRow('Processing Time', '2.3 seconds');
            body += fieldRow('Status', 'Analysis complete');

            body += '<h4>Findings Detected</h4>';
            if (aiFindings.length > 0) {
                body += '<div style="margin: 8px 0;">';
                aiFindings.forEach(f => {
                    const conf = f.confidence != null ? (f.confidence * 100).toFixed(0) + '%' : '';
                    body += `<div class="finding-pill"><span class="finding-name">${escapeHtml(f.description || f.code)}</span><span class="finding-conf">${escapeHtml(conf)}</span></div>`;
                });
                body += '</div>';
            } else {
                body += '<p class="text-muted">No findings extracted (ORU sample may not be available)</p>';
            }

            addTraceSection('Stage 3: AI Analysis', stage3Status, `${aiFindings.length} findings — 2.3s`, body);
        } catch (e) {
            setStageSummary('stage-3', 'Simulated');
            addTraceSection('Stage 3: AI Analysis', 'pass', 'Simulated', `<p>AI analysis simulated. ${escapeHtml(e.message)}</p>`);
        }

        setStageStatus('stage-3', stage3Status, 'Pass');
        stageOutcomes.push({ name: 'AI Analysis', status: stage3Status });
        setArrowActive('arrow-3-branch');
        await delay(300);

        // =====================================================================
        // Stage 4a: HL7v2 Result (ORU^R01)
        // =====================================================================
        setStageStatus('stage-4a', 'running', 'Parsing...');
        await delay(300);

        let stage4aStatus = 'fail';

        try {
            // Error injection: Critical Result Not Delivered
            if (scenario.errors.stage4a) {
                const err = scenario.errors.stage4a;
                stage4aStatus = 'fail';
                setStageSummary('stage-4a', 'Alert Failure');
                let body = `<h4>ORU^R01 Generated Successfully</h4>`;
                body += fieldRow('AI Findings', '2 findings (including critical)');
                body += fieldRow('Routing', 'Sent to EHR, RIS only');
                body += `<h4>Error Detected</h4>`;
                body += `<div class="match-fail" style="padding:12px;margin:8px 0;border-radius:6px;background:rgba(255,71,87,0.1)">${escapeHtml(err.message)}</div>`;
                body += `<p style="color:var(--text-secondary);margin:8px 0">${escapeHtml(err.detail)}</p>`;
                body += makeRunbookLink(err);
                addTraceSection('Stage 4a: HL7 Result (ORU^R01)', 'fail', 'Critical Alert Not Sent', body);
                setStageStatus('stage-4a', 'fail', 'Fail');
                stageOutcomes.push({ name: 'HL7 Result', status: 'fail' });
                // Continue to other output stages
                await delay(300);
            } else if (oruData && oruData.success) {
                const findings = oruData.ai_findings || [];
                const observations = oruData.observations || [];
                stage4aStatus = findings.length > 0 ? 'pass' : 'pass'; // Pass if parse succeeds

                setStageSummary('stage-4a', `${findings.length} findings, ${observations.length} OBX`);

                let body = '<h4>Message Type</h4>';
                body += `<div><span class="status-badge green">${escapeHtml(oruData.message_type || 'ORU')} ^ ${escapeHtml(oruData.trigger_event || 'R01')}</span></div>`;

                if (observations.length > 0) {
                    body += `<h4>OBX Segments (${observations.length})</h4>`;
                    body += `<table class="field-table"><thead><tr><th>#</th><th>Type</th><th>ID</th><th>Value</th></tr></thead><tbody>`;
                    observations.forEach(o => {
                        const val = o.value ? (o.value.length > 100 ? o.value.substring(0, 100) + '...' : o.value) : '';
                        body += `<tr><td>${escapeHtml(o.set_id)}</td><td>${escapeHtml(o.value_type)}</td><td>${escapeHtml(o.observation_id_text || o.observation_id)}</td><td style="font-size:0.74rem">${escapeHtml(val)}</td></tr>`;
                    });
                    body += '</tbody></table>';
                }

                if (findings.length > 0) {
                    body += '<h4>AI Findings</h4>';
                    body += '<div style="margin: 8px 0;">';
                    findings.forEach(f => {
                        const conf = f.confidence != null ? (f.confidence * 100).toFixed(0) + '%' : '';
                        body += `<div class="finding-pill"><span class="finding-name">${escapeHtml(f.description || f.code)}</span><span class="finding-conf">${escapeHtml(conf)}</span></div>`;
                    });
                    body += '</div>';
                    stage4aStatus = 'pass';
                }

                body += makeCollapsibleCode('Raw HL7 Message', oruContent);
                addTraceSection('Stage 4a: HL7 Result (ORU^R01)', stage4aStatus, `${oruData.message_type || 'ORU'}^${oruData.trigger_event || 'R01'}`, body);
            } else {
                setStageSummary('stage-4a', 'Parse failed');
                addTraceSection('Stage 4a: HL7 Result (ORU^R01)', 'fail', 'Parse error', `<p class="match-fail">${escapeHtml(oruData ? oruData.error : 'ORU sample not found')}</p>`);
            }
        } catch (e) {
            setStageSummary('stage-4a', 'Error');
            addTraceSection('Stage 4a: HL7 Result (ORU^R01)', 'fail', 'Error', `<p class="match-fail">${escapeHtml(e.message)}</p>`);
        }

        if (!scenario.errors.stage4a) {
            setStageStatus('stage-4a', stage4aStatus, stage4aStatus === 'pass' ? 'Pass' : 'Fail');
            stageOutcomes.push({ name: 'HL7 Result', status: stage4aStatus });
        }
        await delay(300);

        // =====================================================================
        // Stage 4b: DICOM Structured Report
        // =====================================================================
        setStageStatus('stage-4b', 'running', 'Inspecting...');
        await delay(300);

        let stage4bStatus = 'fail';

        if (scenario.errors.stage4b) {
            const err = scenario.errors.stage4b;
            setStageSummary('stage-4b', 'UID Mismatch');
            let body = `<h4>Structured Report Generated</h4>`;
            body += fieldRow('Modality', 'SR');
            body += fieldRow('SOP Class', 'Comprehensive SR');
            body += `<h4>Error Detected</h4>`;
            body += `<div class="match-fail" style="padding:12px;margin:8px 0;border-radius:6px;background:rgba(255,71,87,0.1)">${escapeHtml(err.message)}</div>`;
            body += `<p style="color:var(--text-secondary);margin:8px 0">${escapeHtml(err.detail)}</p>`;
            body += makeRunbookLink(err);
            addTraceSection('Stage 4b: DICOM Structured Report', 'fail', 'Study UID Mismatch', body);
            setStageStatus('stage-4b', 'fail', 'Fail');
            stageOutcomes.push({ name: 'DICOM SR', status: 'fail' });
        } else {
            try {
                const srData = await inspectDICOM('ai_structured_report.dcm', 'all');
                if (srData && srData.success) {
                    const tags = srData.tags || {};
                    const studyMeta = srData.study_metadata || {};
                    const sopClass = tags['SOPClassUID'] || tags['SOP Class UID'] || '';
                    const modality = studyMeta.modality || tags['Modality'] || '';
                    setStageSummary('stage-4b', `${modality} — SR loaded`);
                    let body = '<h4>Structured Report Info</h4>';
                    body += fieldRow('SOP Class UID', sopClass);
                    body += fieldRow('Modality', modality);
                    body += '<h4>Study UID Linkage</h4>';
                    const srStudyUID = studyMeta.study_instance_uid || tags['StudyInstanceUID'] || '';
                    body += fieldRow('Study Instance UID', srStudyUID);
                    if (dicomData && dicomData.study_metadata) {
                        const origUID = dicomData.study_metadata.study_instance_uid || '';
                        const linked = srStudyUID && origUID && srStudyUID === origUID;
                        body += fieldRow('Original Study UID', origUID);
                        body += `<div class="field-row"><span class="field-key">UIDs Linked</span><span class="field-val ${linked ? 'match-pass' : 'match-fail'}">${linked ? 'YES' : 'NO'}</span></div>`;
                    }
                    stage4bStatus = 'pass';
                    addTraceSection('Stage 4b: DICOM Structured Report', 'pass', `${modality} Structured Report`, body);
                } else {
                    addTraceSection('Stage 4b: DICOM Structured Report', 'fail', 'Error', `<p class="match-fail">SR file not found</p>`);
                }
            } catch (e) {
                addTraceSection('Stage 4b: DICOM Structured Report', 'fail', 'Error', `<p class="match-fail">${escapeHtml(e.message)}</p>`);
            }
            setStageStatus('stage-4b', stage4bStatus, stage4bStatus === 'pass' ? 'Pass' : 'Fail');
            stageOutcomes.push({ name: 'DICOM SR', status: stage4bStatus });
        }
        await delay(300);

        // =====================================================================
        // Stage 4c: FHIR Bundle
        // =====================================================================
        setStageStatus('stage-4c', 'running', 'Validating...');
        await delay(300);

        let stage4cStatus = 'fail';
        const fhirResources = [];

        if (scenario.errors.stage4c) {
            const err = scenario.errors.stage4c;
            setStageSummary('stage-4c', 'Validation Failed');
            let body = `<h4>FHIR Submission Attempted</h4>`;
            body += fieldRow('Resources', 'DiagnosticReport, Patient, Observation');
            body += fieldRow('Target', 'Customer FHIR Server (R4)');
            body += `<h4>Error Detected</h4>`;
            body += `<div class="match-fail" style="padding:12px;margin:8px 0;border-radius:6px;background:rgba(255,71,87,0.1)">${escapeHtml(err.message)}</div>`;
            body += `<p style="color:var(--text-secondary);margin:8px 0">${escapeHtml(err.detail)}</p>`;
            body += makeRunbookLink(err);
            addTraceSection('Stage 4c: FHIR Bundle', 'fail', 'Validation Error', body);
            setStageStatus('stage-4c', 'fail', 'Fail');
            stageOutcomes.push({ name: 'FHIR Bundle', status: 'fail' });
        } else {
            try {
                const fhirFilesToValidate = ['diagnostic_report.json', 'patient.json', 'observation_ai_pneumonia.json'];
                let allValid = true;
                let body = '<h4>FHIR Resources</h4>';
                body += `<table class="field-table"><thead><tr><th>Resource</th><th>Type</th><th>Validation</th></tr></thead><tbody>`;
                let firstFhirJson = null;
                for (const filename of fhirFilesToValidate) {
                    try {
                        const fhirJson = await fetchFHIRSample(filename);
                        if (!firstFhirJson) firstFhirJson = fhirJson;
                        const resourceType = fhirJson.resourceType || 'Unknown';
                        fhirResources.push({ filename, resourceType, json: fhirJson });
                        const valResult = await validateFHIR(JSON.stringify(fhirJson, null, 2));
                        const isValid = valResult && valResult.success;
                        body += `<tr><td>${escapeHtml(filename)}</td><td><span class="status-badge green">${escapeHtml(resourceType)}</span></td><td><span class="${isValid ? 'match-pass' : 'match-fail'}">${isValid ? 'VALID' : 'INVALID'}</span></td></tr>`;
                        if (!isValid) allValid = false;
                    } catch (fileErr) {
                        body += `<tr><td>${escapeHtml(filename)}</td><td>-</td><td><span class="match-fail">ERROR</span></td></tr>`;
                        allValid = false;
                    }
                }
                body += '</tbody></table>';
                setStageSummary('stage-4c', `${fhirResources.length} resources validated`);
                if (firstFhirJson) body += makeCollapsibleCode('FHIR JSON', JSON.stringify(firstFhirJson, null, 2));
                stage4cStatus = allValid ? 'pass' : 'fail';
                addTraceSection('Stage 4c: FHIR Bundle', stage4cStatus, `${fhirResources.length} resources`, body);
            } catch (e) {
                addTraceSection('Stage 4c: FHIR Bundle', 'fail', 'Error', `<p class="match-fail">${escapeHtml(e.message)}</p>`);
            }
            setStageStatus('stage-4c', stage4cStatus, stage4cStatus === 'pass' ? 'Pass' : 'Fail');
            stageOutcomes.push({ name: 'FHIR Bundle', status: stage4cStatus });
        }

        // =====================================================================
        // Summary
        // =====================================================================
        renderSummary(stageOutcomes, scenario);

    } catch (e) {
        console.error('Trace failed:', e);
        addTraceSection('Trace Error', 'fail', '', `<p class="match-fail">Trace failed: ${escapeHtml(e.message)}</p>`);
        renderSummary(stageOutcomes, scenario);
    } finally {
        document.getElementById('trace-btn').disabled = false;
    }
}

function renderSummary(outcomes, scenario) {
    const el = document.getElementById('flow-summary');
    const total = outcomes.length;
    const passed = outcomes.filter(o => o.status === 'pass').length;
    const warned = outcomes.filter(o => o.status === 'warn').length;
    const failed = outcomes.filter(o => o.status === 'fail').length;
    const allHealthy = failed === 0;

    const failedNames = outcomes.filter(o => o.status === 'fail').map(o => o.name);
    const warnedNames = outcomes.filter(o => o.status === 'warn').map(o => o.name);

    let message = '';
    if (allHealthy && warned === 0) {
        message = 'Integration pipeline is healthy. All stages processed successfully.';
    } else if (allHealthy && warned > 0) {
        message = `Integration pipeline completed with warnings at: ${warnedNames.join(', ')}. See details above.`;
    } else {
        message = `Issues detected at: ${failedNames.join(', ')}. See details above.`;
    }

    const overallClass = allHealthy ? 'healthy' : 'issues';
    const badgeText = allHealthy ? 'HEALTHY' : 'ISSUES DETECTED';

    el.className = `flow-summary visible ${overallClass}`;
    el.innerHTML = `
        <div class="summary-title">
            Flow Trace Complete
            <span class="overall-badge ${overallClass}">${badgeText}</span>
        </div>
        <div class="summary-counts">
            Total stages: <span>${total}</span> &nbsp;|&nbsp;
            Passed: <span class="text-green">${passed}</span> &nbsp;|&nbsp;
            ${warned > 0 ? `Warnings: <span class="text-yellow">${warned}</span> &nbsp;|&nbsp;` : ''}
            Failed: <span class="${failed > 0 ? 'text-red' : ''}">${failed}</span>
        </div>
        <div class="summary-message">${escapeHtml(message)}</div>
        ${!allHealthy && scenario && Object.keys(scenario.errors).length > 0 ?
            Object.values(scenario.errors).map(err =>
                `<a class="runbook-link" href="/runbooks" onclick="sessionStorage.setItem('openRunbook','${err.runbook_id}')" style="margin-top:16px">Open Runbook: ${escapeHtml(err.runbook_name)}</a>`
            ).join('') : ''}
    `;
}
