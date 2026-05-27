"""
FHIR R4 Resource Builder

Builds FHIR R4 resources for the radiology AI integration workflow:
Patient, ServiceRequest (order), ImagingStudy, Observation (AI finding),
and DiagnosticReport. These resources represent the modern interoperability
pathway for delivering AI results to EHR systems.
"""

from datetime import datetime
from fhir.resources.R4B.patient import Patient
from fhir.resources.R4B.servicerequest import ServiceRequest
from fhir.resources.R4B.imagingstudy import ImagingStudy
from fhir.resources.R4B.observation import Observation
from fhir.resources.R4B.diagnosticreport import DiagnosticReport


def build_patient(demographics: dict) -> Patient:
    """Build a FHIR Patient resource from demographics.

    Args:
        demographics: Dict with keys: mrn, last_name, first_name,
                     middle_name, dob, sex.

    Returns:
        FHIR Patient resource.
    """
    # Map HL7v2 sex codes to FHIR gender
    gender_map = {"M": "male", "F": "female", "U": "unknown", "O": "other"}
    gender = gender_map.get(demographics.get("sex", "U"), "unknown")

    # Parse DOB from HL7 format (YYYYMMDD) to FHIR date
    dob = demographics.get("dob", "")
    birth_date = None
    if dob and len(dob) >= 8:
        birth_date = f"{dob[:4]}-{dob[4:6]}-{dob[6:8]}"

    given = [demographics.get("first_name", "")]
    if demographics.get("middle_name"):
        given.append(demographics["middle_name"])

    patient_data = {
        "resourceType": "Patient",
        "id": demographics.get("mrn", "unknown"),
        "identifier": [{
            "system": f"urn:oid:2.16.840.1.113883.3.{demographics.get('assigning_authority', 'UNKNOWN')}",
            "value": demographics.get("mrn", ""),
            "type": {
                "coding": [{
                    "system": "http://terminology.hl7.org/CodeSystem/v2-0203",
                    "code": "MR",
                    "display": "Medical Record Number",
                }]
            }
        }],
        "name": [{
            "family": demographics.get("last_name", ""),
            "given": given,
            "use": "official",
        }],
        "gender": gender,
    }

    if birth_date:
        patient_data["birthDate"] = birth_date

    if demographics.get("address"):
        addr = demographics["address"]
        patient_data["address"] = [{
            "line": [addr.get("street", "")],
            "city": addr.get("city", ""),
            "state": addr.get("state", ""),
            "postalCode": addr.get("zip", ""),
        }]

    return Patient(**patient_data)


def build_service_request(order: dict, patient_ref: str) -> ServiceRequest:
    """Build a FHIR ServiceRequest from radiology order details.

    In FHIR, a ServiceRequest replaces the HL7v2 ORM^O01 for ordering.
    This maps the ORC/OBR segments to the FHIR resource.

    Args:
        order: Dict with keys: placer_order_number, procedure_code,
              procedure_description, accession_number, ordering_provider.
        patient_ref: FHIR reference to the Patient (e.g., "Patient/MRN-123").

    Returns:
        FHIR ServiceRequest resource.
    """
    return ServiceRequest(**{
        "resourceType": "ServiceRequest",
        "id": order.get("placer_order_number", "unknown"),
        "status": "completed",
        "intent": "order",
        "category": [{
            "coding": [{
                "system": "http://snomed.info/sct",
                "code": "363679005",
                "display": "Imaging",
            }]
        }],
        "code": {
            "coding": [{
                "system": "http://www.ama-assn.org/go/cpt",
                "code": order.get("procedure_code", ""),
                "display": order.get("procedure_description", ""),
            }]
        },
        "subject": {"reference": patient_ref},
        "identifier": [{
            "type": {
                "coding": [{
                    "system": "http://terminology.hl7.org/CodeSystem/v2-0203",
                    "code": "ACSN",
                    "display": "Accession ID",
                }]
            },
            "value": order.get("accession_number", ""),
        }],
    })


def build_imaging_study(dicom_metadata: dict, patient_ref: str,
                        request_ref: str = None) -> ImagingStudy:
    """Build a FHIR ImagingStudy from DICOM study metadata.

    ImagingStudy is the FHIR representation of a DICOM study. It bridges
    the DICOM and FHIR worlds, making imaging data discoverable through
    FHIR APIs.

    Args:
        dicom_metadata: Dict from dicom_engine.reader.extract_study_metadata.
        patient_ref: FHIR reference to the Patient.
        request_ref: Optional FHIR reference to the ServiceRequest.

    Returns:
        FHIR ImagingStudy resource.
    """
    # Convert DICOM modality to FHIR coding
    modality = dicom_metadata.get("modality", "")

    study_data = {
        "resourceType": "ImagingStudy",
        "id": dicom_metadata.get("accession_number", "unknown"),
        "status": "available",
        "subject": {"reference": patient_ref},
        "identifier": [{
            "system": "urn:dicom:uid",
            "value": f"urn:oid:{dicom_metadata.get('study_instance_uid', '')}",
        }],
        "started": _dicom_date_to_fhir(dicom_metadata.get("study_date", ""),
                                         dicom_metadata.get("study_time", "")),
        "description": dicom_metadata.get("study_description", ""),
        "series": [{
            "uid": dicom_metadata.get("series_instance_uid", ""),
            "modality": {
                "system": "http://dicom.nema.org/resources/ontology/DCM",
                "code": modality,
            },
            "description": dicom_metadata.get("series_description", ""),
            "bodySite": {
                "system": "http://snomed.info/sct",
                "display": dicom_metadata.get("body_part", ""),
            },
        }],
    }

    if request_ref:
        study_data["basedOn"] = [{"reference": request_ref}]

    return ImagingStudy(**study_data)


def build_ai_observation(finding: dict, patient_ref: str,
                         study_ref: str = None) -> Observation:
    """Build a FHIR Observation for an AI-detected finding.

    Each AI finding becomes an Observation with:
    - A SNOMED CT code for the finding
    - A confidence score as a component
    - A reference to the imaging study

    Args:
        finding: Dict with keys: code, description, coding_system, confidence.
        patient_ref: FHIR reference to the Patient.
        study_ref: Optional FHIR reference to the ImagingStudy.

    Returns:
        FHIR Observation resource.
    """
    obs_data = {
        "resourceType": "Observation",
        "id": f"ai-finding-{finding['code']}",
        "status": "final",
        "category": [{
            "coding": [{
                "system": "http://terminology.hl7.org/CodeSystem/observation-category",
                "code": "imaging",
                "display": "Imaging",
            }]
        }],
        "code": {
            "coding": [{
                "system": _get_fhir_system(finding.get("coding_system", "SCT")),
                "code": finding["code"],
                "display": finding["description"],
            }]
        },
        "subject": {"reference": patient_ref},
        "effectiveDateTime": datetime.now().strftime("%Y-%m-%dT%H:%M:%S+00:00"),
        "performer": [{
            "display": "Radiology AI Engine v3.2",
        }],
    }

    # Add confidence score as a component
    if finding.get("confidence") is not None:
        obs_data["component"] = [{
            "code": {
                "coding": [{
                    "system": "http://snomed.info/sct",
                    "code": "397003",
                    "display": "Degree of certainty",
                }]
            },
            "valueQuantity": {
                "value": finding["confidence"],
                "unit": "probability",
                "system": "http://unitsofmeasure.org",
                "code": "1",
            }
        }]

    if study_ref:
        obs_data["derivedFrom"] = [{"reference": study_ref}]

    return Observation(**obs_data)


def build_diagnostic_report(observations: list, patient_ref: str,
                            study_ref: str = None,
                            request_ref: str = None,
                            narrative: str = "") -> DiagnosticReport:
    """Build a FHIR DiagnosticReport wrapping AI observations.

    The DiagnosticReport ties together the imaging study, AI observations,
    and narrative into a single deliverable result -- the FHIR equivalent
    of the HL7v2 ORU^R01.

    Args:
        observations: List of FHIR Observation resources (AI findings).
        patient_ref: FHIR reference to the Patient.
        study_ref: Optional FHIR reference to the ImagingStudy.
        request_ref: Optional FHIR reference to the ServiceRequest.
        narrative: Optional report narrative text.

    Returns:
        FHIR DiagnosticReport resource.
    """
    report_data = {
        "resourceType": "DiagnosticReport",
        "id": "ai-report-001",
        "status": "final",
        "category": [{
            "coding": [{
                "system": "http://terminology.hl7.org/CodeSystem/v2-0074",
                "code": "RAD",
                "display": "Radiology",
            }]
        }],
        "code": {
            "coding": [{
                "system": "http://loinc.org",
                "code": "18748-4",
                "display": "Diagnostic Imaging Study",
            }]
        },
        "subject": {"reference": patient_ref},
        "effectiveDateTime": datetime.now().strftime("%Y-%m-%dT%H:%M:%S+00:00"),
        "issued": datetime.now().strftime("%Y-%m-%dT%H:%M:%S+00:00"),
        "result": [{"reference": f"Observation/{obs.id}"} for obs in observations],
    }

    if study_ref:
        report_data["imagingStudy"] = [{"reference": study_ref}]

    if request_ref:
        report_data["basedOn"] = [{"reference": request_ref}]

    if narrative:
        report_data["conclusion"] = narrative

    return DiagnosticReport(**report_data)


def _dicom_date_to_fhir(dicom_date: str, dicom_time: str = "") -> str:
    """Convert DICOM date/time to FHIR dateTime format."""
    if not dicom_date or len(dicom_date) < 8:
        return datetime.now().isoformat()

    date_str = f"{dicom_date[:4]}-{dicom_date[4:6]}-{dicom_date[6:8]}"
    if dicom_time and len(dicom_time) >= 6:
        time_str = f"{dicom_time[:2]}:{dicom_time[2:4]}:{dicom_time[4:6]}"
        return f"{date_str}T{time_str}+00:00"
    return date_str


def _get_fhir_system(coding_system: str) -> str:
    """Map coding system abbreviations to FHIR system URIs."""
    systems = {
        "SCT": "http://snomed.info/sct",
        "LN": "http://loinc.org",
        "CPT": "http://www.ama-assn.org/go/cpt",
        "ICD10": "http://hl7.org/fhir/sid/icd-10",
    }
    return systems.get(coding_system, f"urn:oid:unknown:{coding_system}")
