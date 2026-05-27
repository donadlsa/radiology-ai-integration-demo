// Troubleshooting Runbooks — Decision Tree Engine
// Each runbook is a branching decision tree, not a linear checklist.

const RUNBOOKS = [
    // =========================================================================
    // 1. Study Not Reaching AI Engine (P1)
    // =========================================================================
    {
        id: "study-not-reaching-ai",
        title: "Study Not Reaching AI Engine",
        severity: "P1",
        description: "Studies sent from customer PACS are not arriving at the AI engine for analysis.",
        estimatedTime: "15-45 min",
        nodes: {
            "start": {
                id: "start",
                title: "Check Integration Health Dashboard",
                instruction: "Open the customer's detail page in the Integration Ops dashboard and check the DICOM connection status indicator. Note whether the status is Red (Critical), Yellow (Degraded), or Green (Healthy).",
                checkType: null,
                outcomes: [
                    { label: "DICOM status is RED / Critical", next: "check-dicom-port", style: "danger" },
                    { label: "DICOM status is YELLOW / Degraded", next: "check-error-rate", style: "warning" },
                    { label: "DICOM status is GREEN / Healthy", next: "check-modality-filter", style: "success" }
                ]
            },
            "check-dicom-port": {
                id: "check-dicom-port",
                title: "Verify DICOM Port Connectivity",
                instruction: "Check if the DICOM C-STORE port (typically 11112) is reachable from the customer PACS network. Run: telnet <ai-engine-ip> 11112 or use a C-ECHO from the PACS admin console.",
                checkType: null,
                outcomes: [
                    { label: "Port is CLOSED / Unreachable", next: "resolution-firewall", style: "danger" },
                    { label: "Port is OPEN but connection drops", next: "check-tls", style: "warning" },
                    { label: "Port is OPEN and C-ECHO succeeds", next: "check-ae-title", style: "success" }
                ]
            },
            "check-tls": {
                id: "check-tls",
                title: "Check TLS / DICOM-TLS Configuration",
                instruction: "If the port is open but the connection drops during the DICOM association, TLS may be misconfigured. Check whether the PACS is sending unencrypted DICOM to a TLS-only port or vice versa. Verify certificate validity.",
                checkType: null,
                outcomes: [
                    { label: "TLS mismatch confirmed", next: "resolution-tls", style: "danger" },
                    { label: "TLS is not in use / both sides match", next: "check-ae-title", style: "success" }
                ]
            },
            "resolution-tls": {
                id: "resolution-tls",
                type: "resolution",
                title: "Fix TLS Configuration",
                instruction: "Align the TLS settings between PACS and AI engine. Either enable TLS on the PACS side or configure the AI engine listener to accept unencrypted DICOM on a separate port. Update the customer's firewall rules if port changes are needed.",
                resolution: "Update TLS configuration on the DICOM listener or PACS to ensure both endpoints agree on encryption. If using certificates, verify the CA chain is trusted."
            },
            "resolution-firewall": {
                id: "resolution-firewall",
                type: "resolution",
                title: "Open Firewall / Network Rule",
                instruction: "The DICOM port is blocked at the network level. Work with the customer IT team or cloud infrastructure team to open the required port.",
                resolution: "Add firewall rule to allow inbound traffic on port 11112 (or configured DICOM port) from the customer PACS IP range. If using a VPN tunnel, verify the tunnel is up and routes are correct. Re-test with C-ECHO after the change."
            },
            "check-ae-title": {
                id: "check-ae-title",
                title: "Verify AE Title Configuration",
                instruction: "Inspect the DICOM association request. Check that the Called AE Title in the PACS matches the AE Title configured on the AI engine listener, and the Calling AE Title is in the allowed list.",
                checkType: "api_dicom",
                apiParams: { filename: "chest_xray.dcm", tag_group: "routing" },
                outcomes: [
                    { label: "AE Title MISMATCH", next: "resolution-ae-title", style: "danger" },
                    { label: "AE Titles MATCH", next: "check-modality-filter", style: "success" }
                ]
            },
            "resolution-ae-title": {
                id: "resolution-ae-title",
                type: "resolution",
                title: "Update AE Title Configuration",
                instruction: "The AE title on the PACS does not match the AI engine listener configuration.",
                resolution: "Update the Called AE Title in the PACS send destination to match the AI engine's configured AE Title, or add the customer's Calling AE Title to the AI engine's allowed callers list in the config registry. Re-send a test study to confirm."
            },
            "check-error-rate": {
                id: "check-error-rate",
                title: "Analyze Error Rate Pattern",
                instruction: "The connection is degraded but not down. Check the error rate over the last 24 hours. Look at whether errors are concentrated on specific study types, times, or sizes. Check the SLO dashboard for timeout trends.",
                checkType: null,
                outcomes: [
                    { label: "Errors correlate with LARGE series (>500 images)", next: "check-timeout-bandwidth", style: "warning" },
                    { label: "Errors are RANDOM across all study types", next: "escalate-platform", style: "danger" },
                    { label: "Errors only on specific MODALITY", next: "check-modality-filter", style: "warning" }
                ]
            },
            "check-timeout-bandwidth": {
                id: "check-timeout-bandwidth",
                title: "Check Transfer Timeout and Bandwidth",
                instruction: "Large series (CT with 500+ images, MR with thick stacks) can exceed default DICOM association timeouts. Check the DIMSE timeout setting and the available bandwidth between PACS and AI engine.",
                checkType: null,
                outcomes: [
                    { label: "Timeout is too LOW for large transfers", next: "resolution-timeout", style: "danger" },
                    { label: "Bandwidth is saturated during peak hours", next: "resolution-bandwidth", style: "warning" }
                ]
            },
            "resolution-timeout": {
                id: "resolution-timeout",
                type: "resolution",
                title: "Increase DIMSE Timeout",
                instruction: "The default DIMSE timeout is too short for large series transfers.",
                resolution: "Increase the DIMSE association timeout from the default (typically 30s) to 120s or higher. Also increase the ARTIM timer. Update both the AI engine listener and the PACS send timeout configuration. For very large studies (>1000 images), consider enabling DICOM C-MOVE with compression."
            },
            "resolution-bandwidth": {
                id: "resolution-bandwidth",
                type: "resolution",
                title: "Address Bandwidth Constraints",
                instruction: "Network bandwidth is saturated during peak imaging hours.",
                resolution: "Work with the customer to implement QoS rules prioritizing DICOM traffic or schedule large batch transfers during off-peak hours. Consider enabling DICOM transfer syntax negotiation to use compressed transfer syntaxes (JPEG Lossless 1.2.840.10008.1.2.4.70) to reduce payload size."
            },
            "check-modality-filter": {
                id: "check-modality-filter",
                title: "Check Modality and Study Filter",
                instruction: "The AI engine may be filtering out this modality. Check the supported modality list in the config registry. Common supported modalities: CR, DX, CT, MG. Some products do not support US, MR, or NM.",
                checkType: "api_dicom",
                apiParams: { filename: "chest_xray.dcm", tag_group: "all" },
                outcomes: [
                    { label: "Modality NOT in supported list", next: "resolution-modality", style: "danger" },
                    { label: "Modality IS supported", next: "check-order-exists", style: "success" }
                ]
            },
            "resolution-modality": {
                id: "resolution-modality",
                type: "resolution",
                title: "Update Modality Filter",
                instruction: "The study's modality is not in the AI engine's supported modality list.",
                resolution: "If the modality should be supported (check with the product team), add it to the modality filter in the config registry. If the modality is genuinely not supported by the AI product, inform the customer that this modality type is not eligible for AI analysis."
            },
            "check-order-exists": {
                id: "check-order-exists",
                title: "Check if HL7 Order Exists",
                instruction: "The AI engine may require a matching ORM order before processing a study. Parse the HL7 message log to find an ORM^O01 with a matching accession number for this study.",
                checkType: "api_hl7",
                apiParams: { message_type: "ORM" },
                outcomes: [
                    { label: "No matching order found", next: "resolution-hl7-interface", style: "danger" },
                    { label: "Order EXISTS with matching accession", next: "check-demographics-match", style: "success" }
                ]
            },
            "resolution-hl7-interface": {
                id: "resolution-hl7-interface",
                type: "resolution",
                title: "Fix HL7 Order Interface",
                instruction: "No ORM order was received for this study. The HL7 interface may be down, or the order was never sent.",
                resolution: "Check the HL7 interface engine for errors (see HL7 Interface Errors runbook). Verify the ORM feed is active and the customer's EHR/RIS is sending orders. If orders are delayed, configure the AI engine to hold images in a buffer queue until a matching order arrives (match timeout: 30 minutes recommended)."
            },
            "check-demographics-match": {
                id: "check-demographics-match",
                title: "Compare HL7 and DICOM Demographics",
                instruction: "Run a field-by-field comparison between the HL7 order demographics and the DICOM study header demographics. Mismatches in MRN, name, or DOB can prevent the AI engine from pairing the order with the study.",
                checkType: "api_compare",
                outcomes: [
                    { label: "Demographics MISMATCH detected", next: "resolution-demographics", style: "danger" },
                    { label: "All demographics MATCH", next: "escalate-engineering", style: "warning" }
                ]
            },
            "resolution-demographics": {
                id: "resolution-demographics",
                type: "resolution",
                title: "Fix Demographics Mapping",
                instruction: "Demographics between the HL7 order and DICOM study do not match.",
                resolution: "Identify which fields mismatch. Common fixes: add MRN prefix/padding normalization in the interface engine, standardize name case (UPPERCASE vs Mixed), normalize DOB format (YYYYMMDD). Update the matching algorithm tolerance if minor differences (middle name, suffix) are causing false negatives."
            },
            "escalate-engineering": {
                id: "escalate-engineering",
                type: "escalation",
                title: "Escalate to Platform Engineering",
                instruction: "All configuration appears correct but studies are still not being processed.",
                escalation: "Escalate to the platform engineering team. Provide: customer ID, sample Study Instance UID, timestamps of failed studies, confirmation that network/AE/modality/order/demographics are all verified correct. The issue may be in the AI engine's internal routing or processing pipeline."
            },
            "escalate-platform": {
                id: "escalate-platform",
                type: "escalation",
                title: "Escalate to Platform Team",
                instruction: "Random errors across all study types suggest a platform-level issue rather than a configuration problem.",
                escalation: "Escalate to the platform team with: error rate percentage, time range, affected customer(s), sample error messages from DICOM association logs. Check if there is a known platform incident in progress."
            }
        }
    },

    // =========================================================================
    // 2. AI Results Not Appearing in PACS (P1)
    // =========================================================================
    {
        id: "ai-results-not-in-pacs",
        title: "AI Results Not Appearing in PACS",
        severity: "P1",
        description: "The AI engine processed the study but the structured report is not visible in the PACS.",
        estimatedTime: "15-30 min",
        nodes: {
            "start": {
                id: "start",
                title: "Check if AI Structured Report Was Generated",
                instruction: "Verify that the AI engine completed processing and generated a DICOM Structured Report (SR). Check the AI engine processing log for the Study Instance UID. If the SR was generated, check its SOP Class UID (should be 1.2.840.10008.5.1.4.1.1.88.33 for Comprehensive SR).",
                checkType: "api_dicom",
                apiParams: { filename: "chest_xray.dcm", tag_group: "all" },
                outcomes: [
                    { label: "SR was NOT generated", next: "escalate-ai-team", style: "danger" },
                    { label: "SR was generated", next: "check-study-uid", style: "success" }
                ]
            },
            "escalate-ai-team": {
                id: "escalate-ai-team",
                type: "escalation",
                title: "Escalate to AI Engineering Team",
                instruction: "The AI engine did not generate a Structured Report for this study.",
                escalation: "Escalate to the AI engineering team with: Study Instance UID, modality, number of images in the series, customer ID, and the timestamp when the study was received. Check if the AI engine is in a degraded state or if this specific study type triggered a processing error."
            },
            "check-study-uid": {
                id: "check-study-uid",
                title: "Verify Study Instance UID Linkage",
                instruction: "The SR must share the exact same Study Instance UID as the original imaging study for the PACS to display it as part of the same study. Compare the Study Instance UID on the SR with the original study.",
                checkType: null,
                outcomes: [
                    { label: "UIDs DO NOT match", next: "resolution-sr-builder", style: "danger" },
                    { label: "UIDs MATCH", next: "check-series-desc", style: "success" }
                ]
            },
            "resolution-sr-builder": {
                id: "resolution-sr-builder",
                type: "resolution",
                title: "Fix SR Builder Study UID Configuration",
                instruction: "The Structured Report has a different Study Instance UID than the source study.",
                resolution: "Update the SR builder configuration to copy the Study Instance UID from the source study rather than generating a new one. The SR must also inherit the correct Patient ID, Accession Number, and Referring Physician from the source. Re-process the study after the fix."
            },
            "check-series-desc": {
                id: "check-series-desc",
                title: "Check Series Description Worklist Filter",
                instruction: "Many PACS systems filter the worklist display by Series Description. The SR's Series Description must match what the PACS expects. Check the customer's PACS worklist configuration for the expected Series Description value.",
                checkType: null,
                outcomes: [
                    { label: "Series Description does NOT match worklist filter", next: "resolution-series-desc", style: "danger" },
                    { label: "Series Description matches OR PACS has no filter", next: "check-cstore-dest", style: "success" }
                ]
            },
            "resolution-series-desc": {
                id: "resolution-series-desc",
                type: "resolution",
                title: "Update SR Series Description",
                instruction: "The PACS worklist filter does not recognize the SR's Series Description.",
                resolution: "Update the SR Series Description in the AI engine output configuration to match the customer's expected value (commonly 'AI Analysis Report', 'AI Findings', or a customer-specific string). Coordinate with the customer's PACS admin to confirm the expected value. Re-send the SR after updating."
            },
            "check-cstore-dest": {
                id: "check-cstore-dest",
                title: "Verify DICOM C-STORE to Customer PACS",
                instruction: "Check if the AI engine is successfully sending the SR to the customer's PACS via C-STORE. Review the outbound DICOM association log for the delivery attempt. Check the destination AE Title, IP, and port.",
                checkType: null,
                outcomes: [
                    { label: "C-STORE FAILED (connection error)", next: "check-pacs-ae-port", style: "danger" },
                    { label: "C-STORE SUCCEEDED (association accepted)", next: "check-pacs-display", style: "success" }
                ]
            },
            "check-pacs-ae-port": {
                id: "check-pacs-ae-port",
                title: "Check PACS AE Title and Port",
                instruction: "The C-STORE to the customer PACS failed. Verify the outbound destination configuration: Called AE Title, IP address, and DICOM port. Test connectivity with a C-ECHO.",
                checkType: null,
                outcomes: [
                    { label: "AE Title or port is WRONG", next: "resolution-outbound-routing", style: "danger" },
                    { label: "Config is correct but connection still fails", next: "escalate-customer-it", style: "warning" }
                ]
            },
            "resolution-outbound-routing": {
                id: "resolution-outbound-routing",
                type: "resolution",
                title: "Fix Outbound DICOM Routing",
                instruction: "The outbound DICOM destination for this customer is misconfigured.",
                resolution: "Update the outbound routing configuration with the correct PACS AE Title, IP address, and port. Verify with a C-ECHO before re-sending the SR. If multiple PACS nodes exist (e.g., primary and disaster recovery), ensure the correct node is targeted."
            },
            "check-pacs-display": {
                id: "check-pacs-display",
                title: "Check PACS Worklist and Display Configuration",
                instruction: "The SR was successfully sent to the PACS (C-STORE acknowledged), but the radiologist cannot see it. This is likely a PACS display configuration issue. Check if the PACS accepts DICOM SR SOP classes, and if the worklist query includes SR objects.",
                checkType: null,
                outcomes: [
                    { label: "PACS does not display SR objects by default", next: "resolution-pacs-config", style: "warning" },
                    { label: "Cannot determine the cause", next: "escalate-customer-it", style: "danger" }
                ]
            },
            "resolution-pacs-config": {
                id: "resolution-pacs-config",
                type: "resolution",
                title: "Configure PACS to Display SR Objects",
                instruction: "The PACS accepted the SR but does not display it in the worklist.",
                resolution: "Work with the customer's PACS administrator to enable DICOM SR display in the worklist view. Some PACS systems require explicit configuration to show SR objects alongside imaging series. Alternatively, if the PACS cannot display SRs natively, consider delivering results as a Secondary Capture image (SC) or a GSPS overlay instead."
            },
            "escalate-customer-it": {
                id: "escalate-customer-it",
                type: "escalation",
                title: "Escalate to Customer IT / PACS Admin",
                instruction: "The AI SR was generated and sent correctly, but the customer PACS is not displaying it.",
                escalation: "Escalate to the customer's IT team / PACS administrator. Provide: confirmation that the SR was delivered (C-STORE association log showing success), the Study Instance UID, the SR SOP Instance UID, and the Series Description used. Request they check the PACS receiving log and worklist filter configuration."
            }
        }
    },

    // =========================================================================
    // 3. Order/Image Mismatch (P2)
    // =========================================================================
    {
        id: "order-image-mismatch",
        title: "Order/Image Mismatch",
        severity: "P2",
        description: "The HL7 order and DICOM image cannot be matched -- accession numbers or demographics differ.",
        estimatedTime: "10-30 min",
        nodes: {
            "start": {
                id: "start",
                title: "Parse the HL7 Order Message",
                instruction: "Parse the ORM^O01 order message to extract the accession number (OBR-18), MRN (PID-3), patient name (PID-5), and date of birth (PID-7). Verify the message parses correctly.",
                checkType: "api_hl7",
                apiParams: { message_type: "ORM" },
                outcomes: [
                    { label: "HL7 message FAILS to parse", next: "redirect-hl7-errors", style: "danger" },
                    { label: "HL7 message parses SUCCESSFULLY", next: "inspect-dicom-tags", style: "success" }
                ]
            },
            "redirect-hl7-errors": {
                id: "redirect-hl7-errors",
                type: "escalation",
                title: "Redirect to HL7 Interface Errors Runbook",
                instruction: "The HL7 order message cannot be parsed. This is an HL7 interface issue, not a matching issue.",
                escalation: "Switch to the 'HL7 Interface Errors' runbook to diagnose the parsing failure. Once the HL7 message can be parsed successfully, return to this runbook to continue the matching investigation."
            },
            "inspect-dicom-tags": {
                id: "inspect-dicom-tags",
                title: "Inspect DICOM Study Tags",
                instruction: "Inspect the DICOM study headers to extract AccessionNumber (0008,0050), PatientID (0010,0020), PatientName (0010,0010), and PatientBirthDate (0010,0030).",
                checkType: "api_dicom",
                apiParams: { filename: "chest_xray.dcm", tag_group: "patient" },
                outcomes: [
                    { label: "DICOM tags extracted successfully", next: "compare-demographics", style: "success" },
                    { label: "Key DICOM tags are MISSING or EMPTY", next: "resolution-mwl", style: "danger" }
                ]
            },
            "resolution-mwl": {
                id: "resolution-mwl",
                type: "resolution",
                title: "Fix Modality Worklist Configuration",
                instruction: "Key patient/study tags are missing from the DICOM headers. The modality is likely not pulling demographics from the Modality Worklist (MWL).",
                resolution: "Check the modality's MWL (C-FIND) query configuration. Ensure the modality queries the worklist before acquisition and populates patient demographics from the MWL response. If MWL is not available, ensure the technologist manually enters demographics that match the order."
            },
            "compare-demographics": {
                id: "compare-demographics",
                title: "Compare HL7 and DICOM Demographics",
                instruction: "Run a field-by-field comparison of patient demographics between the HL7 order and the DICOM study. Check MRN, patient name, DOB, and sex.",
                checkType: "api_compare",
                outcomes: [
                    { label: "All demographics MATCH", next: "check-accession-format", style: "success" },
                    { label: "MRN does not match", next: "check-mrn-format", style: "danger" },
                    { label: "Patient NAME does not match", next: "check-name-encoding", style: "warning" },
                    { label: "DOB does not match", next: "escalate-registration", style: "danger" }
                ]
            },
            "check-accession-format": {
                id: "check-accession-format",
                title: "Check Accession Number Format",
                instruction: "Demographics match but the system still cannot pair the order and image. Compare the accession number format between HL7 OBR-18 and DICOM AccessionNumber (0008,0050). Look for: leading zeros, prefix differences, separators (hyphens vs dots), or truncation.",
                checkType: null,
                outcomes: [
                    { label: "Accession formats DIFFER", next: "resolution-accession", style: "danger" },
                    { label: "Accession formats are IDENTICAL", next: "check-timing", style: "success" }
                ]
            },
            "resolution-accession": {
                id: "resolution-accession",
                type: "resolution",
                title: "Normalize Accession Number Format",
                instruction: "The accession number format differs between the HL7 order and DICOM study.",
                resolution: "Add an accession number normalization transform in the interface engine. Common normalizations: strip leading zeros, remove hyphens/dots, add or remove a site prefix. Apply the same normalization to both the HL7 and DICOM sides before matching. Test with 5-10 historical accession numbers to confirm the pattern."
            },
            "check-timing": {
                id: "check-timing",
                title: "Check Order/Image Timing",
                instruction: "Everything matches but the pairing is still failing. Check if the image arrived BEFORE the order. Compare the HL7 message timestamp (MSH-7) with the DICOM Study Date/Time. If images arrive before orders, the matching window may have expired.",
                checkType: null,
                outcomes: [
                    { label: "Image arrived BEFORE order", next: "resolution-buffer-queue", style: "warning" },
                    { label: "Order arrived first (timing is correct)", next: "escalate-matching-engine", style: "danger" }
                ]
            },
            "resolution-buffer-queue": {
                id: "resolution-buffer-queue",
                type: "resolution",
                title: "Configure Image Buffer Queue",
                instruction: "Images are arriving before their corresponding orders, exceeding the match timeout window.",
                resolution: "Increase the image buffer queue timeout from the default (typically 15 minutes) to 45-60 minutes. This allows the system to hold unmatched images until the order arrives. Also investigate why orders are delayed at the source (EHR workflow issue, interface lag)."
            },
            "check-mrn-format": {
                id: "check-mrn-format",
                title: "Analyze MRN Format Difference",
                instruction: "The MRN does not match between HL7 and DICOM. Common issues: one system uses a prefix (e.g., 'MRN-' or site code), zero-padding differences, or the DICOM modality uses a local patient ID instead of the enterprise MRN.",
                checkType: null,
                outcomes: [
                    { label: "Prefix or padding difference", next: "resolution-mrn-mapping", style: "warning" },
                    { label: "Completely different ID (local vs enterprise)", next: "resolution-mrn-crossref", style: "danger" }
                ]
            },
            "resolution-mrn-mapping": {
                id: "resolution-mrn-mapping",
                type: "resolution",
                title: "Add MRN Prefix/Padding Normalization",
                instruction: "The MRN has a prefix or padding difference between HL7 and DICOM.",
                resolution: "Add a MRN normalization transform: strip the prefix (e.g., remove 'MRN-', site codes), normalize zero-padding, and standardize to a canonical format. Apply to both HL7 PID-3 and DICOM PatientID before matching."
            },
            "resolution-mrn-crossref": {
                id: "resolution-mrn-crossref",
                type: "resolution",
                title: "Configure MRN Cross-Reference",
                instruction: "The DICOM modality uses a local patient ID that differs from the enterprise MRN in the HL7 order.",
                resolution: "Implement an MRN cross-reference (PIX) lookup or configure the modality to use the enterprise MRN via the Modality Worklist. If the customer has a Master Patient Index (MPI), integrate with it to resolve local-to-enterprise ID mappings."
            },
            "check-name-encoding": {
                id: "check-name-encoding",
                title: "Check Name Encoding and Format",
                instruction: "The patient name does not match. Check for: UPPERCASE vs mixed case, special characters (accents, hyphens), middle name inclusion/exclusion, name order (Last^First vs First Last), and character encoding differences.",
                checkType: null,
                outcomes: [
                    { label: "Case or format difference only", next: "resolution-name-normalization", style: "warning" },
                    { label: "Names are genuinely different", next: "escalate-registration", style: "danger" }
                ]
            },
            "resolution-name-normalization": {
                id: "resolution-name-normalization",
                type: "resolution",
                title: "Fix Name Normalization",
                instruction: "The patient name differs only in case, format, or encoding between HL7 and DICOM.",
                resolution: "Add name normalization: convert both to uppercase, strip accents/diacritics, standardize to Last^First format, remove middle names for matching purposes. Use a fuzzy matching algorithm (Levenshtein distance < 3) as a fallback."
            },
            "escalate-registration": {
                id: "escalate-registration",
                type: "escalation",
                title: "Escalate to Customer (Registration Error)",
                instruction: "The demographic mismatch (DOB or name) appears to be a genuine data entry error at the customer site, not a format issue.",
                escalation: "Escalate to the customer's registration or radiology department. Provide the specific mismatch details (e.g., DOB in HL7 is 1980-03-15 but DICOM has 1980-03-51). This is likely a typo at registration time. The customer will need to correct the order or re-register the patient."
            },
            "escalate-matching-engine": {
                id: "escalate-matching-engine",
                type: "escalation",
                title: "Escalate to Platform Engineering",
                instruction: "All data matches (demographics, accession, timing) but the matching engine is still not pairing the order and image.",
                escalation: "Escalate to platform engineering. Provide: the ORM message control ID, the DICOM Study Instance UID, both accession numbers (confirmed matching), and confirmation that demographics are identical. The issue may be in the matching engine's logic or internal state."
            }
        }
    },

    // =========================================================================
    // 4. HL7 Interface Errors (P2)
    // =========================================================================
    {
        id: "hl7-interface-errors",
        title: "HL7 Interface Errors",
        severity: "P2",
        description: "HL7 messages are failing to parse or being rejected by the receiving system.",
        estimatedTime: "10-30 min",
        nodes: {
            "start": {
                id: "start",
                title: "Parse the Failing HL7 Message",
                instruction: "Attempt to parse the problematic HL7 message using the diagnostic parser. This will reveal whether the message structure is valid HL7 v2.x.",
                checkType: "api_hl7",
                apiParams: { message_type: "ORM" },
                outcomes: [
                    { label: "Parse FAILED (invalid message structure)", next: "check-encoding", style: "danger" },
                    { label: "Parse SUCCEEDED (valid HL7 structure)", next: "check-facility-code", style: "success" }
                ]
            },
            "check-encoding": {
                id: "check-encoding",
                title: "Check Message Encoding and Delimiters",
                instruction: "Examine the raw message bytes. Check MSH-1 (field separator, should be '|') and MSH-2 (encoding characters, should be '^~\\&'). Look for non-standard delimiters, non-ASCII characters, or BOM (byte order mark) at the start.",
                checkType: null,
                outcomes: [
                    { label: "Non-standard DELIMITERS found", next: "resolution-delimiters", style: "danger" },
                    { label: "Message appears TRUNCATED", next: "resolution-tcp-buffer", style: "warning" },
                    { label: "Non-ASCII or corrupt CHARACTERS", next: "resolution-encoding-filter", style: "danger" }
                ]
            },
            "resolution-delimiters": {
                id: "resolution-delimiters",
                type: "resolution",
                title: "Add Delimiter Transform",
                instruction: "The customer's system is using non-standard HL7 delimiters.",
                resolution: "Add a pre-processing transform in the interface engine to normalize delimiters before parsing. Common issues: using '#' instead of '|' as field separator, using '~' in MSH-2 differently, or using '@' as component separator. Map the customer's delimiters to standard HL7 delimiters."
            },
            "resolution-tcp-buffer": {
                id: "resolution-tcp-buffer",
                type: "resolution",
                title: "Fix TCP Buffer / Message Framing",
                instruction: "The HL7 message is being truncated during transmission.",
                resolution: "Check the MLLP (Minimal Lower Layer Protocol) framing. Ensure messages start with 0x0B and end with 0x1C 0x0D. Increase the TCP receive buffer size if large messages are being cut off. Check if the sending system is splitting messages across multiple TCP packets without proper framing. Common fix: increase max_message_length from 64KB to 1MB."
            },
            "resolution-encoding-filter": {
                id: "resolution-encoding-filter",
                type: "resolution",
                title: "Add Character Encoding Filter",
                instruction: "The message contains non-ASCII characters that break the HL7 parser.",
                resolution: "Add an encoding filter in the interface engine to either strip non-ASCII characters or convert them to ASCII equivalents (e.g., accented characters to their unaccented forms). If the customer uses a specific character set (ISO-8859-1, UTF-8), configure MSH-18 (Character Set) and ensure the parser supports it."
            },
            "check-facility-code": {
                id: "check-facility-code",
                title: "Check MSH-4 Sending Facility Code",
                instruction: "The message parses correctly but may be rejected due to facility identification. Check MSH-4 (Sending Facility) against the list of recognized facilities in the config registry.",
                checkType: null,
                outcomes: [
                    { label: "Facility code is UNRECOGNIZED", next: "resolution-facility-alias", style: "danger" },
                    { label: "Facility code is RECOGNIZED", next: "check-required-segments", style: "success" }
                ]
            },
            "resolution-facility-alias": {
                id: "resolution-facility-alias",
                type: "resolution",
                title: "Add Facility Alias",
                instruction: "The sending facility code in MSH-4 is not recognized by the interface engine.",
                resolution: "Add a facility alias mapping in the config registry. The customer may be sending a different facility code than what was configured during onboarding (e.g., facility code changed after an EHR upgrade, or a new facility/department is sending messages). Map the new code to the existing customer configuration."
            },
            "check-required-segments": {
                id: "check-required-segments",
                title: "Check Required Segments",
                instruction: "Verify all required segments are present. For ORM^O01: MSH, PID, PV1, ORC, OBR. For ORU^R01: MSH, PID, OBR, OBX. Check for missing or empty segments that the interface engine requires.",
                checkType: null,
                outcomes: [
                    { label: "PID segment is MISSING or EMPTY", next: "escalate-customer-ehr", style: "danger" },
                    { label: "OBR segment has MISSING required fields", next: "resolution-default-values", style: "warning" },
                    { label: "All required segments are PRESENT", next: "check-nak-response", style: "success" }
                ]
            },
            "escalate-customer-ehr": {
                id: "escalate-customer-ehr",
                type: "escalation",
                title: "Escalate to Customer EHR Team",
                instruction: "The PID (Patient Identification) segment is missing or empty. This is a sending system configuration issue.",
                escalation: "Escalate to the customer's EHR/RIS team. The HL7 interface on their system is not including the PID segment with patient demographics. This typically requires reconfiguration of their outbound HL7 interface. Provide a sample of what the message should look like."
            },
            "resolution-default-values": {
                id: "resolution-default-values",
                type: "resolution",
                title: "Add Default Values in Transform",
                instruction: "OBR fields that the AI engine requires are missing from the customer's messages.",
                resolution: "Add a transform rule in the interface engine to populate missing OBR fields with default values. Common defaults: OBR-24 (Modality) can be derived from the procedure code in OBR-4, OBR-18 (Accession) can fall back to ORC-2 (Placer Order Number) if missing. Document which defaults are applied for audit purposes."
            },
            "check-nak-response": {
                id: "check-nak-response",
                title: "Check NAK Response from Receiver",
                instruction: "The message structure appears valid but the receiving system is sending a NAK (Negative Acknowledgment). Check the ACK/NAK response, specifically MSA-1 (Acknowledgment Code) and MSA-3 (Text Message) for the error reason.",
                checkType: null,
                outcomes: [
                    { label: "NAK: Duplicate message control ID", next: "resolution-duplicate-id", style: "warning" },
                    { label: "NAK: Unknown/unsupported message type", next: "resolution-message-type", style: "danger" },
                    { label: "NAK: Application-specific error", next: "escalate-receiving-system", style: "danger" },
                    { label: "ACK is AA (accepted) -- no NAK", next: "check-downstream-processing", style: "success" }
                ]
            },
            "resolution-duplicate-id": {
                id: "resolution-duplicate-id",
                type: "resolution",
                title: "Fix Duplicate Message Control ID",
                instruction: "The receiving system rejected the message because the Message Control ID (MSH-10) was already processed.",
                resolution: "The sending system is reusing MSH-10 values. Either fix the sending system to generate unique control IDs, or add a transform to overwrite MSH-10 with a unique value (UUID or timestamp-based) before forwarding. If the resend is intentional, check if the receiver has an idempotency check that should be disabled."
            },
            "resolution-message-type": {
                id: "resolution-message-type",
                type: "resolution",
                title: "Fix Message Type Mapping",
                instruction: "The receiving system does not recognize the message type/trigger event.",
                resolution: "Check if the customer is sending a non-standard message type (e.g., ORM^O02 instead of ORM^O01, or a custom Z-segment trigger). Add a transform to remap the message type in MSH-9 to the expected type before forwarding to the receiver."
            },
            "check-downstream-processing": {
                id: "check-downstream-processing",
                title: "Check Downstream Processing",
                instruction: "The message was accepted (ACK=AA) but the expected action did not occur. Check if the message is being processed correctly downstream (e.g., order created in the AI engine, result delivered to the EHR).",
                checkType: null,
                outcomes: [
                    { label: "Message was accepted but NOT processed", next: "escalate-receiving-system", style: "danger" },
                    { label: "Message was processed correctly", next: "resolution-false-alarm", style: "success" }
                ]
            },
            "resolution-false-alarm": {
                id: "resolution-false-alarm",
                type: "resolution",
                title: "False Alarm / Transient Error",
                instruction: "The HL7 interface is working correctly. The original error may have been a transient issue.",
                resolution: "The interface is processing messages correctly now. If the error was transient (network blip, brief service restart), no action is needed beyond monitoring. Set up an alert for repeated errors on this interface to catch future issues early."
            },
            "escalate-receiving-system": {
                id: "escalate-receiving-system",
                type: "escalation",
                title: "Escalate to Receiving System Team",
                instruction: "The receiving system is accepting messages but not processing them correctly, or is returning application-specific errors.",
                escalation: "Escalate to the receiving system team (internal AI platform team or customer EHR team depending on message direction). Provide: sample message (sanitized), MSA error text, MSH-10 control ID, and the timestamp. Request log review on their side."
            }
        }
    },

    // =========================================================================
    // 5. Critical Result Not Delivered (P1)
    // =========================================================================
    {
        id: "critical-result-not-delivered",
        title: "Critical Result Not Delivered",
        severity: "P1",
        description: "AI detected a critical finding but the alert was not delivered to the ordering clinician.",
        estimatedTime: "5-15 min",
        nodes: {
            "start": {
                id: "start",
                title: "Parse the ORU Result Message",
                instruction: "Parse the ORU^R01 result message. Check if OBX segments contain findings with SNOMED codes. Look for critical SNOMED codes: 36118008 (pneumothorax), 59282003 (pulmonary embolism), 230690007 (stroke), 71023001 (intracranial hemorrhage).",
                checkType: "api_hl7",
                apiParams: { message_type: "ORU" },
                outcomes: [
                    { label: "ORU has CRITICAL SNOMED code in OBX", next: "check-routing-rules", style: "danger" },
                    { label: "ORU has findings but NO critical SNOMED code", next: "check-if-truly-critical", style: "warning" },
                    { label: "ORU has NO findings at all", next: "escalate-ai-clinical", style: "danger" }
                ]
            },
            "check-routing-rules": {
                id: "check-routing-rules",
                title: "Check Critical Alert Routing Rules",
                instruction: "The ORU contains a critical finding with proper coding. Check the interface engine routing rules to verify that critical results are forwarded to the alerting/notification system. Look for a routing rule that inspects OBX segments for critical SNOMED codes or the 'CRITICAL' keyword.",
                checkType: null,
                outcomes: [
                    { label: "Critical alert routing rule is MISSING", next: "resolution-add-routing", style: "danger" },
                    { label: "Routing rule EXISTS", next: "check-notification-endpoint", style: "success" }
                ]
            },
            "resolution-add-routing": {
                id: "resolution-add-routing",
                type: "resolution",
                title: "Add Critical Alert Routing Rule",
                instruction: "No routing rule exists to forward critical results to the notification system.",
                resolution: "Add a routing rule in the interface engine that: (1) inspects each ORU^R01 OBX segment for critical SNOMED codes or the keyword 'CRITICAL', (2) if matched, duplicates the message to the CRITICAL_ALERT destination, (3) logs the critical alert for audit trail. Deploy and re-process the undelivered critical result immediately."
            },
            "check-notification-endpoint": {
                id: "check-notification-endpoint",
                title: "Verify Notification Endpoint",
                instruction: "The routing rule exists. Check if the notification system endpoint (SMS gateway, pager system, or email relay) is reachable. Test connectivity to the endpoint URL/IP.",
                checkType: null,
                outcomes: [
                    { label: "Endpoint is UNREACHABLE", next: "resolution-endpoint-config", style: "danger" },
                    { label: "Endpoint is REACHABLE", next: "check-notification-sent", style: "success" }
                ]
            },
            "resolution-endpoint-config": {
                id: "resolution-endpoint-config",
                type: "resolution",
                title: "Fix Notification Endpoint Configuration",
                instruction: "The notification system endpoint is unreachable.",
                resolution: "Check the endpoint URL/IP, authentication credentials, and firewall rules. If the endpoint recently changed (vendor migration, IP change), update the configuration. For SMS gateways, verify the API key is still valid. Re-send the critical alert immediately after fixing the endpoint. Set up endpoint health monitoring to catch future outages."
            },
            "check-notification-sent": {
                id: "check-notification-sent",
                title: "Check if Notification Was Sent",
                instruction: "The endpoint is reachable. Check the notification system logs to determine if the alert was actually sent. Look for the delivery status (sent, pending, failed) and the recipient.",
                checkType: null,
                outcomes: [
                    { label: "Alert was SENT but not received by clinician", next: "escalate-notification-vendor", style: "danger" },
                    { label: "Alert was NEVER sent (queue stuck)", next: "resolution-notification-queue", style: "warning" },
                    { label: "Alert was sent AND received", next: "resolution-communication-gap", style: "success" }
                ]
            },
            "escalate-notification-vendor": {
                id: "escalate-notification-vendor",
                type: "escalation",
                title: "Escalate to Notification Vendor",
                instruction: "The alert was dispatched from our system but the clinician did not receive it.",
                escalation: "Escalate to the notification vendor (SMS/pager provider). Provide: the message ID, timestamp, recipient number/address, and delivery status from our logs. Also verify the clinician's contact details are correct in the alerting system. In parallel, attempt to deliver the critical finding via an alternative channel (phone call, fax, backup pager)."
            },
            "resolution-notification-queue": {
                id: "resolution-notification-queue",
                type: "resolution",
                title: "Clear Notification Queue",
                instruction: "The notification was queued but never sent, indicating a stuck queue.",
                resolution: "Restart the notification queue processor. Investigate why the queue stalled (memory issue, dead lock, unprocessable message ahead in queue). Clear the stuck message if needed. Then immediately re-send all pending critical alerts. Review the queue monitoring to add alerting for future queue stalls."
            },
            "resolution-communication-gap": {
                id: "resolution-communication-gap",
                type: "resolution",
                title: "Communication Gap Identified",
                instruction: "The alert was sent and received, but the clinician reports not getting it.",
                resolution: "Verify the correct clinician was alerted (check ordering physician vs reading radiologist). Confirm the contact details are current. If the alert went to the wrong person, update the routing rules to map to the correct recipient based on the ordering provider in OBR-16. Set up delivery confirmation tracking."
            },
            "check-if-truly-critical": {
                id: "check-if-truly-critical",
                title: "Verify Finding Criticality",
                instruction: "The ORU has findings but no critical SNOMED code. Check if the AI engine classified this finding as critical. Look at the OBX abnormal flag (OBX-8) and the confidence score.",
                checkType: null,
                outcomes: [
                    { label: "AI flagged as CRITICAL but wrong SNOMED code used", next: "resolution-code-mapping", style: "warning" },
                    { label: "AI did NOT flag as critical", next: "escalate-ai-clinical", style: "danger" }
                ]
            },
            "resolution-code-mapping": {
                id: "resolution-code-mapping",
                type: "resolution",
                title: "Update Critical SNOMED Code Mapping",
                instruction: "The AI detected a critical finding but used a non-critical SNOMED code in the OBX segment.",
                resolution: "Update the AI engine's SNOMED code mapping to use the correct critical finding codes. Ensure the mapping table includes all critical codes recognized by the routing rules: 36118008 (pneumothorax), 59282003 (PE), 230690007 (stroke), 71023001 (ICH). Also add the OBX-8 abnormal flag 'C' (critical) for critical findings."
            },
            "escalate-ai-clinical": {
                id: "escalate-ai-clinical",
                type: "escalation",
                title: "Escalate to AI / Clinical Team",
                instruction: "The AI engine either did not detect the critical finding or did not generate any findings in the ORU.",
                escalation: "Escalate to the AI engineering and clinical teams. Provide: the Study Instance UID, modality, body part, and the expected critical finding (as reported by the radiologist). This may indicate a model performance issue (false negative), a confidence threshold issue, or a study quality issue. This is a clinical safety escalation."
            }
        }
    },

    // =========================================================================
    // 6. FHIR API Failures (P2)
    // =========================================================================
    {
        id: "fhir-api-failures",
        title: "FHIR API Failures",
        severity: "P2",
        description: "FHIR resource submissions are failing with validation errors, auth failures, or timeouts.",
        estimatedTime: "10-30 min",
        nodes: {
            "start": {
                id: "start",
                title: "Validate the FHIR Resource",
                instruction: "Run the FHIR resource through the R4 validator to check for structural errors, missing required fields, or invalid code system URIs.",
                checkType: "api_fhir",
                outcomes: [
                    { label: "Validation ERRORS found", next: "check-validation-detail", style: "danger" },
                    { label: "Resource is VALID", next: "check-auth", style: "success" }
                ]
            },
            "check-validation-detail": {
                id: "check-validation-detail",
                title: "Analyze Validation Error Details",
                instruction: "Review the specific validation errors. Common issues: missing 'status' field on DiagnosticReport, invalid reference format (should be 'Patient/123' not just '123'), code system URI typos, or required Coding elements missing 'system' property.",
                checkType: null,
                outcomes: [
                    { label: "Missing required FIELD (status, code, etc.)", next: "resolution-fix-field", style: "danger" },
                    { label: "Invalid REFERENCE format", next: "resolution-fix-reference", style: "warning" },
                    { label: "Code system URI or CODING error", next: "resolution-fix-coding", style: "warning" }
                ]
            },
            "resolution-fix-field": {
                id: "resolution-fix-field",
                type: "resolution",
                title: "Add Missing Required Fields",
                instruction: "Required FHIR fields are missing from the resource.",
                resolution: "Update the resource builder to include all required fields. For DiagnosticReport: 'status' (registered|partial|preliminary|final), 'code' (LOINC-coded). For Observation: 'status', 'code'. For ImagingStudy: 'status', 'subject'. Check the FHIR R4 specification for each resource type's required fields."
            },
            "resolution-fix-reference": {
                id: "resolution-fix-reference",
                type: "resolution",
                title: "Fix Resource Reference Format",
                instruction: "Resource references are in an invalid format.",
                resolution: "Update references to use the format 'ResourceType/id' (e.g., 'Patient/12345'). For contained resources, use '#' prefix (e.g., '#patient1'). For absolute references, use the full URL. Ensure all referenced resources exist on the target server before submission."
            },
            "resolution-fix-coding": {
                id: "resolution-fix-coding",
                type: "resolution",
                title: "Fix Code System URIs",
                instruction: "Code system URIs or coding elements are incorrect.",
                resolution: "Correct the code system URIs. Common systems: LOINC = 'http://loinc.org', SNOMED = 'http://snomed.info/sct', ICD-10 = 'http://hl7.org/fhir/sid/icd-10'. Ensure each Coding element has both 'system' and 'code' properties. Validate codes exist in the target system's ValueSets."
            },
            "check-auth": {
                id: "check-auth",
                title: "Check OAuth2 / SMART on FHIR Authentication",
                instruction: "The resource is valid but submission fails. Check the OAuth2 token status. Try a token refresh. Verify the client_id and client_secret are correct for this customer's FHIR server.",
                checkType: null,
                outcomes: [
                    { label: "Token is EXPIRED", next: "check-token-refresh", style: "warning" },
                    { label: "Auth credentials are INVALID (401)", next: "escalate-identity-provider", style: "danger" },
                    { label: "Auth is OK (token valid)", next: "check-server-response", style: "success" }
                ]
            },
            "check-token-refresh": {
                id: "check-token-refresh",
                title: "Attempt Token Refresh",
                instruction: "The OAuth2 access token has expired. Attempt to refresh it using the refresh_token grant. Check if the token endpoint is reachable and the refresh token is still valid.",
                checkType: null,
                outcomes: [
                    { label: "Refresh SUCCEEDED", next: "resolution-token-caching", style: "success" },
                    { label: "Refresh FAILED (refresh token also expired)", next: "check-idp-status", style: "danger" }
                ]
            },
            "resolution-token-caching": {
                id: "resolution-token-caching",
                type: "resolution",
                title: "Fix Token Caching / Auto-Refresh",
                instruction: "The token was expired but could be refreshed. The auto-refresh mechanism is not working.",
                resolution: "Check the token caching implementation. The access token should be refreshed automatically before expiry (typically refresh when >80% of the token's lifetime has elapsed). Fix the token refresh scheduler. If the token lifetime is very short (<5 min), request a longer lifetime from the customer's identity provider."
            },
            "check-idp-status": {
                id: "check-idp-status",
                title: "Check Identity Provider Status",
                instruction: "Token refresh failed. Check if the customer's identity provider (IdP) is operational. Test the token endpoint directly.",
                checkType: null,
                outcomes: [
                    { label: "IdP is under MAINTENANCE", next: "resolution-idp-maintenance", style: "warning" },
                    { label: "IdP returns an ERROR", next: "escalate-identity-provider", style: "danger" }
                ]
            },
            "resolution-idp-maintenance": {
                id: "resolution-idp-maintenance",
                type: "resolution",
                title: "Wait for IdP Maintenance to Complete",
                instruction: "The customer's identity provider is under scheduled or unscheduled maintenance.",
                resolution: "Wait for the IdP to return to service. Queue FHIR submissions during the outage and process them when the IdP is back. Manually refresh the token once the IdP is available. If this is a recurring issue, implement a token pre-caching strategy to maintain a valid token through brief IdP outages."
            },
            "escalate-identity-provider": {
                id: "escalate-identity-provider",
                type: "escalation",
                title: "Escalate to Customer Identity Provider Team",
                instruction: "OAuth2 authentication is failing and cannot be resolved from our side.",
                escalation: "Escalate to the customer's identity/security team. Provide: the client_id being used, the token endpoint URL, the error response received, and timestamps. Common causes: client_secret rotation, scope changes, or the client registration being revoked."
            },
            "check-server-response": {
                id: "check-server-response",
                title: "Analyze FHIR Server Response Code",
                instruction: "Auth is valid and the resource is valid, but the server is returning an error. Check the HTTP response code and the OperationOutcome in the response body.",
                checkType: null,
                outcomes: [
                    { label: "504 Gateway Timeout", next: "resolution-bundle-size", style: "warning" },
                    { label: "422 Unprocessable Entity", next: "resolution-server-validation", style: "danger" },
                    { label: "500 Internal Server Error", next: "escalate-customer-fhir", style: "danger" },
                    { label: "409 Conflict (duplicate)", next: "resolution-conflict", style: "warning" }
                ]
            },
            "resolution-bundle-size": {
                id: "resolution-bundle-size",
                type: "resolution",
                title: "Reduce FHIR Bundle Size",
                instruction: "The FHIR server is timing out processing a large transaction bundle.",
                resolution: "Split the transaction bundle into smaller batches (10-20 entries per bundle instead of 100+). If submitting individual resources also times out, the customer's FHIR server may be under-resourced. Use batch bundles instead of transaction bundles if atomicity is not required."
            },
            "resolution-server-validation": {
                id: "resolution-server-validation",
                type: "resolution",
                title: "Fix Server-Specific Validation Rules",
                instruction: "The customer's FHIR server has validation rules stricter than the base R4 spec.",
                resolution: "Review the OperationOutcome in the 422 response for specific errors. The customer's server may enforce a custom Implementation Guide (IG) profile with additional required fields, specific code ValueSets, or business rules. Update the resource builder to comply with the customer's specific profile requirements."
            },
            "resolution-conflict": {
                id: "resolution-conflict",
                type: "resolution",
                title: "Handle Duplicate Resource Conflict",
                instruction: "The server returned 409 Conflict because a resource with this ID already exists.",
                resolution: "Switch from POST (create) to PUT (update) for resources that may already exist. Implement conditional create using If-None-Exist headers or use a conditional update with If-Match for proper versioning. Add idempotency logic to the submission pipeline."
            },
            "escalate-customer-fhir": {
                id: "escalate-customer-fhir",
                type: "escalation",
                title: "Escalate to Customer FHIR Server Team",
                instruction: "The customer's FHIR server is returning 500 errors, indicating a server-side issue.",
                escalation: "Escalate to the customer's FHIR/IT team. Provide: the request payload (sanitized), response status code and body, timestamps, and the resource type being submitted. A 500 error is a server-side bug that needs their investigation."
            }
        }
    },

    // =========================================================================
    // 7. Duplicate Studies Processed (P2)
    // =========================================================================
    {
        id: "duplicate-studies",
        title: "Duplicate Studies Processed",
        severity: "P2",
        description: "The same study is being processed by the AI engine multiple times, generating duplicate results.",
        estimatedTime: "10-20 min",
        nodes: {
            "start": {
                id: "start",
                title: "Check for Duplicate ORM Orders",
                instruction: "Check the HL7 message log for duplicate ORM^O01 orders with the same accession number. Compare the MSH-10 (Message Control ID) of the duplicate messages to determine if they are exact duplicates or distinct messages for the same study.",
                checkType: "api_hl7",
                apiParams: { message_type: "ORM" },
                outcomes: [
                    { label: "DUPLICATE orders received (same accession)", next: "check-control-ids", style: "danger" },
                    { label: "Only ONE order exists", next: "check-dicom-duplicates", style: "success" }
                ]
            },
            "check-control-ids": {
                id: "check-control-ids",
                title: "Compare Message Control IDs",
                instruction: "Compare the MSH-10 (Message Control ID) values of the duplicate ORM messages. If they are identical, it is an exact message resend. If they are different, the EHR sent separate order messages for the same study.",
                checkType: null,
                outcomes: [
                    { label: "SAME control ID (exact duplicate resend)", next: "resolution-idempotency", style: "warning" },
                    { label: "DIFFERENT control IDs (system resend)", next: "check-ehr-context", style: "danger" }
                ]
            },
            "resolution-idempotency": {
                id: "resolution-idempotency",
                type: "resolution",
                title: "Enable Idempotency Check on MSH-10",
                instruction: "The same HL7 message is being received multiple times (exact duplicate).",
                resolution: "Enable idempotency checking in the interface engine: track MSH-10 (Message Control ID) values and reject duplicates within a configurable window (recommended: 24 hours). The duplicate may be caused by the sender not receiving the ACK and retrying, or by a network-level replay. ACK delivery should also be verified."
            },
            "check-ehr-context": {
                id: "check-ehr-context",
                title: "Check EHR Context for Resend",
                instruction: "The EHR sent multiple distinct orders for the same study. Check if the customer recently performed an EHR upgrade, system maintenance, or order reconciliation that would trigger mass resends.",
                checkType: null,
                outcomes: [
                    { label: "EHR upgrade/maintenance caused resend", next: "resolution-accession-dedup", style: "warning" },
                    { label: "No known EHR event -- duplicate ordering workflow", next: "escalate-customer-workflow", style: "danger" }
                ]
            },
            "resolution-accession-dedup": {
                id: "resolution-accession-dedup",
                type: "resolution",
                title: "Add Accession-Based Deduplication",
                instruction: "The EHR sent new order messages for already-processed studies after a system event.",
                resolution: "Add accession-based deduplication in the AI engine: if a study with the same accession number has already been processed within the configurable window (recommended: 7 days), skip re-processing. Log the duplicate for audit. Also set up a filter to detect mass resend events (>100 orders in <1 hour from one facility) and alert before processing."
            },
            "escalate-customer-workflow": {
                id: "escalate-customer-workflow",
                type: "escalation",
                title: "Escalate to Customer (Duplicate Ordering Workflow)",
                instruction: "The customer's ordering workflow is generating duplicate orders for the same study without a system event context.",
                escalation: "Escalate to the customer's radiology/IT team. Provide: accession numbers with duplicate orders, timestamps, and the ordering physician. The duplicate may be a workflow issue (e.g., order entered in both RIS and PACS, or an add-on order that should update rather than create). Request they review their ordering workflow."
            },
            "check-dicom-duplicates": {
                id: "check-dicom-duplicates",
                title: "Check for Duplicate DICOM Submissions",
                instruction: "Only one HL7 order exists, so the duplication is at the DICOM level. Check the DICOM receive log for duplicate series. Compare SOP Instance UIDs to determine if the same images were sent twice, or if a different series was sent for the same study.",
                checkType: "api_dicom",
                apiParams: { filename: "chest_xray.dcm", tag_group: "all" },
                outcomes: [
                    { label: "SAME SOP Instance UIDs (exact image resend)", next: "resolution-sop-dedup", style: "warning" },
                    { label: "DIFFERENT SOP UIDs but same study (new series)", next: "check-worklist-query", style: "danger" }
                ]
            },
            "resolution-sop-dedup": {
                id: "resolution-sop-dedup",
                type: "resolution",
                title: "Enable SOP Instance UID Deduplication",
                instruction: "The exact same DICOM images (same SOP Instance UIDs) were received multiple times.",
                resolution: "Enable SOP Instance UID deduplication at the DICOM receiver level: if an image with the same SOP Instance UID has already been stored, skip it. This is standard DICOM behavior per the storage commitment SOP class. The PACS may be retrying sends due to missed C-STORE-RSP acknowledgments."
            },
            "check-worklist-query": {
                id: "check-worklist-query",
                title: "Check Worklist Query and Series Selection",
                instruction: "Different series from the same study are triggering separate AI processing runs. Check if the AI engine's worklist query is correctly grouping all series within a study, or if each new series triggers a new processing job.",
                checkType: null,
                outcomes: [
                    { label: "Each series triggers SEPARATE processing", next: "resolution-study-grouping", style: "danger" },
                    { label: "Study grouping is correct but series keeps arriving", next: "resolution-series-complete-timer", style: "warning" }
                ]
            },
            "resolution-study-grouping": {
                id: "resolution-study-grouping",
                type: "resolution",
                title: "Fix Study Grouping Logic",
                instruction: "The AI engine is treating each series as a separate study to process.",
                resolution: "Update the AI engine's study grouping logic to wait for all series within a study (same Study Instance UID) before triggering processing. Implement a study completeness check based on the expected number of series (from the ORM order) or a configurable wait timer after the last image is received."
            },
            "resolution-series-complete-timer": {
                id: "resolution-series-complete-timer",
                type: "resolution",
                title: "Adjust Series Completion Timer",
                instruction: "New series keep arriving for the same study, re-triggering processing.",
                resolution: "Increase the study completion timer from the default (typically 5 minutes) to 15-30 minutes to allow all series to arrive before triggering AI processing. For multi-series CT studies, the technologist may acquire additional series after an initial delay. Add a re-processing suppression window to prevent duplicate AI runs within a configurable period."
            }
        }
    },

    // =========================================================================
    // 8. Teleradiology Workflow Disruption (P1)
    // =========================================================================
    {
        id: "teleradiology-workflow",
        title: "Teleradiology Workflow Disruption",
        severity: "P1",
        description: "The teleradiology reading workflow is disrupted -- studies or AI results are not reaching the reading radiologist.",
        estimatedTime: "10-30 min",
        nodes: {
            "start": {
                id: "start",
                title: "Identify Which Workflow Step is Broken",
                instruction: "Ask the reading radiologist or teleradiology coordinator what specific problem they are experiencing. Determine which step of the workflow is failing.",
                checkType: null,
                outcomes: [
                    { label: "Radiologist CANNOT SEE the study in worklist", next: "check-dicom-routing-worklist", style: "danger" },
                    { label: "Radiologist sees study but NO AI overlay/results", next: "check-ai-processed", style: "warning" },
                    { label: "Radiologist CANNOT SUBMIT report", next: "check-reporting-system", style: "danger" }
                ]
            },
            "check-dicom-routing-worklist": {
                id: "check-dicom-routing-worklist",
                title: "Check DICOM Routing to Reading Worklist",
                instruction: "Verify that the study was routed to the teleradiology reading PACS. Check the DICOM routing rules for this customer and confirm the study was sent to the correct destination AE Title.",
                checkType: null,
                outcomes: [
                    { label: "Study was NOT routed to reading PACS", next: "resolution-telerad-routing", style: "danger" },
                    { label: "Study WAS sent to reading PACS", next: "check-worklist-filters", style: "success" }
                ]
            },
            "resolution-telerad-routing": {
                id: "resolution-telerad-routing",
                type: "resolution",
                title: "Fix Teleradiology DICOM Routing",
                instruction: "The study was not routed to the teleradiology reading PACS.",
                resolution: "Add or fix the DICOM routing rule to forward studies to the teleradiology PACS destination. Check if the routing rule has a modality or time-of-day filter that excluded this study. For after-hours teleradiology, ensure the time-based routing schedule is correct for the customer's timezone. Re-send the study after fixing the route."
            },
            "check-worklist-filters": {
                id: "check-worklist-filters",
                title: "Check Reading Worklist Query Filters",
                instruction: "The study was sent to the reading PACS. Check if the radiologist's worklist query filters are excluding this study. Common filters: modality, referring physician, exam priority, study status.",
                checkType: null,
                outcomes: [
                    { label: "Worklist filter is EXCLUDING this study type", next: "resolution-worklist-filter", style: "danger" },
                    { label: "Worklist filters are correct", next: "escalate-telerad-pacs", style: "warning" }
                ]
            },
            "resolution-worklist-filter": {
                id: "resolution-worklist-filter",
                type: "resolution",
                title: "Update Reading Worklist Filter",
                instruction: "The radiologist's worklist query is filtering out this study type.",
                resolution: "Update the worklist query parameters on the reading PACS to include the missing modality, priority level, or study status. If the filter is per-radiologist, update the specific radiologist's worklist preferences. Verify the study appears in the worklist after the change."
            },
            "escalate-telerad-pacs": {
                id: "escalate-telerad-pacs",
                type: "escalation",
                title: "Escalate to Teleradiology PACS Admin",
                instruction: "The study was routed correctly and worklist filters appear correct, but the study is not visible.",
                escalation: "Escalate to the teleradiology PACS administrator. Provide: Study Instance UID, patient MRN, accession number, DICOM send confirmation (association log), and the expected worklist location. The PACS may have an internal indexing issue or the study may be in a quarantine queue."
            },
            "check-ai-processed": {
                id: "check-ai-processed",
                title: "Check if AI Processed This Study",
                instruction: "The radiologist can see the study but not the AI results. Check if the AI engine received and processed this study. Look up the Study Instance UID in the AI processing log.",
                checkType: null,
                outcomes: [
                    { label: "AI has NOT processed this study", next: "redirect-study-not-reaching", style: "danger" },
                    { label: "AI PROCESSED the study", next: "check-ai-delivery", style: "success" }
                ]
            },
            "redirect-study-not-reaching": {
                id: "redirect-study-not-reaching",
                type: "escalation",
                title: "Redirect: Study Not Reaching AI Engine",
                instruction: "The AI engine never received or processed this study.",
                escalation: "Switch to the 'Study Not Reaching AI Engine' runbook to diagnose why the study did not reach the AI engine. Once the AI pipeline is fixed, verify the study is processed and results are delivered to the reading PACS."
            },
            "check-ai-delivery": {
                id: "check-ai-delivery",
                title: "Check AI Result Delivery to Reading PACS",
                instruction: "The AI processed the study. Check if the AI results (SR or GSPS overlay) were delivered to the teleradiology reading PACS, not just the customer's primary PACS.",
                checkType: null,
                outcomes: [
                    { label: "Results sent to CUSTOMER PACS only, not reading PACS", next: "resolution-dual-delivery", style: "danger" },
                    { label: "Results WERE sent to reading PACS", next: "redirect-results-not-appearing", style: "warning" }
                ]
            },
            "resolution-dual-delivery": {
                id: "resolution-dual-delivery",
                type: "resolution",
                title: "Configure Dual Delivery for AI Results",
                instruction: "AI results are only being sent to the customer's primary PACS, not the teleradiology reading PACS.",
                resolution: "Add the teleradiology reading PACS as an additional outbound destination for AI results. Update the DICOM routing rules to send the SR/GSPS to both the customer's primary PACS and the teleradiology PACS. Ensure the AE title and port for the reading PACS are correct. Re-send the AI results to the reading PACS."
            },
            "redirect-results-not-appearing": {
                id: "redirect-results-not-appearing",
                type: "escalation",
                title: "Redirect: AI Results Not Appearing in PACS",
                instruction: "The AI results were sent to the reading PACS but are not visible to the radiologist.",
                escalation: "Switch to the 'AI Results Not Appearing in PACS' runbook. The issue is likely related to Series Description filtering, SOP Class support, or study UID linkage on the reading PACS."
            },
            "check-reporting-system": {
                id: "check-reporting-system",
                title: "Check Reporting System Connectivity",
                instruction: "The radiologist can see the study and AI results but cannot submit their report. Check if the reporting system (dictation, voice recognition, report editor) is accessible and connected to the reading PACS.",
                checkType: null,
                outcomes: [
                    { label: "Reporting system is DOWN", next: "escalate-reporting-vendor", style: "danger" },
                    { label: "Reporting system is UP", next: "check-user-permissions", style: "success" }
                ]
            },
            "escalate-reporting-vendor": {
                id: "escalate-reporting-vendor",
                type: "escalation",
                title: "Escalate to Reporting System Vendor",
                instruction: "The reporting/dictation system is down or unresponsive.",
                escalation: "Escalate to the reporting system vendor (e.g., Nuance PowerScribe, mModal). Check their status page for known outages. In the interim, the radiologist may need to use a backup reporting method (manual text entry, phone dictation, or paper report). Ensure critical findings are communicated directly to the ordering physician if reporting is delayed."
            },
            "check-user-permissions": {
                id: "check-user-permissions",
                title: "Check Radiologist Permissions",
                instruction: "The reporting system is up. Check if the radiologist has the correct permissions to report on this study type. Some systems restrict reporting by modality, body part, or subspecialty.",
                checkType: null,
                outcomes: [
                    { label: "Permission issue found", next: "resolution-permissions", style: "danger" },
                    { label: "Permissions are correct", next: "escalate-reporting-vendor", style: "warning" }
                ]
            },
            "resolution-permissions": {
                id: "resolution-permissions",
                type: "resolution",
                title: "Fix Radiologist Reporting Permissions",
                instruction: "The radiologist does not have permission to report on this study type.",
                resolution: "Update the radiologist's reporting permissions in the teleradiology system. If this is a credentialing issue (radiologist not credentialed for this modality at this site), route the study to an appropriately credentialed radiologist instead. Update the worklist assignment rules to prevent future misrouting."
            }
        }
    },

    // =========================================================================
    // 9. Customer Onboarding Validation (P3)
    // =========================================================================
    {
        id: "customer-onboarding",
        title: "Customer Onboarding Validation",
        severity: "P3",
        description: "Systematic validation of all integration channels for a new customer before go-live.",
        estimatedTime: "30-60 min",
        nodes: {
            "start": {
                id: "start",
                title: "Validate HL7 Connectivity",
                instruction: "Send a test ORM^O01 order message from the customer's EHR to our interface engine. Verify the message is received and parsed successfully. Check MSH-4 facility code, PID demographics, and OBR accession/procedure code.",
                checkType: "api_hl7",
                apiParams: { message_type: "ORM" },
                outcomes: [
                    { label: "HL7 message NOT received", next: "fix-hl7-network", style: "danger" },
                    { label: "HL7 received but PARSE ERRORS", next: "fix-hl7-format", style: "warning" },
                    { label: "HL7 received and parsed SUCCESSFULLY", next: "check-hl7-demographics", style: "success" }
                ]
            },
            "fix-hl7-network": {
                id: "fix-hl7-network",
                title: "Fix HL7 Network Connectivity",
                instruction: "The HL7 message was not received. Check: (1) VPN tunnel is established, (2) TCP port (typically 2575) is open in both firewalls, (3) MLLP listener is running, (4) Correct IP and port configured on the customer's sending interface.",
                checkType: null,
                outcomes: [
                    { label: "Network issue FIXED, message now received", next: "check-hl7-demographics", style: "success" },
                    { label: "Cannot establish connectivity", next: "escalate-onboarding-network", style: "danger" }
                ]
            },
            "escalate-onboarding-network": {
                id: "escalate-onboarding-network",
                type: "escalation",
                title: "Escalate Network Connectivity to Infrastructure",
                instruction: "Cannot establish HL7 TCP connectivity between the customer and our platform.",
                escalation: "Escalate to the infrastructure/network team. Provide: customer site IP range, target IP and port, VPN configuration details, and results of connectivity tests. The customer's IT team may also need to be involved for firewall changes on their side."
            },
            "fix-hl7-format": {
                id: "fix-hl7-format",
                title: "Fix HL7 Message Format",
                instruction: "The message was received but could not be parsed. Check for non-standard delimiters, encoding issues, missing required segments, or incorrect HL7 version.",
                checkType: null,
                outcomes: [
                    { label: "Format issues FIXED with interface transform", next: "check-hl7-demographics", style: "success" },
                    { label: "Customer needs to modify their HL7 output", next: "resolution-hl7-requirements", style: "warning" }
                ]
            },
            "resolution-hl7-requirements": {
                id: "resolution-hl7-requirements",
                type: "resolution",
                title: "Send HL7 Requirements to Customer",
                instruction: "The customer's HL7 output requires modification beyond what interface transforms can handle.",
                resolution: "Send the customer the HL7 Integration Requirements document specifying: required HL7 version (2.5.1), required segments (MSH, PID, PV1, ORC, OBR), required fields per segment, and expected encoding characters. Schedule a follow-up test in 1-2 weeks after they make changes."
            },
            "check-hl7-demographics": {
                id: "check-hl7-demographics",
                title: "Validate HL7 Demographics Mapping",
                instruction: "HL7 message is received and parses. Now validate that the demographic fields map correctly: MRN (PID-3), patient name (PID-5 in Last^First format), DOB (PID-7 as YYYYMMDD), sex (PID-8).",
                checkType: null,
                outcomes: [
                    { label: "Demographics mapping is CORRECT", next: "validate-dicom-connectivity", style: "success" },
                    { label: "Demographics mapping needs ADJUSTMENT", next: "resolution-hl7-mapping", style: "warning" }
                ]
            },
            "resolution-hl7-mapping": {
                id: "resolution-hl7-mapping",
                type: "resolution",
                title: "Fix HL7 Demographics Mapping",
                instruction: "Demographics fields are present but not in the expected format or position.",
                resolution: "Add interface transforms to normalize demographics: map non-standard PID field positions, convert name format to Last^First, normalize DOB to YYYYMMDD, map sex codes to M/F/O. After fixing, re-run the test message. Then proceed to DICOM validation."
            },
            "validate-dicom-connectivity": {
                id: "validate-dicom-connectivity",
                title: "Validate DICOM Connectivity",
                instruction: "Send a test DICOM C-ECHO from the customer's PACS to our DICOM listener. Then send a test study (at least one image). Verify the image is received with correct tags.",
                checkType: "api_dicom",
                apiParams: { filename: "chest_xray.dcm", tag_group: "routing" },
                outcomes: [
                    { label: "C-ECHO fails (no DICOM connectivity)", next: "fix-dicom-network", style: "danger" },
                    { label: "C-ECHO succeeds but test image has WRONG tags", next: "resolution-dicom-tags", style: "warning" },
                    { label: "C-ECHO and test image both SUCCEED", next: "check-fhir-applicable", style: "success" }
                ]
            },
            "fix-dicom-network": {
                id: "fix-dicom-network",
                title: "Fix DICOM Network Connectivity",
                instruction: "DICOM C-ECHO failed. Check: (1) DICOM port (typically 11112) is open, (2) Called AE Title matches our listener config, (3) Customer's Calling AE Title is in our allowed list, (4) TLS configuration matches if applicable.",
                checkType: null,
                outcomes: [
                    { label: "Connectivity FIXED", next: "check-fhir-applicable", style: "success" },
                    { label: "Cannot establish DICOM connectivity", next: "escalate-onboarding-network", style: "danger" }
                ]
            },
            "resolution-dicom-tags": {
                id: "resolution-dicom-tags",
                type: "resolution",
                title: "Fix DICOM Tag Issues",
                instruction: "Test images have incorrect or missing DICOM tags.",
                resolution: "Work with the customer's PACS admin to fix the DICOM tag issues. Common problems: wrong AE title in the association, missing InstitutionName, incorrect modality code. If the modality is not populating demographics from Modality Worklist, configure MWL queries. After fixes, re-send the test image and verify tags."
            },
            "check-fhir-applicable": {
                id: "check-fhir-applicable",
                title: "Check if FHIR Integration is Required",
                instruction: "Does this customer require FHIR connectivity? Check the onboarding specification for FHIR API requirements (DiagnosticReport delivery, ImagingStudy notifications, etc.).",
                checkType: null,
                outcomes: [
                    { label: "FHIR integration IS required", next: "validate-fhir", style: "warning" },
                    { label: "FHIR is NOT required (HL7 + DICOM only)", next: "run-e2e-test", style: "success" }
                ]
            },
            "validate-fhir": {
                id: "validate-fhir",
                title: "Validate FHIR Connectivity",
                instruction: "Test the FHIR integration: authenticate with the customer's FHIR server (OAuth2), submit a test DiagnosticReport resource, and verify it is accepted.",
                checkType: "api_fhir",
                outcomes: [
                    { label: "FHIR submission ACCEPTED", next: "run-e2e-test", style: "success" },
                    { label: "FHIR submission REJECTED", next: "resolution-fhir-profile", style: "danger" }
                ]
            },
            "resolution-fhir-profile": {
                id: "resolution-fhir-profile",
                type: "resolution",
                title: "Fix FHIR Resource Format for Customer Profile",
                instruction: "The customer's FHIR server rejected the test submission.",
                resolution: "Review the OperationOutcome error details. The customer's FHIR server likely enforces a custom Implementation Guide (IG) or profile. Obtain the customer's FHIR profile documentation and update the resource builder to comply. Common issues: required extensions, specific ValueSet bindings, or custom search parameters. After fixing, re-submit and proceed to E2E testing."
            },
            "run-e2e-test": {
                id: "run-e2e-test",
                title: "Run End-to-End Integration Test",
                instruction: "Send a complete test workflow: (1) HL7 ORM order, (2) DICOM test images, (3) Wait for AI processing, (4) Verify AI results are delivered back in all configured formats (DICOM SR, HL7 ORU, FHIR DiagnosticReport).",
                checkType: null,
                outcomes: [
                    { label: "All delivery channels PASS", next: "resolution-onboarding-complete", style: "success" },
                    { label: "HL7 ORU delivery FAILS", next: "resolution-oru-delivery", style: "danger" },
                    { label: "DICOM SR delivery FAILS", next: "resolution-sr-delivery", style: "danger" },
                    { label: "AI did not process the study", next: "resolution-e2e-ai-issue", style: "danger" }
                ]
            },
            "resolution-onboarding-complete": {
                id: "resolution-onboarding-complete",
                type: "resolution",
                title: "Onboarding Validation Complete",
                instruction: "All integration channels are working correctly.",
                resolution: "All tests passed. Document the validated configuration (AE titles, ports, facility codes, demographics mapping, FHIR profile) in the config registry. Schedule the go-live date with the customer. Set up monitoring alerts for all channels. Brief the support team on any customer-specific configurations or known quirks."
            },
            "resolution-oru-delivery": {
                id: "resolution-oru-delivery",
                type: "resolution",
                title: "Fix ORU Result Delivery",
                instruction: "The HL7 ORU result delivery failed during E2E testing.",
                resolution: "Check the outbound HL7 interface configuration: destination IP/port, MLLP settings, and facility codes. The customer's receiving system may require specific MSH fields. Run the HL7 Interface Errors runbook if the message is being NAKed. Re-test after fixing."
            },
            "resolution-sr-delivery": {
                id: "resolution-sr-delivery",
                type: "resolution",
                title: "Fix DICOM SR Delivery",
                instruction: "The DICOM SR result delivery failed during E2E testing.",
                resolution: "Check the outbound DICOM routing configuration: destination AE title, IP, port. Verify with C-ECHO. If C-STORE fails, check if the customer's PACS accepts SR SOP Class (1.2.840.10008.5.1.4.1.1.88.33). Run the AI Results Not Appearing in PACS runbook for detailed diagnosis."
            },
            "resolution-e2e-ai-issue": {
                id: "resolution-e2e-ai-issue",
                type: "resolution",
                title: "Fix AI Processing for E2E Test",
                instruction: "The AI engine did not process the test study.",
                resolution: "Run the 'Study Not Reaching AI Engine' runbook to identify why the AI did not process the study. Common issues during onboarding: modality not in supported list, missing order, or demographics mismatch preventing order-image pairing. Fix and re-run the E2E test."
            }
        }
    },

    // =========================================================================
    // 10. Performance Degradation (P3)
    // =========================================================================
    {
        id: "performance-degradation",
        title: "Performance Degradation",
        severity: "P3",
        description: "Integration channel throughput is degraded -- messages or images are processing slower than expected.",
        estimatedTime: "15-30 min",
        nodes: {
            "start": {
                id: "start",
                title: "Identify Which Channel is Slow",
                instruction: "Check the SLO dashboard to identify which integration channel(s) are experiencing performance degradation. Compare current throughput/latency against the SLO targets.",
                checkType: null,
                outcomes: [
                    { label: "HL7 message processing is SLOW", next: "check-hl7-queue", style: "warning" },
                    { label: "DICOM transfer is SLOW", next: "check-dicom-modality", style: "warning" },
                    { label: "FHIR API responses are SLOW", next: "check-fhir-response-times", style: "warning" },
                    { label: "ALL channels are degraded", next: "check-system-resources", style: "danger" }
                ]
            },
            "check-hl7-queue": {
                id: "check-hl7-queue",
                title: "Check HL7 Message Queue Depth",
                instruction: "Check the interface engine message queue. A growing queue indicates messages are arriving faster than they can be processed. Normal queue depth should be <100 messages.",
                checkType: null,
                outcomes: [
                    { label: "Queue is BACKING UP (>1000 messages)", next: "check-processing-rate", style: "danger" },
                    { label: "Queue depth is NORMAL (<100)", next: "check-hl7-latency", style: "success" }
                ]
            },
            "check-processing-rate": {
                id: "check-processing-rate",
                title: "Check Message Processing Rate",
                instruction: "Measure the current processing rate (messages/second) and compare to the expected rate. Check if a specific message type or customer is causing the slowdown. Look for messages that take unusually long to process.",
                checkType: null,
                outcomes: [
                    { label: "Specific customer/message type is SLOW", next: "resolution-slow-consumer", style: "warning" },
                    { label: "Overall processing rate is LOW", next: "resolution-scale-workers", style: "danger" }
                ]
            },
            "resolution-slow-consumer": {
                id: "resolution-slow-consumer",
                type: "resolution",
                title: "Fix Slow Message Consumer",
                instruction: "A specific customer or message type is processing slowly, blocking the queue.",
                resolution: "Identify the slow consumer: check if a downstream system is slow to ACK, if a complex transform is CPU-intensive, or if a message is triggering excessive database lookups. Options: (1) move the slow customer to a dedicated queue, (2) optimize the transform, (3) add a timeout to the downstream ACK wait. If the downstream system is slow, increase the ACK timeout but add the customer to a separate queue to avoid blocking others."
            },
            "resolution-scale-workers": {
                id: "resolution-scale-workers",
                type: "resolution",
                title: "Scale Message Processing Workers",
                instruction: "The overall HL7 processing rate is too low for the current message volume.",
                resolution: "Scale up the message processing workers: increase the number of parallel consumers, add more interface engine instances, or optimize the processing pipeline. Check if the bottleneck is CPU (transform processing), I/O (database writes), or network (downstream delivery). Scale the specific bottleneck resource."
            },
            "check-hl7-latency": {
                id: "check-hl7-latency",
                title: "Check Per-Message Processing Latency",
                instruction: "Queue depth is normal but individual messages are slow. Check the per-message processing time. Look for DNS resolution delays, slow database queries, or high-latency downstream systems.",
                checkType: null,
                outcomes: [
                    { label: "High latency to DOWNSTREAM system", next: "resolution-hl7-downstream-latency", style: "warning" },
                    { label: "High latency in TRANSFORM processing", next: "resolution-optimize-transform", style: "warning" }
                ]
            },
            "resolution-hl7-downstream-latency": {
                id: "resolution-hl7-downstream-latency",
                type: "resolution",
                title: "Address Downstream System Latency",
                instruction: "The downstream system (EHR, PACS, AI engine) is slow to respond to HL7 deliveries.",
                resolution: "Check the downstream system's health and response times. If the downstream system is temporarily slow (maintenance, high load), enable message queuing with retry. If chronically slow, implement asynchronous delivery (send, queue ACK, move to next message) instead of waiting for synchronous ACK on each message."
            },
            "resolution-optimize-transform": {
                id: "resolution-optimize-transform",
                type: "resolution",
                title: "Optimize HL7 Transform Pipeline",
                instruction: "Message transforms (field mapping, validation, enrichment) are taking too long.",
                resolution: "Profile the transform pipeline to identify slow steps. Common optimizations: cache lookup tables (facility codes, procedure maps) instead of querying per-message, reduce regex complexity, remove unnecessary validation steps for high-volume message types, and batch database writes instead of per-message writes."
            },
            "check-dicom-modality": {
                id: "check-dicom-modality",
                title: "Check if Specific Modality is Slow",
                instruction: "Determine if the DICOM slowdown is specific to a modality type. CT and MR studies are naturally larger and slower to transfer than CR/DX. Check transfer times by modality.",
                checkType: null,
                outcomes: [
                    { label: "Only LARGE series are slow (CT >500 images)", next: "check-bandwidth", style: "warning" },
                    { label: "ALL modalities are slow, including small studies", next: "check-storage-io", style: "danger" }
                ]
            },
            "check-bandwidth": {
                id: "check-bandwidth",
                title: "Check Network Bandwidth Utilization",
                instruction: "Check the network bandwidth between the customer and our DICOM receiver. Large CT series can saturate the link, especially if multiple customers share the same ingestion point.",
                checkType: null,
                outcomes: [
                    { label: "Bandwidth is SATURATED during peak hours", next: "resolution-dicom-optimize", style: "warning" },
                    { label: "Bandwidth is adequate", next: "resolution-dicom-timeout", style: "success" }
                ]
            },
            "resolution-dicom-optimize": {
                id: "resolution-dicom-optimize",
                type: "resolution",
                title: "Optimize DICOM Transfer",
                instruction: "Network bandwidth is saturated during peak imaging hours.",
                resolution: "Options: (1) Enable DICOM transfer syntax negotiation to use compressed syntaxes (JPEG Lossless 1.2.840.10008.1.2.4.70 reduces payload by ~30%), (2) Implement QoS rules to prioritize DICOM traffic, (3) Schedule large batch transfers to off-peak hours, (4) Increase bandwidth allocation. For multi-frame CT, consider enabling JPEG2000 lossless compression."
            },
            "resolution-dicom-timeout": {
                id: "resolution-dicom-timeout",
                type: "resolution",
                title: "Increase DICOM Transfer Timeout",
                instruction: "Bandwidth is adequate but large transfers are timing out.",
                resolution: "Increase the DIMSE association timeout and ARTIM timer. For very large series, increase from the default 30-60s to 300s. Also check if the PACS is sending images one-at-a-time (sequential C-STORE) vs batched; sequential sends are inherently slower but some PACS systems only support this mode."
            },
            "check-storage-io": {
                id: "check-storage-io",
                title: "Check Storage I/O Performance",
                instruction: "All modalities are slow, suggesting a system-level bottleneck. Check the storage I/O metrics: disk utilization, IOPS, read/write latency. DICOM storage is I/O intensive.",
                checkType: null,
                outcomes: [
                    { label: "Storage I/O is SATURATED (>90% utilization)", next: "escalate-infrastructure", style: "danger" },
                    { label: "Storage I/O is normal", next: "check-system-resources", style: "warning" }
                ]
            },
            "check-fhir-response-times": {
                id: "check-fhir-response-times",
                title: "Analyze FHIR API Response Times",
                instruction: "Check the FHIR API response times. Distinguish between: (1) our outbound requests to the customer's FHIR server, (2) the customer's inbound requests to our FHIR API.",
                checkType: null,
                outcomes: [
                    { label: "Customer's FHIR server is SLOW", next: "check-fhir-bundle-size", style: "warning" },
                    { label: "Our FHIR API is SLOW", next: "check-fhir-auth-overhead", style: "warning" }
                ]
            },
            "check-fhir-bundle-size": {
                id: "check-fhir-bundle-size",
                title: "Check FHIR Bundle Size",
                instruction: "Large transaction bundles can cause slow responses. Check the average bundle size being submitted to the customer's FHIR server.",
                checkType: null,
                outcomes: [
                    { label: "Bundle sizes are LARGE (>50 entries)", next: "resolution-fhir-batch-size", style: "warning" },
                    { label: "Bundle sizes are small, server is just slow", next: "escalate-customer-fhir-perf", style: "danger" }
                ]
            },
            "resolution-fhir-batch-size": {
                id: "resolution-fhir-batch-size",
                type: "resolution",
                title: "Reduce FHIR Batch Size",
                instruction: "Large FHIR bundles are causing slow processing on the customer's server.",
                resolution: "Reduce the bundle size to 10-20 entries per batch. Use batch bundles instead of transaction bundles if atomicity is not required (batch processing allows partial success). Implement exponential backoff on retries. Consider switching to individual resource submissions for time-sensitive resources (DiagnosticReport) while batching less urgent resources (AuditEvent)."
            },
            "escalate-customer-fhir-perf": {
                id: "escalate-customer-fhir-perf",
                type: "escalation",
                title: "Escalate FHIR Performance to Customer",
                instruction: "The customer's FHIR server is slow regardless of request size.",
                escalation: "Notify the customer's IT team about FHIR server performance degradation. Provide: average response times, comparison to historical baselines, and specific endpoints affected. They may need to scale their FHIR server resources or investigate internal performance issues."
            },
            "check-fhir-auth-overhead": {
                id: "check-fhir-auth-overhead",
                title: "Check FHIR Authentication Overhead",
                instruction: "Our outbound FHIR responses are slow. Check if the authentication (OAuth2 token validation, SMART scopes) is adding overhead. Specifically, check if tokens are being cached or re-validated on every request.",
                checkType: null,
                outcomes: [
                    { label: "Token validation on EVERY request (no caching)", next: "resolution-token-cache", style: "warning" },
                    { label: "Auth overhead is minimal", next: "escalate-infrastructure", style: "danger" }
                ]
            },
            "resolution-token-cache": {
                id: "resolution-token-cache",
                type: "resolution",
                title: "Enable Token Caching",
                instruction: "OAuth2 tokens are being re-validated on every FHIR request, adding latency.",
                resolution: "Implement token caching: cache validated tokens in memory with a TTL equal to the token's expiry minus a safety margin (e.g., cache for token_lifetime - 60s). Use JWT local validation (verify signature + claims) instead of introspection endpoint calls when possible. This can reduce per-request auth overhead from 100-500ms to <1ms."
            },
            "check-system-resources": {
                id: "check-system-resources",
                title: "Check System Resource Utilization",
                instruction: "All channels are degraded, suggesting a system-level issue. Check CPU utilization, memory usage, and network I/O across all integration platform nodes.",
                checkType: null,
                outcomes: [
                    { label: "CPU or memory SPIKE detected", next: "escalate-infrastructure", style: "danger" },
                    { label: "Resources look NORMAL", next: "escalate-platform-performance", style: "warning" }
                ]
            },
            "escalate-infrastructure": {
                id: "escalate-infrastructure",
                type: "escalation",
                title: "Escalate to Infrastructure / Platform Team",
                instruction: "System-level resource constraints are causing performance degradation across all channels.",
                escalation: "Escalate to the infrastructure/platform team. Provide: CPU/memory/I/O metrics, affected time range, number of affected customers, and which channels are degraded. This may require scaling infrastructure (more nodes, larger instances, faster storage) or investigating a resource leak (memory leak, connection pool exhaustion)."
            },
            "escalate-platform-performance": {
                id: "escalate-platform-performance",
                type: "escalation",
                title: "Escalate Platform Performance Investigation",
                instruction: "All channels are slow but system resources appear normal. This suggests an application-level performance issue.",
                escalation: "Escalate to the platform team for application-level performance investigation. Provide: latency metrics per channel, queue depths, and confirmation that infrastructure resources are not the bottleneck. Possible causes: database connection pool exhaustion, lock contention, garbage collection pauses, or a recent deployment introducing a performance regression."
            }
        }
    }
];

// =============================================================================
// Global State
// =============================================================================

let samplesCache = null;
let activeRunbookId = null;
let treeState = {}; // { runbookId: { visitedNodes: ["start", ...], selectedOutcomes: { nodeId: outcomeIndex }, resolved: false } }

document.addEventListener("DOMContentLoaded", () => {
    renderRunbookCards();
    loadSamples();
});

async function loadSamples() {
    try {
        const resp = await fetch("/api/diagnostics/samples");
        samplesCache = await resp.json();
    } catch (e) {
        console.warn("Could not load diagnostic samples:", e);
    }
}

// =============================================================================
// Runbook Card Grid
// =============================================================================

function renderRunbookCards() {
    const container = document.getElementById("runbook-cards");
    container.innerHTML = RUNBOOKS.map(rb => `
        <div class="runbook-card severity-${rb.severity.toLowerCase()} ${activeRunbookId === rb.id ? 'active' : ''}"
             data-runbook-id="${rb.id}"
             onclick="selectRunbook('${rb.id}')">
            <div class="card-title">${rb.title}</div>
            <div class="card-desc">${rb.description}</div>
            <div class="card-meta">
                <span class="severity-badge severity-${rb.severity.toLowerCase()}">${rb.severity}</span>
                <span class="time-badge">${rb.estimatedTime}</span>
            </div>
        </div>
    `).join("");
}

// =============================================================================
// Runbook Selection and State Management
// =============================================================================

function selectRunbook(id) {
    activeRunbookId = id;
    const runbook = RUNBOOKS.find(rb => rb.id === id);
    if (!runbook) return;

    // Initialize state if not already done
    if (!treeState[id]) {
        treeState[id] = {
            visitedNodes: ["start"],
            selectedOutcomes: {},
            resolved: false
        };
    }

    // Update card active states
    document.querySelectorAll(".runbook-card").forEach(card => {
        card.classList.toggle("active", card.dataset.runbookId === id);
    });

    renderTree(runbook);
}

function resetRunbook() {
    if (!activeRunbookId) return;
    treeState[activeRunbookId] = {
        visitedNodes: ["start"],
        selectedOutcomes: {},
        resolved: false
    };
    const runbook = RUNBOOKS.find(rb => rb.id === activeRunbookId);
    if (runbook) renderTree(runbook);
}

// =============================================================================
// Tree Rendering
// =============================================================================

function renderTree(runbook) {
    const workspace = document.getElementById("runbook-workspace");
    const state = treeState[runbook.id];
    const visitedNodes = state.visitedNodes;
    const selectedOutcomes = state.selectedOutcomes;

    // Calculate progress
    const currentPath = visitedNodes.length;
    const lastNode = runbook.nodes[visitedNodes[visitedNodes.length - 1]];
    const isTerminal = lastNode && (lastNode.type === "resolution" || lastNode.type === "escalation");
    const progressText = isTerminal ? "Complete" : `Step ${currentPath}`;

    let html = "";

    // Title bar
    html += `
        <div class="runbook-title-bar">
            <div class="title-info">
                <h2>${runbook.title}</h2>
                <span class="severity-badge severity-${runbook.severity.toLowerCase()}">${runbook.severity}</span>
                <span class="time-badge">${runbook.estimatedTime}</span>
            </div>
            <button class="reset-btn" onclick="resetRunbook()">Reset</button>
        </div>
    `;

    // Progress bar
    const maxDepth = estimateMaxDepth(runbook);
    const progressPct = isTerminal ? 100 : Math.min(95, Math.round((currentPath / maxDepth) * 100));
    html += `
        <div class="progress-bar">
            <div class="progress-track">
                <div class="progress-fill" style="width:${progressPct}%"></div>
            </div>
            <span class="progress-text">${progressText}</span>
        </div>
    `;

    // Tree container
    html += `<div class="tree-container">`;

    for (let i = 0; i < visitedNodes.length; i++) {
        const nodeId = visitedNodes[i];
        const node = runbook.nodes[nodeId];
        if (!node) continue;

        const isLast = i === visitedNodes.length - 1;
        const isActive = isLast && !isTerminal;
        const isCompleted = !isLast;
        const isResolution = node.type === "resolution";
        const isEscalation = node.type === "escalation";

        // Connector line (not before first node)
        if (i > 0) {
            const prevNodeId = visitedNodes[i - 1];
            const outcomeIdx = selectedOutcomes[prevNodeId];
            const prevNode = runbook.nodes[prevNodeId];
            let branchLabel = "";
            if (prevNode && prevNode.outcomes && outcomeIdx !== undefined) {
                branchLabel = prevNode.outcomes[outcomeIdx].label;
            }

            html += `<div class="tree-connector active"></div>`;
            if (branchLabel) {
                html += `<div class="branch-label">${branchLabel}</div>`;
            }
            html += `<div class="tree-connector active"></div>`;
        }

        // Node classes
        let nodeClasses = "tree-node";
        if (isActive) nodeClasses += " active";
        if (isCompleted) nodeClasses += " completed";
        if (isResolution) nodeClasses += " resolution";
        if (isEscalation) nodeClasses += " escalation";

        html += `<div class="${nodeClasses}" id="node-${nodeId}">`;
        html += `<div class="node-title">${node.title}</div>`;
        html += `<div class="node-instruction">${node.instruction}</div>`;

        // Resolution box
        if (isResolution && node.resolution) {
            html += `
                <div class="resolution-box">
                    <h4>Resolution</h4>
                    <p>${node.resolution}</p>
                    ${isLast ? '<button class="mark-resolved-btn" onclick="markResolved()">Mark Resolved</button>' : ''}
                </div>
            `;
        }

        // Escalation box
        if (isEscalation && node.escalation) {
            html += `
                <div class="escalation-box">
                    <h4>Escalation Required</h4>
                    <p>${node.escalation}</p>
                </div>
            `;
        }

        // API check button (only on active non-terminal nodes with checkType)
        if (node.checkType && isActive) {
            html += `
                <div class="node-api-result" id="api-result-${nodeId}"></div>
                <button class="run-check-btn" id="run-btn-${nodeId}" onclick="runDiagnosticCheck('${runbook.id}', '${nodeId}')">Run Diagnostic Check</button>
            `;
        }

        // Outcome buttons
        if (node.outcomes) {
            const hasSelectedOutcome = selectedOutcomes[nodeId] !== undefined;
            html += `<div class="outcome-buttons" id="outcomes-${nodeId}">`;
            node.outcomes.forEach((outcome, idx) => {
                const isSelected = selectedOutcomes[nodeId] === idx;
                const isDimmed = hasSelectedOutcome && !isSelected;
                let btnClass = `outcome-btn style-${outcome.style || 'default'}`;
                if (isSelected) btnClass += " selected";
                if (isDimmed) btnClass += " dimmed";

                const disabled = isCompleted || (isActive && node.checkType && !document.getElementById(`api-result-${nodeId}`)?.classList.contains("visible") && !hasSelectedOutcome);

                html += `<button class="${btnClass}" onclick="selectOutcome('${runbook.id}', '${nodeId}', ${idx})" ${isDimmed ? 'disabled' : ''}>${outcome.label}</button>`;
            });
            html += `</div>`;
        }

        html += `</div>`; // close tree-node
    }

    html += `</div>`; // close tree-container

    workspace.innerHTML = html;

    // Scroll to active node
    const activeNode = document.querySelector(".tree-node.active");
    if (activeNode) {
        setTimeout(() => {
            activeNode.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 150);
    }
}

// =============================================================================
// Outcome Selection
// =============================================================================

function selectOutcome(runbookId, nodeId, outcomeIdx) {
    const runbook = RUNBOOKS.find(rb => rb.id === runbookId);
    if (!runbook) return;
    const state = treeState[runbookId];
    if (!state) return;

    const node = runbook.nodes[nodeId];
    if (!node || !node.outcomes || !node.outcomes[outcomeIdx]) return;

    // Don't allow changing already-completed outcomes (unless it's the current active node)
    const nodePosition = state.visitedNodes.indexOf(nodeId);
    if (nodePosition === -1) return;

    // If re-selecting on a previously completed node, truncate the path
    if (nodePosition < state.visitedNodes.length - 1) {
        state.visitedNodes = state.visitedNodes.slice(0, nodePosition + 1);
        // Clean up selectedOutcomes for removed nodes
        const removedNodes = Object.keys(state.selectedOutcomes).filter(
            nid => !state.visitedNodes.includes(nid) || nid === nodeId
        );
        removedNodes.forEach(nid => delete state.selectedOutcomes[nid]);
    }

    // Record the selection
    state.selectedOutcomes[nodeId] = outcomeIdx;

    // Navigate to next node
    const outcome = node.outcomes[outcomeIdx];
    if (outcome.next && runbook.nodes[outcome.next]) {
        state.visitedNodes.push(outcome.next);
    }

    state.resolved = false;
    renderTree(runbook);
}

function markResolved() {
    if (!activeRunbookId) return;
    const state = treeState[activeRunbookId];
    if (state) state.resolved = true;

    // Visual feedback
    const btn = document.querySelector(".mark-resolved-btn");
    if (btn) {
        btn.textContent = "Resolved";
        btn.disabled = true;
        btn.style.background = "rgba(46, 204, 113, 0.3)";
    }
}

// =============================================================================
// API Diagnostic Checks
// =============================================================================

async function runDiagnosticCheck(runbookId, nodeId) {
    const runbook = RUNBOOKS.find(rb => rb.id === runbookId);
    if (!runbook) return;
    const node = runbook.nodes[nodeId];
    if (!node || !node.checkType) return;

    const btn = document.getElementById(`run-btn-${nodeId}`);
    const resultDiv = document.getElementById(`api-result-${nodeId}`);

    if (btn) {
        btn.disabled = true;
        btn.textContent = "Running...";
    }
    if (resultDiv) {
        resultDiv.classList.add("visible");
        resultDiv.innerHTML = '<span style="color:var(--accent, #00d4aa);">Running diagnostic check...</span>';
    }

    try {
        let response;
        switch (node.checkType) {
            case "api_hl7":
                response = await apiCheckHL7(node);
                break;
            case "api_dicom":
                response = await apiCheckDICOM(node);
                break;
            case "api_fhir":
                response = await apiCheckFHIR(node);
                break;
            case "api_compare":
                response = await apiCheckCompare(node);
                break;
            default:
                response = { info: "Manual check step." };
        }

        if (resultDiv) {
            resultDiv.innerHTML = `<pre>${JSON.stringify(response, null, 2)}</pre>`;
        }
    } catch (e) {
        if (resultDiv) {
            resultDiv.innerHTML = `<pre style="color:var(--status-red, #ff4757);">Error: ${e.message}</pre>`;
        }
    }

    if (btn) {
        btn.disabled = false;
        btn.textContent = "Run Diagnostic Check";
    }
}

async function apiCheckHL7(node) {
    let rawMessage = "";
    const wantType = (node.apiParams && node.apiParams.message_type) || "ORM";

    if (samplesCache && samplesCache.hl7_messages) {
        const match = samplesCache.hl7_messages.find(m =>
            m.filename.toUpperCase().includes(wantType) ||
            m.content.includes(`${wantType}^`)
        );
        if (match) {
            rawMessage = match.content;
        } else if (samplesCache.hl7_messages.length > 0) {
            rawMessage = samplesCache.hl7_messages[0].content;
        }
    }

    if (!rawMessage) {
        return { info: "No HL7 sample available. Paste a message in the Diagnostics page to test." };
    }

    const resp = await fetch("/api/diagnostics/parse-hl7", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raw_message: rawMessage })
    });
    return await resp.json();
}

async function apiCheckDICOM(node) {
    const params = node.apiParams || {};
    const filename = params.filename || "chest_xray.dcm";
    const tagGroup = params.tag_group || "all";

    const resp = await fetch("/api/diagnostics/inspect-dicom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: filename, tag_group: tagGroup })
    });
    return await resp.json();
}

async function apiCheckFHIR(node) {
    let resourceJson = "";

    if (samplesCache && samplesCache.fhir_files && samplesCache.fhir_files.length > 0) {
        try {
            const sampleResp = await fetch(`/api/diagnostics/sample-fhir/${samplesCache.fhir_files[0]}`);
            if (sampleResp.ok) {
                const sampleData = await sampleResp.json();
                resourceJson = JSON.stringify(sampleData);
            }
        } catch (e) {
            // fall through to default
        }
    }

    if (!resourceJson) {
        resourceJson = JSON.stringify({
            resourceType: "DiagnosticReport",
            id: "example-ai-report",
            status: "final",
            code: {
                coding: [{
                    system: "http://loinc.org",
                    code: "18748-4",
                    display: "Diagnostic imaging study"
                }]
            },
            conclusionCode: [{
                coding: [{
                    system: "http://snomed.info/sct",
                    code: "36118008",
                    display: "Pneumothorax"
                }]
            }]
        });
    }

    const resp = await fetch("/api/diagnostics/validate-fhir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resource_json: resourceJson })
    });
    return await resp.json();
}

async function apiCheckCompare(node) {
    const hl7 = {
        mrn: "MRN-2024-78432",
        last_name: "DOE",
        first_name: "JANE",
        dob: "19580312",
        sex: "F"
    };
    const dicom = {
        mrn: "MRN-2024-78432",
        last_name: "DOE",
        first_name: "JANE",
        dob: "19580312",
        sex: "F"
    };

    const resp = await fetch("/api/diagnostics/compare-demographics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hl7: hl7, dicom: dicom })
    });
    return await resp.json();
}

// =============================================================================
// Utility
// =============================================================================

function estimateMaxDepth(runbook) {
    // BFS to find the longest path through the tree
    let maxDepth = 0;
    const queue = [{ nodeId: "start", depth: 1 }];
    const visited = new Set();

    while (queue.length > 0) {
        const { nodeId, depth } = queue.shift();
        if (visited.has(nodeId)) continue;
        visited.add(nodeId);

        if (depth > maxDepth) maxDepth = depth;

        const node = runbook.nodes[nodeId];
        if (node && node.outcomes) {
            node.outcomes.forEach(o => {
                if (o.next && !visited.has(o.next)) {
                    queue.push({ nodeId: o.next, depth: depth + 1 });
                }
            });
        }
    }
    return maxDepth;
}
