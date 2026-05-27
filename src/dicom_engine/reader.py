"""
DICOM File Reader

Reads DICOM files and extracts metadata used for routing, patient matching,
and integration workflows. These are the tags a PACS administrator works
with daily -- the ones that determine where images go and how they match
to orders and patients.
"""

import pydicom
from pydicom.dataset import Dataset


def read_dicom(filepath: str) -> Dataset:
    """Read a DICOM file from disk.

    Args:
        filepath: Path to the DICOM file.

    Returns:
        pydicom Dataset.
    """
    return pydicom.dcmread(filepath)


def extract_study_metadata(ds: Dataset) -> dict:
    """Extract study-level metadata from a DICOM dataset.

    These are the core identifiers used to match images to orders,
    route studies to the correct PACS, and track imaging workflows.

    Args:
        ds: pydicom Dataset.

    Returns:
        Dictionary with study-level DICOM metadata.
    """
    return {
        "study_instance_uid": str(getattr(ds, "StudyInstanceUID", "")),
        "series_instance_uid": str(getattr(ds, "SeriesInstanceUID", "")),
        "sop_instance_uid": str(getattr(ds, "SOPInstanceUID", "")),
        "sop_class_uid": str(getattr(ds, "SOPClassUID", "")),
        "study_date": str(getattr(ds, "StudyDate", "")),
        "study_time": str(getattr(ds, "StudyTime", "")),
        "study_description": str(getattr(ds, "StudyDescription", "")),
        "accession_number": str(getattr(ds, "AccessionNumber", "")),
        "study_id": str(getattr(ds, "StudyID", "")),
        "modality": str(getattr(ds, "Modality", "")),
        "series_description": str(getattr(ds, "SeriesDescription", "")),
        "body_part": str(getattr(ds, "BodyPartExamined", "")),
        "instance_number": int(getattr(ds, "InstanceNumber", 0)),
        "referring_physician": str(getattr(ds, "ReferringPhysicianName", "")),
    }


def extract_patient_info(ds: Dataset) -> dict:
    """Extract patient demographics from DICOM tags.

    Used for patient matching between DICOM images and HL7 messages --
    a common integration troubleshooting task when orders don't match
    images due to demographic mismatches.

    Args:
        ds: pydicom Dataset.

    Returns:
        Dictionary with patient demographic fields.
    """
    patient_name = str(getattr(ds, "PatientName", ""))
    parts = patient_name.split("^") if patient_name else []

    return {
        "patient_id": str(getattr(ds, "PatientID", "")),
        "patient_name_raw": patient_name,
        "last_name": parts[0] if len(parts) > 0 else "",
        "first_name": parts[1] if len(parts) > 1 else "",
        "middle_name": parts[2] if len(parts) > 2 else "",
        "dob": str(getattr(ds, "PatientBirthDate", "")),
        "sex": str(getattr(ds, "PatientSex", "")),
    }


def extract_routing_tags(ds: Dataset) -> dict:
    """Extract DICOM tags used for routing decisions.

    These tags determine where a DICOM object is stored and forwarded:
    AE titles, institution, station name, and the SOP Class that defines
    what type of object it is. When routing breaks, these are the first
    tags to check.

    Args:
        ds: pydicom Dataset.

    Returns:
        Dictionary with routing-relevant DICOM tags.
    """
    return {
        "source_ae_title": str(getattr(getattr(ds, "file_meta", ds), "SourceApplicationEntityTitle",
                                       getattr(ds, "SourceApplicationEntityTitle", ""))),
        "institution_name": str(getattr(ds, "InstitutionName", "")),
        "station_name": str(getattr(ds, "StationName", "")),
        "department": str(getattr(ds, "InstitutionalDepartmentName", "")),
        "manufacturer": str(getattr(ds, "Manufacturer", "")),
        "modality": str(getattr(ds, "Modality", "")),
        "sop_class_uid": str(getattr(ds, "SOPClassUID", "")),
        "body_part": str(getattr(ds, "BodyPartExamined", "")),
    }


def compare_hl7_dicom_demographics(hl7_patient: dict, dicom_ds: Dataset) -> dict:
    """Compare patient demographics between HL7 and DICOM data.

    This is one of the most common integration troubleshooting tasks:
    when an order (HL7) and an image (DICOM) don't match because of
    name formatting differences, MRN mismatches, or DOB discrepancies.

    Args:
        hl7_patient: Patient dict from hl7_engine.parser.extract_patient_demographics.
        dicom_ds: pydicom Dataset from the image.

    Returns:
        Dictionary with match results for each field.
    """
    dicom_patient = extract_patient_info(dicom_ds)

    def normalize(val: str) -> str:
        return val.strip().upper().replace(",", "").replace(".", "")

    mrn_match = normalize(hl7_patient.get("mrn", "")) == normalize(dicom_patient["patient_id"])
    last_match = normalize(hl7_patient.get("last_name", "")) == normalize(dicom_patient["last_name"])
    first_match = normalize(hl7_patient.get("first_name", "")) == normalize(dicom_patient["first_name"])
    dob_match = hl7_patient.get("dob", "").replace("-", "") == dicom_patient["dob"].replace("-", "")
    sex_match = normalize(hl7_patient.get("sex", "")) == normalize(dicom_patient["sex"])

    all_match = all([mrn_match, last_match, first_match, dob_match, sex_match])

    return {
        "overall_match": all_match,
        "mrn": {"hl7": hl7_patient.get("mrn", ""), "dicom": dicom_patient["patient_id"], "match": mrn_match},
        "last_name": {"hl7": hl7_patient.get("last_name", ""), "dicom": dicom_patient["last_name"], "match": last_match},
        "first_name": {"hl7": hl7_patient.get("first_name", ""), "dicom": dicom_patient["first_name"], "match": first_match},
        "dob": {"hl7": hl7_patient.get("dob", ""), "dicom": dicom_patient["dob"], "match": dob_match},
        "sex": {"hl7": hl7_patient.get("sex", ""), "dicom": dicom_patient["sex"], "match": sex_match},
    }
