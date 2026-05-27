"""Tests for DICOM Structured Report building and tag inspection."""

import os
import tempfile
import pydicom
from src.dicom_engine.sr_builder import build_ai_structured_report, save_sr
from src.dicom_engine.tag_inspector import inspect_tags, anonymize_dataset, validate_required_tags


SAMPLE_FINDINGS = [
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

STUDY_METADATA = {
    "patient_name": "DOE^JANE^M",
    "patient_id": "MRN-2024-78432",
    "patient_dob": "19580312",
    "patient_sex": "F",
    "study_instance_uid": "1.2.826.0.1.3680043.8.1055.1.20260115.1",
    "study_date": "20260115",
    "study_time": "143025",
    "accession_number": "ACC-20260115-56",
    "referring_physician": "SMITH^ROBERT^J",
    "study_id": "STUDY-001",
    "institution": "MAIN HOSPITAL",
}


class TestBuildStructuredReport:
    def test_build_sr(self):
        sr = build_ai_structured_report(STUDY_METADATA, SAMPLE_FINDINGS)
        assert sr.Modality == "SR"
        assert sr.SOPClassUID == "1.2.840.10008.5.1.4.1.1.88.33"
        assert sr.CompletionFlag == "COMPLETE"
        assert sr.VerificationFlag == "UNVERIFIED"

    def test_sr_patient_matches_study(self):
        sr = build_ai_structured_report(STUDY_METADATA, SAMPLE_FINDINGS)
        assert str(sr.PatientName) == "DOE^JANE^M"
        assert sr.PatientID == "MRN-2024-78432"
        assert sr.StudyInstanceUID == STUDY_METADATA["study_instance_uid"]

    def test_sr_content_tree(self):
        sr = build_ai_structured_report(STUDY_METADATA, SAMPLE_FINDINGS)
        assert hasattr(sr, "ContentSequence")

        # Root has: 1 observer context + 2 finding containers
        content = sr.ContentSequence
        assert len(content) == 3

        # First item: AI system identification
        assert content[0].ValueType == "TEXT"

        # Second item: pneumonia finding container
        finding1 = content[1]
        assert finding1.ValueType == "CONTAINER"
        assert len(finding1.ContentSequence) == 3  # code + confidence + location

    def test_sr_save_and_reload(self):
        sr = build_ai_structured_report(STUDY_METADATA, SAMPLE_FINDINGS)

        with tempfile.NamedTemporaryFile(suffix=".dcm", delete=False) as f:
            tmppath = f.name

        try:
            save_sr(sr, tmppath)
            reloaded = pydicom.dcmread(tmppath)

            assert reloaded.Modality == "SR"
            assert reloaded.PatientID == "MRN-2024-78432"
            assert len(reloaded.ContentSequence) == 3
        finally:
            os.unlink(tmppath)


class TestTagInspector:
    def test_inspect_patient_tags(self):
        from src.dicom_engine.generate_sample import generate_chest_xray
        ds = generate_chest_xray()
        tags = inspect_tags(ds, "patient")

        assert "PatientName" in tags
        assert "DOE^JANE^M" in tags["PatientName"]
        assert tags["PatientID"] == "MRN-2024-78432"

    def test_inspect_routing_tags(self):
        from src.dicom_engine.generate_sample import generate_chest_xray
        ds = generate_chest_xray()
        tags = inspect_tags(ds, "routing")

        assert tags["Modality"] == "CR"
        assert tags["InstitutionName"] == "MAIN HOSPITAL"


class TestAnonymize:
    def test_anonymize_removes_phi(self):
        from src.dicom_engine.generate_sample import generate_chest_xray
        ds = generate_chest_xray()
        anon = anonymize_dataset(ds)

        assert str(anon.PatientName) == "ANONYMOUS^PATIENT"
        assert anon.PatientID == "ANON-000000"
        assert anon.PatientIdentityRemoved == "YES"

    def test_anonymize_preserves_modality(self):
        from src.dicom_engine.generate_sample import generate_chest_xray
        ds = generate_chest_xray()
        anon = anonymize_dataset(ds)

        assert anon.Modality == "CR"
        assert anon.Rows == 256

    def test_anonymize_regenerates_uids(self):
        from src.dicom_engine.generate_sample import generate_chest_xray
        ds = generate_chest_xray()
        original_study_uid = ds.StudyInstanceUID
        anon = anonymize_dataset(ds, keep_uids=False)

        assert anon.StudyInstanceUID != original_study_uid


class TestValidateRequiredTags:
    def test_valid_dataset(self):
        from src.dicom_engine.generate_sample import generate_chest_xray
        ds = generate_chest_xray()
        issues = validate_required_tags(ds)
        assert len(issues) == 0

    def test_missing_tags(self):
        from pydicom.dataset import Dataset
        ds = Dataset()
        ds.Modality = "CR"
        issues = validate_required_tags(ds)
        assert len(issues) > 0
        assert any("PatientName" in i for i in issues)
