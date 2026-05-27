"""Tests for HL7v2 message parsing."""

import os
import pytest
from src.hl7_engine.parser import (
    parse_hl7_message,
    identify_message_type,
    extract_patient_demographics,
    extract_order_details,
    extract_results,
    extract_ai_findings,
)

SAMPLE_DIR = os.path.join(os.path.dirname(__file__), "..", "sample_data", "hl7")


def _load_sample(filename):
    path = os.path.join(SAMPLE_DIR, filename)
    with open(path, "r") as f:
        return f.read()


class TestParseMessage:
    def test_parse_orm(self):
        raw = _load_sample("orm_o01_order.hl7")
        msg = parse_hl7_message(raw)
        assert msg is not None
        msg_type, trigger = identify_message_type(msg)
        assert msg_type == "ORM"
        assert trigger == "O01"

    def test_parse_oru(self):
        raw = _load_sample("oru_r01_chest_xray.hl7")
        msg = parse_hl7_message(raw)
        msg_type, trigger = identify_message_type(msg)
        assert msg_type == "ORU"
        assert trigger == "R01"

    def test_parse_adt(self):
        raw = _load_sample("adt_a08_update.hl7")
        msg = parse_hl7_message(raw)
        msg_type, trigger = identify_message_type(msg)
        assert msg_type == "ADT"
        assert trigger == "A08"


class TestExtractPatientDemographics:
    def test_demographics_from_orm(self):
        raw = _load_sample("orm_o01_order.hl7")
        msg = parse_hl7_message(raw)
        patient = extract_patient_demographics(msg)

        assert patient["mrn"] == "MRN-2024-78432"
        assert patient["last_name"] == "DOE"
        assert patient["first_name"] == "JANE"
        assert patient["middle_name"] == "M"
        assert patient["dob"] == "19580312"
        assert patient["sex"] == "F"

    def test_demographics_from_adt(self):
        raw = _load_sample("adt_a08_update.hl7")
        msg = parse_hl7_message(raw)
        patient = extract_patient_demographics(msg)

        # ADT A08 has updated address
        assert patient["mrn"] == "MRN-2024-78432"
        assert patient["address"]["street"] == "456 MAPLE DRIVE"
        assert patient["address"]["city"] == "NASHVILLE"


class TestExtractOrderDetails:
    def test_order_from_orm(self):
        raw = _load_sample("orm_o01_order.hl7")
        msg = parse_hl7_message(raw)
        order = extract_order_details(msg)

        assert order["placer_order_number"] == "ORD-20260115-001"
        assert order["procedure_code"] == "71020"
        assert order["procedure_description"] == "CHEST 2 VIEWS"
        assert order["procedure_coding_system"] == "CPT"
        assert order["order_status"] == "NW"  # New Order
        assert order["accession_number"] == "ACC-20260115-5678"
        assert order["modality"] == "CR"


class TestExtractResults:
    def test_results_from_oru(self):
        raw = _load_sample("oru_r01_chest_xray.hl7")
        msg = parse_hl7_message(raw)
        results = extract_results(msg)

        # Should have 7 OBX segments
        assert len(results) == 7

        # First OBX: narrative text
        assert results[0]["value_type"] == "TX"
        assert "pneumonia" in results[0]["value"].lower()

        # Second OBX: coded finding
        assert results[1]["value_type"] == "CE"
        assert "128601007" in results[1]["value"]  # SNOMED for pneumonia

    def test_ai_findings_extraction(self):
        raw = _load_sample("oru_r01_chest_xray.hl7")
        msg = parse_hl7_message(raw)
        findings = extract_ai_findings(msg)

        assert len(findings) == 2

        # First finding: pneumonia
        pneumonia = findings[0]
        assert pneumonia["code"] == "128601007"
        assert "pneumonia" in pneumonia["description"].lower()
        assert pneumonia["confidence"] == 0.92

        # Second finding: pleural effusion
        effusion = findings[1]
        assert effusion["code"] == "60046008"
        assert "pleural effusion" in effusion["description"].lower()
        assert effusion["confidence"] == 0.87
