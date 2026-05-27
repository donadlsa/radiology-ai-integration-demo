"""Tests for the integration pipeline and cross-format conversions."""

import os
from src.integration.pipeline import run_pipeline
from src.integration.hl7_to_fhir import convert_oru_to_fhir_bundle
from src.integration.dicom_to_fhir import convert_dicom_study_to_fhir
from src.dicom_engine.generate_sample import generate_chest_xray

SAMPLE_DIR = os.path.join(os.path.dirname(__file__), "..", "sample_data")


class TestPipeline:
    def test_pipeline_runs(self):
        """Full pipeline executes without errors."""
        results = run_pipeline()
        assert "hl7_oru" in results
        assert "dicom_sr" in results
        assert "fhir_bundle" in results

    def test_pipeline_produces_all_formats(self):
        """Pipeline produces HL7, DICOM SR, and FHIR outputs."""
        results = run_pipeline()
        assert len(results["hl7_oru"]) > 0
        assert results["dicom_sr"].Modality == "SR"
        assert len(results["fhir_bundle"].entry) >= 4


class TestHL7ToFhir:
    def test_convert_oru(self):
        raw = open(os.path.join(SAMPLE_DIR, "hl7", "oru_r01_chest_xray.hl7")).read()
        result = convert_oru_to_fhir_bundle(raw)

        assert result["patient"] is not None
        assert len(result["observations"]) == 2
        assert result["report"] is not None
        assert result["bundle"] is not None


class TestDicomToFhir:
    def test_convert_study(self):
        ds = generate_chest_xray()
        result = convert_dicom_study_to_fhir(ds)

        assert result["patient"] is not None
        assert result["imaging_study"] is not None
