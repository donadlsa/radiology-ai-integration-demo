"""
HL7v2-to-FHIR Conversion

Converts HL7v2 ORU^R01 result messages into FHIR resources.
This represents the V2-to-FHIR migration pathway that every
healthcare organization is navigating as the industry shifts
from HL7v2 to FHIR-based interoperability.
"""

from src.hl7_engine.parser import (
    parse_hl7_message,
    extract_patient_demographics,
    extract_order_details,
    extract_ai_findings,
    extract_results,
)
from src.fhir_engine.resources import (
    build_patient,
    build_service_request,
    build_ai_observation,
    build_diagnostic_report,
)
from src.fhir_engine.bundle import create_transaction_bundle


def convert_oru_to_fhir_bundle(raw_hl7: str) -> dict:
    """Convert a complete HL7v2 ORU^R01 message to a FHIR Transaction Bundle.

    This is the end-to-end conversion: take a raw HL7v2 result message
    and produce a FHIR Bundle containing Patient, ServiceRequest,
    Observations, and DiagnosticReport.

    Args:
        raw_hl7: Raw HL7v2 ORU^R01 message string.

    Returns:
        Dictionary with:
            - bundle: FHIR Bundle resource
            - patient: FHIR Patient resource
            - observations: List of FHIR Observation resources
            - report: FHIR DiagnosticReport resource
    """
    msg = parse_hl7_message(raw_hl7)

    # Step 1: Extract data from HL7v2 segments
    demographics = extract_patient_demographics(msg)
    order = extract_order_details(msg)
    ai_findings = extract_ai_findings(msg)
    all_results = extract_results(msg)

    # Step 2: Build FHIR resources
    patient = build_patient(demographics)
    patient_ref = f"Patient/{patient.id}"

    service_request = build_service_request(order, patient_ref)

    observations = []
    for finding in ai_findings:
        obs = build_ai_observation(finding, patient_ref)
        observations.append(obs)

    # Extract narrative from TX OBX segments
    narrative = ""
    for r in all_results:
        if r["value_type"] == "TX" and r.get("observation_id") == "59776-5":
            narrative = r["value"]
            break

    request_ref = f"ServiceRequest/{service_request.id}"
    report = build_diagnostic_report(observations, patient_ref,
                                      request_ref=request_ref,
                                      narrative=narrative)

    # Step 3: Package into a Transaction Bundle
    all_resources = [patient, service_request] + observations + [report]
    bundle = create_transaction_bundle(all_resources)

    return {
        "bundle": bundle,
        "patient": patient,
        "service_request": service_request,
        "observations": observations,
        "report": report,
    }
