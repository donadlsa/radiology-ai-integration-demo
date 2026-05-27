"""
DICOM-to-FHIR Conversion

Converts DICOM study metadata and Structured Report content
into FHIR resources. This bridges the DICOM imaging world
with FHIR-based clinical data exchange.
"""

from src.dicom_engine.reader import extract_study_metadata, extract_patient_info
from src.fhir_engine.resources import (
    build_patient,
    build_imaging_study,
    build_ai_observation,
)


def convert_dicom_study_to_fhir(dicom_dataset) -> dict:
    """Convert DICOM study metadata to FHIR ImagingStudy + Patient.

    Takes a pydicom Dataset and produces the FHIR resources that
    represent the same study in the FHIR world.

    Args:
        dicom_dataset: pydicom Dataset from a DICOM image.

    Returns:
        Dictionary with patient and imaging_study FHIR resources.
    """
    study_meta = extract_study_metadata(dicom_dataset)
    patient_info = extract_patient_info(dicom_dataset)

    demographics = {
        "mrn": patient_info["patient_id"],
        "last_name": patient_info["last_name"],
        "first_name": patient_info["first_name"],
        "middle_name": patient_info["middle_name"],
        "dob": patient_info["dob"],
        "sex": patient_info["sex"],
    }

    patient = build_patient(demographics)
    patient_ref = f"Patient/{patient.id}"

    imaging_study = build_imaging_study(study_meta, patient_ref)

    return {
        "patient": patient,
        "imaging_study": imaging_study,
    }


def convert_ai_findings_to_fhir_observations(findings: list,
                                               patient_ref: str,
                                               study_ref: str = None) -> list:
    """Convert AI findings (from SR or other source) to FHIR Observations.

    Args:
        findings: List of finding dicts with code, description,
                 coding_system, and confidence.
        patient_ref: FHIR Patient reference.
        study_ref: Optional FHIR ImagingStudy reference.

    Returns:
        List of FHIR Observation resources.
    """
    return [
        build_ai_observation(finding, patient_ref, study_ref)
        for finding in findings
    ]
