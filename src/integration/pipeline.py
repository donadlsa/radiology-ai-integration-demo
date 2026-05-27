"""
Radiology AI Integration Pipeline

End-to-end demonstration of how AI radiology findings flow through
hospital infrastructure using HL7v2, DICOM, and FHIR standards.

Pipeline:
  1. Receive radiology order (HL7v2 ORM^O01)
  2. Image arrives (DICOM CR)
  3. AI analyzes the image -> structured findings
  4. Generate results in all three formats:
     - HL7v2 ORU^R01 (for RIS/EHR via traditional interface)
     - DICOM Structured Report (for PACS)
     - FHIR Bundle (for modern API-based integration)
  5. Route results to appropriate systems
  6. Validate cross-format consistency
"""

import os
import json
from datetime import datetime

from src.hl7_engine.parser import (
    parse_hl7_message,
    identify_message_type,
    extract_patient_demographics,
    extract_order_details,
)
from src.hl7_engine.builder import build_oru_r01
from src.hl7_engine.router import route_message, check_critical_result
from src.dicom_engine.reader import (
    read_dicom,
    extract_study_metadata,
    compare_hl7_dicom_demographics,
)
from src.dicom_engine.sr_builder import build_ai_structured_report, save_sr
from src.dicom_engine.tag_inspector import validate_required_tags
from src.fhir_engine.resources import (
    build_patient,
    build_service_request,
    build_imaging_study,
    build_ai_observation,
    build_diagnostic_report,
)
from src.fhir_engine.bundle import create_transaction_bundle, validate_bundle


# Simulated AI findings -- in production these would come from the AI engine
AI_FINDINGS = [
    {
        "code": "128601007",
        "description": "Infectious pneumonia",
        "coding_system": "SCT",
        "confidence": 0.92,
        "location_code": "266005",
        "location_description": "Right lower lobe of lung",
    },
    {
        "code": "60046008",
        "description": "Pleural effusion",
        "coding_system": "SCT",
        "confidence": 0.87,
        "location_code": "44029006",
        "location_description": "Left hemithorax",
    },
]

NARRATIVE = (
    "Frontal and lateral views of the chest were obtained. "
    "The cardiac silhouette is mildly enlarged. The lungs demonstrate "
    "a small left-sided pleural effusion. A patchy opacity is noted in "
    "the right lower lobe, concerning for pneumonia. "
    "No pneumothorax is identified."
)


def _separator(title: str) -> str:
    return f"\n{'='*60}\n  {title}\n{'='*60}"


def run_pipeline(order_path: str = None, dicom_path: str = None) -> dict:
    """Execute the full radiology AI integration pipeline.

    Args:
        order_path: Path to HL7v2 ORM^O01 message file.
        dicom_path: Path to DICOM image file.

    Returns:
        Dictionary containing all pipeline artifacts.
    """
    base_dir = os.path.join(os.path.dirname(__file__), "..", "..", "sample_data")

    if order_path is None:
        order_path = os.path.join(base_dir, "hl7", "orm_o01_order.hl7")
    if dicom_path is None:
        dicom_path = os.path.join(base_dir, "dicom", "chest_xray.dcm")

    results = {}

    # ================================================================
    # STEP 1: Receive Radiology Order (HL7v2 ORM^O01)
    # ================================================================
    print(_separator("STEP 1: Receive Radiology Order (HL7v2 ORM^O01)"))

    with open(order_path, "r") as f:
        raw_order = f.read()

    order_msg = parse_hl7_message(raw_order)
    msg_type, trigger = identify_message_type(order_msg)
    print(f"  Message Type: {msg_type}^{trigger}")

    patient = extract_patient_demographics(order_msg)
    print(f"  Patient: {patient['last_name']}, {patient['first_name']} (MRN: {patient['mrn']})")

    order = extract_order_details(order_msg)
    print(f"  Procedure: {order['procedure_description']} ({order['procedure_code']})")
    print(f"  Accession: {order['accession_number']}")
    print(f"  Modality: {order['modality']}")

    destinations = route_message(order_msg)
    print(f"  Routed to: {', '.join(destinations)}")

    results["order"] = order
    results["patient"] = patient

    # ================================================================
    # STEP 2: Image Arrives (DICOM)
    # ================================================================
    print(_separator("STEP 2: Image Arrives (DICOM)"))

    if os.path.exists(dicom_path):
        ds = read_dicom(dicom_path)
        study_meta = extract_study_metadata(ds)
        print(f"  Modality: {study_meta['modality']}")
        print(f"  Study: {study_meta['study_description']}")
        print(f"  Study UID: {study_meta['study_instance_uid'][:40]}...")

        # Validate DICOM tags
        issues = validate_required_tags(ds)
        if issues:
            print(f"  WARNING: {len(issues)} tag validation issue(s)")
        else:
            print("  Tag validation: PASSED")

        # Cross-reference: verify patient demographics match between HL7 and DICOM
        match_result = compare_hl7_dicom_demographics(patient, ds)
        if match_result["overall_match"]:
            print("  HL7/DICOM patient match: CONFIRMED")
        else:
            mismatches = [k for k, v in match_result.items()
                         if k != "overall_match" and not v.get("match", True)]
            print(f"  HL7/DICOM patient match: MISMATCH on {', '.join(mismatches)}")

        results["dicom_metadata"] = study_meta
    else:
        print(f"  [DICOM file not found at {dicom_path}]")
        print("  Run 'python -m src.dicom_engine.generate_sample' to generate sample files")
        study_meta = {"study_instance_uid": "1.2.3.4.5", "accession_number": order["accession_number"]}
        results["dicom_metadata"] = study_meta

    # ================================================================
    # STEP 3: AI Analyzes Image
    # ================================================================
    print(_separator("STEP 3: AI Analyzes Image"))
    print("  AI Engine: Radiology AI Engine v3.2")
    print(f"  Findings detected: {len(AI_FINDINGS)}")
    for f in AI_FINDINGS:
        print(f"    - {f['description']} (confidence: {f['confidence']:.0%})")
        if f.get("location_description"):
            print(f"      Location: {f['location_description']}")

    # ================================================================
    # STEP 4A: Generate HL7v2 ORU^R01
    # ================================================================
    print(_separator("STEP 4A: Generate HL7v2 ORU^R01 Result"))

    oru_msg = build_oru_r01(patient, order, AI_FINDINGS, narrative=NARRATIVE)
    raw_oru = oru_msg.to_er7()
    print(f"  Message Control ID: {oru_msg.msh.msh_10.value}")
    print(f"  OBX segments: {raw_oru.count('OBX|')}")
    print(f"  Message size: {len(raw_oru)} bytes")

    # Check for critical results
    reparsed = parse_hl7_message(raw_oru)
    is_critical = check_critical_result(reparsed)
    print(f"  Critical result: {'YES - ALERT REQUIRED' if is_critical else 'No'}")

    oru_destinations = route_message(reparsed)
    print(f"  Routed to: {', '.join(oru_destinations)}")

    results["hl7_oru"] = raw_oru

    # ================================================================
    # STEP 4B: Generate DICOM Structured Report
    # ================================================================
    print(_separator("STEP 4B: Generate DICOM Structured Report"))

    sr_metadata = {
        "patient_name": f"{patient['last_name']}^{patient['first_name']}^{patient['middle_name']}",
        "patient_id": patient["mrn"],
        "patient_dob": patient["dob"],
        "patient_sex": patient["sex"],
        "study_instance_uid": study_meta.get("study_instance_uid", ""),
        "study_date": study_meta.get("study_date", ""),
        "study_time": study_meta.get("study_time", ""),
        "accession_number": order["accession_number"],
        "referring_physician": "SMITH^ROBERT^J",
        "study_id": study_meta.get("study_id", ""),
        "institution": "MAIN HOSPITAL",
    }

    sr_ds = build_ai_structured_report(sr_metadata, AI_FINDINGS)
    print(f"  SOP Class: Comprehensive SR (1.2.840.10008.5.1.4.1.1.88.33)")
    print(f"  Content items: {len(sr_ds.ContentSequence)}")
    print(f"  Verification: {sr_ds.VerificationFlag} (pending radiologist review)")
    print(f"  Series: {sr_ds.SeriesNumber} ({sr_ds.SeriesDescription})")

    # Save the SR
    sr_output = os.path.join(base_dir, "dicom", "ai_structured_report.dcm")
    save_sr(sr_ds, sr_output)
    print(f"  Saved to: {os.path.basename(sr_output)}")

    results["dicom_sr"] = sr_ds

    # ================================================================
    # STEP 4C: Generate FHIR Resources
    # ================================================================
    print(_separator("STEP 4C: Generate FHIR R4 Resources"))

    fhir_patient = build_patient(patient)
    patient_ref = f"Patient/{fhir_patient.id}"
    print(f"  Patient: {fhir_patient.id}")

    fhir_request = build_service_request(order, patient_ref)
    print(f"  ServiceRequest: {fhir_request.id}")

    fhir_study = build_imaging_study(study_meta, patient_ref,
                                      f"ServiceRequest/{fhir_request.id}")
    print(f"  ImagingStudy: {fhir_study.id}")

    fhir_observations = []
    for finding in AI_FINDINGS:
        obs = build_ai_observation(finding, patient_ref,
                                    f"ImagingStudy/{fhir_study.id}")
        fhir_observations.append(obs)
        print(f"  Observation: {obs.id} ({finding['description']})")

    fhir_report = build_diagnostic_report(
        fhir_observations, patient_ref,
        f"ImagingStudy/{fhir_study.id}",
        f"ServiceRequest/{fhir_request.id}",
        NARRATIVE
    )
    print(f"  DiagnosticReport: {fhir_report.id}")

    all_resources = [fhir_patient, fhir_request, fhir_study] + fhir_observations + [fhir_report]
    bundle = create_transaction_bundle(all_resources)
    bundle_issues = validate_bundle(bundle)
    print(f"  Transaction Bundle: {len(bundle.entry)} entries")
    print(f"  Bundle validation: {'PASSED' if not bundle_issues else f'ISSUES: {bundle_issues}'}")

    results["fhir_bundle"] = bundle
    results["fhir_resources"] = all_resources

    # ================================================================
    # STEP 5: Cross-Format Validation
    # ================================================================
    print(_separator("STEP 5: Cross-Format Validation"))

    # Verify consistency across all three formats
    checks = []

    # Patient MRN consistency
    hl7_mrn = patient["mrn"]
    fhir_mrn = fhir_patient.identifier[0].value
    checks.append(("Patient MRN", hl7_mrn == fhir_mrn, hl7_mrn, fhir_mrn))

    # Accession number consistency
    hl7_acc = order["accession_number"]
    sr_acc = sr_ds.AccessionNumber
    checks.append(("Accession Number (HL7/SR)", hl7_acc == sr_acc, hl7_acc, sr_acc))

    # Finding count consistency
    oru_findings = raw_oru.count("SCT")  # SNOMED findings in ORU
    sr_findings = len([c for c in sr_ds.ContentSequence if c.ValueType == "CONTAINER"])
    fhir_findings = len(fhir_observations)
    checks.append(("Finding count (FHIR/SR)", sr_findings == fhir_findings,
                   str(sr_findings), str(fhir_findings)))

    all_passed = True
    for name, passed, val1, val2 in checks:
        status = "PASS" if passed else "FAIL"
        if not passed:
            all_passed = False
        print(f"  [{status}] {name}: {val1} / {val2}")

    print(f"\n  Overall: {'ALL CHECKS PASSED' if all_passed else 'SOME CHECKS FAILED'}")

    # ================================================================
    # Summary
    # ================================================================
    print(_separator("PIPELINE COMPLETE"))
    print(f"""
  Radiology AI Integration Pipeline Summary
  ------------------------------------------
  Patient:    {patient['last_name']}, {patient['first_name']} ({patient['mrn']})
  Procedure:  {order['procedure_description']}
  Accession:  {order['accession_number']}
  AI Findings: {len(AI_FINDINGS)}

  Outputs Generated:
    HL7v2 ORU^R01:         {len(raw_oru):,} bytes
    DICOM Structured Report: {os.path.basename(sr_output)}
    FHIR Transaction Bundle: {len(bundle.entry)} resources

  This demonstrates how a single AI analysis flows through
  all three healthcare integration standards — the same
  findings delivered via HL7v2 (legacy), DICOM SR (PACS),
  and FHIR (modern API).
""")

    return results


if __name__ == "__main__":
    run_pipeline()
