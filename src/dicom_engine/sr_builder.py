"""
DICOM Structured Report Builder

Builds DICOM Structured Reports (SR) containing AI radiology findings.
This is how AI systems like Annalise.ai deliver results back to PACS --
as DICOM SR objects that can be viewed alongside the original images.

The SR uses the Comprehensive SR IOD with a content tree structure:
  CONTAINER (root)
    └── CONTAINER (Finding)
          ├── CODE: Finding type (SNOMED CT)
          ├── NUM: Confidence score
          └── CODE: Anatomical location
"""

import os
from datetime import datetime
from pydicom.dataset import Dataset, FileDataset, FileMetaDataset
from pydicom.uid import generate_uid, ExplicitVRLittleEndian
from pydicom.sequence import Sequence


SAMPLE_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "sample_data", "dicom")


def _coded_entry(scheme: str, code: str, meaning: str) -> Dataset:
    """Create a DICOM Coded Entry sequence item.

    DICOM uses coded entries extensively for structured content.
    Each code has three parts: coding scheme, code value, and meaning.

    Args:
        scheme: Coding scheme designator (e.g., "SCT" for SNOMED CT, "LN" for LOINC).
        code: The code value.
        meaning: Human-readable meaning.

    Returns:
        Dataset with coded entry attributes.
    """
    ds = Dataset()
    ds.CodingSchemeDesignator = scheme
    ds.CodeValue = code
    ds.CodeMeaning = meaning
    return ds


def _text_content_item(relationship: str, concept_code: Dataset, text: str) -> Dataset:
    """Create a TEXT content item for the SR tree."""
    item = Dataset()
    item.RelationshipType = relationship
    item.ValueType = "TEXT"
    item.ConceptNameCodeSequence = Sequence([concept_code])
    item.TextValue = text
    return item


def _code_content_item(relationship: str, concept_code: Dataset, value_code: Dataset) -> Dataset:
    """Create a CODE content item for the SR tree."""
    item = Dataset()
    item.RelationshipType = relationship
    item.ValueType = "CODE"
    item.ConceptNameCodeSequence = Sequence([concept_code])
    item.ConceptCodeSequence = Sequence([value_code])
    return item


def _num_content_item(relationship: str, concept_code: Dataset,
                      value: float, unit_code: Dataset) -> Dataset:
    """Create a NUM (numeric) content item for the SR tree."""
    item = Dataset()
    item.RelationshipType = relationship
    item.ValueType = "NUM"
    item.ConceptNameCodeSequence = Sequence([concept_code])

    measured = Dataset()
    measured.NumericValue = f"{value:.4f}"
    measured.MeasurementUnitsCodeSequence = Sequence([unit_code])
    item.MeasuredValueSequence = Sequence([measured])

    return item


def build_ai_structured_report(study_metadata: dict,
                                ai_findings: list,
                                ai_system: str = "Radiology AI Engine v3.2") -> Dataset:
    """Build a DICOM Structured Report from AI analysis findings.

    Creates a Comprehensive SR (1.2.840.10008.5.1.4.1.1.88.33) with
    a content tree encoding each AI finding with its coded diagnosis,
    confidence score, and anatomical location. This is the standard
    mechanism for embedding AI results into a PACS workflow.

    Args:
        study_metadata: Dict with study-level DICOM metadata
            (study_instance_uid, accession_number, patient info, etc.)
        ai_findings: List of finding dicts with keys:
            code, description, coding_system, confidence,
            and optionally: location_code, location_description.
        ai_system: Name of the AI system for attribution.

    Returns:
        pydicom Dataset representing the complete DICOM SR.
    """
    filepath = os.path.join(SAMPLE_DIR, "ai_structured_report.dcm")

    # File Meta Information
    file_meta = FileMetaDataset()
    file_meta.MediaStorageSOPClassUID = "1.2.840.10008.5.1.4.1.1.88.33"  # Comprehensive SR
    file_meta.MediaStorageSOPInstanceUID = generate_uid()
    file_meta.TransferSyntaxUID = ExplicitVRLittleEndian

    ds = FileDataset(filepath, {}, file_meta=file_meta, preamble=b"\x00" * 128)

    # Patient Module -- from study metadata
    ds.PatientName = study_metadata.get("patient_name", "DOE^JANE^M")
    ds.PatientID = study_metadata.get("patient_id", "MRN-2024-78432")
    ds.PatientBirthDate = study_metadata.get("patient_dob", "19580312")
    ds.PatientSex = study_metadata.get("patient_sex", "F")

    # Study Module -- same study as the source images
    ds.StudyInstanceUID = study_metadata.get("study_instance_uid", generate_uid())
    ds.StudyDate = study_metadata.get("study_date", "20260115")
    ds.StudyTime = study_metadata.get("study_time", "143025")
    ds.AccessionNumber = study_metadata.get("accession_number", "ACC-20260115-5678")
    ds.ReferringPhysicianName = study_metadata.get("referring_physician", "SMITH^ROBERT^J")
    ds.StudyID = study_metadata.get("study_id", "STUDY-001")

    # Series Module -- new series for the SR
    ds.SeriesInstanceUID = generate_uid()
    ds.SeriesNumber = 99  # Convention: SR series at high number
    ds.Modality = "SR"
    ds.SeriesDescription = "AI Analysis Report"

    # General Equipment
    ds.Manufacturer = "AI_ENGINE"
    ds.InstitutionName = study_metadata.get("institution", "MAIN HOSPITAL")
    ds.StationName = "AI_SERVER"

    # SOP Common
    ds.SOPClassUID = "1.2.840.10008.5.1.4.1.1.88.33"  # Comprehensive SR
    ds.SOPInstanceUID = file_meta.MediaStorageSOPInstanceUID

    now = datetime.now()
    ds.InstanceCreationDate = now.strftime("%Y%m%d")
    ds.InstanceCreationTime = now.strftime("%H%M%S")
    ds.ContentDate = now.strftime("%Y%m%d")
    ds.ContentTime = now.strftime("%H%M%S")

    # SR Document General Module
    ds.CompletionFlag = "COMPLETE"
    ds.VerificationFlag = "UNVERIFIED"  # AI results are unverified until radiologist review

    # Build the SR Content Tree
    # Root container: "AI Analysis Report"
    ds.ValueType = "CONTAINER"
    ds.ConceptNameCodeSequence = Sequence([
        _coded_entry("LN", "18748-4", "Diagnostic Imaging Report")
    ])
    ds.ContinuityOfContent = "SEPARATE"

    content_items = []

    # Preamble: AI system identification
    content_items.append(
        _text_content_item(
            "HAS OBS CONTEXT",
            _coded_entry("DCM", "121012", "Device Observer Name"),
            ai_system
        )
    )

    # Each AI finding as a container with coded entries
    for i, finding in enumerate(ai_findings):
        finding_container = Dataset()
        finding_container.RelationshipType = "CONTAINS"
        finding_container.ValueType = "CONTAINER"
        finding_container.ConceptNameCodeSequence = Sequence([
            _coded_entry("DCM", "121071", "Finding")
        ])
        finding_container.ContinuityOfContent = "SEPARATE"

        finding_items = []

        # Finding code (SNOMED CT)
        finding_items.append(
            _code_content_item(
                "CONTAINS",
                _coded_entry("SCT", "404684003", "Clinical finding"),
                _coded_entry(
                    finding.get("coding_system", "SCT"),
                    finding["code"],
                    finding["description"]
                )
            )
        )

        # Confidence score
        if finding.get("confidence") is not None:
            finding_items.append(
                _num_content_item(
                    "CONTAINS",
                    _coded_entry("SCT", "397003", "Degree of certainty"),
                    finding["confidence"],
                    _coded_entry("UCUM", "%", "percent")
                )
            )

        # Anatomical location (if provided)
        if finding.get("location_code"):
            finding_items.append(
                _code_content_item(
                    "HAS CONCEPT MOD",
                    _coded_entry("SCT", "363698007", "Finding site"),
                    _coded_entry(
                        "SCT",
                        finding["location_code"],
                        finding.get("location_description", "")
                    )
                )
            )

        finding_container.ContentSequence = Sequence(finding_items)
        content_items.append(finding_container)

    ds.ContentSequence = Sequence(content_items)

    ds.is_little_endian = True
    ds.is_implicit_VR = False

    return ds


def save_sr(ds: Dataset, filepath: str = None) -> str:
    """Save a DICOM Structured Report to disk.

    Args:
        ds: The SR Dataset.
        filepath: Output path. If not provided, saves to sample_data/dicom/.

    Returns:
        The filepath where the SR was saved.
    """
    if filepath is None:
        os.makedirs(SAMPLE_DIR, exist_ok=True)
        filepath = os.path.join(SAMPLE_DIR, "ai_structured_report.dcm")

    ds.save_as(filepath)
    return filepath
