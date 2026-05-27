"""Tests for FHIR resource building and HL7v2-to-FHIR mapping."""

import json
import os
from src.fhir_engine.resources import (
    build_patient,
    build_service_request,
    build_imaging_study,
    build_ai_observation,
    build_diagnostic_report,
)
from src.fhir_engine.bundle import create_transaction_bundle, validate_bundle
from src.fhir_engine.mapper import pid_to_patient, obr_to_service_request, oru_to_diagnostic_report
from src.hl7_engine.parser import parse_hl7_message


def _resource_type(resource):
    """Get resource type, handling both R4B and R5 APIs."""
    return getattr(resource, '__resource_type__', getattr(resource, 'resource_type', None))


SAMPLE_DIR = os.path.join(os.path.dirname(__file__), "..", "sample_data")

DEMOGRAPHICS = {
    "mrn": "MRN-2024-78432",
    "assigning_authority": "MAIN_HOSPITAL",
    "last_name": "DOE",
    "first_name": "JANE",
    "middle_name": "M",
    "dob": "19580312",
    "sex": "F",
    "address": {
        "street": "123 OAK STREET",
        "city": "NASHVILLE",
        "state": "TN",
        "zip": "37201",
    },
}

ORDER = {
    "placer_order_number": "ORD-20260115-001",
    "accession_number": "ACC-20260115-5678",
    "procedure_code": "71020",
    "procedure_description": "CHEST 2 VIEWS",
}

DICOM_META = {
    "study_instance_uid": "1.2.826.0.1.3680043.8.1055.1.20260115.1",
    "series_instance_uid": "1.2.826.0.1.3680043.8.1055.2.20260115.1",
    "study_date": "20260115",
    "study_time": "143025",
    "accession_number": "ACC-20260115-5678",
    "study_description": "CHEST 2 VIEWS",
    "modality": "CR",
    "series_description": "PA AND LATERAL",
    "body_part": "CHEST",
}

FINDINGS = [
    {"code": "128601007", "description": "Infectious pneumonia", "coding_system": "SCT", "confidence": 0.92},
    {"code": "60046008", "description": "Pleural effusion", "coding_system": "SCT", "confidence": 0.87},
]


class TestBuildPatient:
    def test_patient_fields(self):
        patient = build_patient(DEMOGRAPHICS)
        assert _resource_type(patient) == "Patient"
        assert patient.gender == "female"
        assert patient.name[0].family == "DOE"
        assert "JANE" in patient.name[0].given

    def test_patient_serializes(self):
        patient = build_patient(DEMOGRAPHICS)
        data = json.loads(patient.model_dump_json())
        assert data["resourceType"] == "Patient"
        assert data["birthDate"] == "1958-03-12"

    def test_patient_identifier(self):
        patient = build_patient(DEMOGRAPHICS)
        assert patient.identifier[0].value == "MRN-2024-78432"


class TestBuildServiceRequest:
    def test_service_request(self):
        sr = build_service_request(ORDER, "Patient/MRN-2024-78432")
        assert _resource_type(sr) == "ServiceRequest"
        assert sr.status == "completed"
        assert sr.code.coding[0].code == "71020"
        assert sr.subject.reference == "Patient/MRN-2024-78432"


class TestBuildImagingStudy:
    def test_imaging_study(self):
        study = build_imaging_study(DICOM_META, "Patient/MRN-2024-78432")
        assert _resource_type(study) == "ImagingStudy"
        assert study.status == "available"
        assert len(study.series) == 1
        assert study.series[0].modality.code == "CR"


class TestBuildObservation:
    def test_ai_observation(self):
        obs = build_ai_observation(FINDINGS[0], "Patient/MRN-2024-78432")
        assert _resource_type(obs) == "Observation"
        assert obs.status == "final"
        assert obs.code.coding[0].code == "128601007"
        assert obs.component[0].valueQuantity.value == 0.92

    def test_observation_category(self):
        obs = build_ai_observation(FINDINGS[0], "Patient/MRN-2024-78432")
        assert obs.category[0].coding[0].code == "imaging"


class TestBuildDiagnosticReport:
    def test_report(self):
        observations = [build_ai_observation(f, "Patient/MRN-2024-78432") for f in FINDINGS]
        report = build_diagnostic_report(
            observations, "Patient/MRN-2024-78432",
            narrative="Test narrative conclusion"
        )
        assert _resource_type(report) == "DiagnosticReport"
        assert report.status == "final"
        assert len(report.result) == 2
        assert report.conclusion == "Test narrative conclusion"


class TestBundle:
    def test_create_bundle(self):
        patient = build_patient(DEMOGRAPHICS)
        obs = build_ai_observation(FINDINGS[0], "Patient/MRN-2024-78432")
        bundle = create_transaction_bundle([patient, obs])

        assert bundle.type == "transaction"
        assert len(bundle.entry) == 2

    def test_validate_bundle(self):
        patient = build_patient(DEMOGRAPHICS)
        obs = build_ai_observation(FINDINGS[0], "Patient/MRN-2024-78432")
        bundle = create_transaction_bundle([patient, obs])
        issues = validate_bundle(bundle)
        assert len(issues) == 0


class TestHL7ToFhirMapper:
    def test_pid_to_patient(self):
        raw = open(os.path.join(SAMPLE_DIR, "hl7", "orm_o01_order.hl7")).read()
        msg = parse_hl7_message(raw)
        patient = pid_to_patient(msg)
        assert patient.name[0].family == "DOE"
        assert patient.gender == "female"

    def test_obr_to_service_request(self):
        raw = open(os.path.join(SAMPLE_DIR, "hl7", "orm_o01_order.hl7")).read()
        msg = parse_hl7_message(raw)
        sr = obr_to_service_request(msg, "Patient/MRN-2024-78432")
        assert sr.code.coding[0].code == "71020"

    def test_oru_to_diagnostic_report(self):
        raw = open(os.path.join(SAMPLE_DIR, "hl7", "oru_r01_chest_xray.hl7")).read()
        msg = parse_hl7_message(raw)
        report, observations = oru_to_diagnostic_report(msg, "Patient/MRN-2024-78432")

        assert _resource_type(report) == "DiagnosticReport"
        assert len(observations) == 2
        assert "pneumonia" in report.conclusion.lower()
