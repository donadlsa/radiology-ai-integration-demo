"""
HL7v2-to-FHIR Mapper

Maps HL7v2 segments to FHIR R4 resources. This is the core of the
V2-to-FHIR conversion that every healthcare organization is working
through as the industry migrates from HL7v2 to FHIR.

Based on the HL7 V2-to-FHIR Implementation Guide:
https://build.fhir.org/ig/HL7/v2-to-fhir/
"""

from src.hl7_engine.parser import (
    parse_hl7_message,
    identify_message_type,
    extract_patient_demographics,
    extract_order_details,
    extract_results,
    extract_ai_findings,
)
from src.hl7_engine.transforms import map_sex_code, format_hl7_datetime
from src.fhir_engine.resources import (
    build_patient,
    build_service_request,
    build_ai_observation,
    build_diagnostic_report,
)


def pid_to_patient(msg):
    """Map PID segment from a parsed HL7v2 message to a FHIR Patient.

    Mapping follows the V2-to-FHIR IG:
    - PID-3 -> Patient.identifier
    - PID-5 -> Patient.name
    - PID-7 -> Patient.birthDate
    - PID-8 -> Patient.gender
    - PID-11 -> Patient.address

    Args:
        msg: Parsed HL7v2 message (hl7apy Message object).

    Returns:
        FHIR Patient resource.
    """
    demographics = extract_patient_demographics(msg)
    return build_patient(demographics)


def obr_to_service_request(msg, patient_ref: str):
    """Map ORC/OBR segments to a FHIR ServiceRequest.

    Mapping:
    - ORC-2 -> ServiceRequest.identifier (placer order number)
    - OBR-4 -> ServiceRequest.code
    - OBR-18 -> ServiceRequest.identifier (accession number)

    Args:
        msg: Parsed HL7v2 message with ORC/OBR segments.
        patient_ref: FHIR reference to the Patient resource.

    Returns:
        FHIR ServiceRequest resource.
    """
    order = extract_order_details(msg)
    return build_service_request(order, patient_ref)


def oru_to_diagnostic_report(msg, patient_ref: str, study_ref: str = None):
    """Map ORU^R01 message to FHIR DiagnosticReport + Observations.

    This is the key integration point: converting an HL7v2 result
    message (the traditional format) into FHIR resources (the modern
    format). The narrative text becomes the report conclusion, and
    coded AI findings become Observation resources.

    Args:
        msg: Parsed HL7v2 ORU^R01 message.
        patient_ref: FHIR reference to the Patient.
        study_ref: Optional FHIR reference to the ImagingStudy.

    Returns:
        Tuple of (DiagnosticReport, list[Observation]).
    """
    # Extract AI findings from OBX segments
    ai_findings = extract_ai_findings(msg)

    # Build Observation for each finding
    observations = []
    for finding in ai_findings:
        obs = build_ai_observation(finding, patient_ref, study_ref)
        observations.append(obs)

    # Extract narrative text (first TX OBX)
    results = extract_results(msg)
    narrative = ""
    for r in results:
        if r["value_type"] == "TX" and r.get("observation_id") == "59776-5":
            narrative = r["value"]
            break

    # Build the DiagnosticReport
    order = extract_order_details(msg)
    request_ref = f"ServiceRequest/{order['placer_order_number']}" if order.get("placer_order_number") else None

    report = build_diagnostic_report(
        observations, patient_ref, study_ref, request_ref, narrative
    )

    return report, observations
