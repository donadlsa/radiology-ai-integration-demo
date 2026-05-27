"""Tests for DICOM file reading and metadata extraction."""

import os
import pytest
from src.dicom_engine.generate_sample import generate_chest_xray, generate_ct_series
from src.dicom_engine.reader import (
    extract_study_metadata,
    extract_patient_info,
    extract_routing_tags,
    compare_hl7_dicom_demographics,
)


class TestExtractStudyMetadata:
    def test_chest_xray_metadata(self):
        ds = generate_chest_xray()
        meta = extract_study_metadata(ds)

        assert meta["modality"] == "CR"
        assert meta["accession_number"] == "ACC-20260115-56"
        assert meta["study_description"] == "CHEST 2 VIEWS"
        assert meta["body_part"] == "CHEST"
        assert meta["study_date"] == "20260115"
        assert len(meta["study_instance_uid"]) > 0

    def test_ct_series_metadata(self):
        series = generate_ct_series(3)
        # All slices share the same Study and Series UIDs
        study_uids = set()
        series_uids = set()
        sop_uids = set()

        for ds in series:
            meta = extract_study_metadata(ds)
            study_uids.add(meta["study_instance_uid"])
            series_uids.add(meta["series_instance_uid"])
            sop_uids.add(meta["sop_instance_uid"])
            assert meta["modality"] == "CT"

        assert len(study_uids) == 1   # Same study
        assert len(series_uids) == 1  # Same series
        assert len(sop_uids) == 3     # Unique per slice


class TestExtractPatientInfo:
    def test_patient_from_chest_xray(self):
        ds = generate_chest_xray()
        patient = extract_patient_info(ds)

        assert patient["patient_id"] == "MRN-2024-78432"
        assert patient["last_name"] == "DOE"
        assert patient["first_name"] == "JANE"
        assert patient["dob"] == "19580312"
        assert patient["sex"] == "F"


class TestExtractRoutingTags:
    def test_routing_tags(self):
        ds = generate_chest_xray()
        routing = extract_routing_tags(ds)

        assert routing["source_ae_title"] == "CR_ROOM1"
        assert routing["institution_name"] == "MAIN HOSPITAL"
        assert routing["modality"] == "CR"
        assert routing["department"] == "RADIOLOGY"


class TestCompareHL7DicomDemographics:
    def test_matching_demographics(self):
        hl7_patient = {
            "mrn": "MRN-2024-78432",
            "last_name": "DOE",
            "first_name": "JANE",
            "middle_name": "M",
            "dob": "19580312",
            "sex": "F",
        }
        ds = generate_chest_xray()
        result = compare_hl7_dicom_demographics(hl7_patient, ds)

        assert result["overall_match"] is True
        assert result["mrn"]["match"] is True
        assert result["last_name"]["match"] is True
        assert result["dob"]["match"] is True

    def test_mismatched_demographics(self):
        hl7_patient = {
            "mrn": "MRN-DIFFERENT",
            "last_name": "SMITH",
            "first_name": "JOHN",
            "dob": "19900101",
            "sex": "M",
        }
        ds = generate_chest_xray()
        result = compare_hl7_dicom_demographics(hl7_patient, ds)

        assert result["overall_match"] is False
        assert result["mrn"]["match"] is False
        assert result["last_name"]["match"] is False
