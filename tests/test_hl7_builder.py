"""Tests for HL7v2 message building."""

import pytest
from src.hl7_engine.builder import build_oru_r01, build_ack
from src.hl7_engine.parser import (
    parse_hl7_message,
    identify_message_type,
    extract_patient_demographics,
    extract_results,
    extract_ai_findings,
)


SAMPLE_PATIENT = {
    "mrn": "MRN-2024-78432",
    "assigning_authority": "MAIN_HOSPITAL",
    "last_name": "DOE",
    "first_name": "JANE",
    "middle_name": "M",
    "dob": "19580312",
    "sex": "F",
}

SAMPLE_ORDER = {
    "placer_order_number": "ORD-20260115-001",
    "accession_number": "ACC-20260115-5678",
    "procedure_code": "71020",
    "procedure_description": "CHEST 2 VIEWS",
    "procedure_coding_system": "CPT",
}

SAMPLE_FINDINGS = [
    {
        "code": "128601007",
        "description": "Infectious pneumonia",
        "coding_system": "SCT",
        "confidence": 0.92,
    },
    {
        "code": "60046008",
        "description": "Pleural effusion",
        "coding_system": "SCT",
        "confidence": 0.87,
    },
]


class TestBuildOruR01:
    def test_build_basic_oru(self):
        msg = build_oru_r01(SAMPLE_PATIENT, SAMPLE_ORDER, SAMPLE_FINDINGS,
                            narrative="Test report narrative.")

        # Verify it serializes without error
        raw = msg.to_er7()
        assert "MSH|" in raw
        assert "ORU^R01" in raw

    def test_round_trip_parse(self):
        """Build a message, serialize it, re-parse it, and verify fields."""
        msg = build_oru_r01(SAMPLE_PATIENT, SAMPLE_ORDER, SAMPLE_FINDINGS,
                            narrative="Test report narrative.",
                            control_id="TEST-001")

        raw = msg.to_er7()
        reparsed = parse_hl7_message(raw)

        msg_type, trigger = identify_message_type(reparsed)
        assert msg_type == "ORU"
        assert trigger == "R01"

        patient = extract_patient_demographics(reparsed)
        assert patient["mrn"] == "MRN-2024-78432"
        assert patient["last_name"] == "DOE"

    def test_ai_findings_in_obx(self):
        """Verify AI findings are encoded as CE+NM OBX pairs."""
        msg = build_oru_r01(SAMPLE_PATIENT, SAMPLE_ORDER, SAMPLE_FINDINGS)
        raw = msg.to_er7()
        reparsed = parse_hl7_message(raw)

        results = extract_results(reparsed)
        # Should have: OBX for each finding (CE) + confidence (NM) + summary (TX)
        ce_segments = [r for r in results if r["value_type"] == "CE"]
        nm_segments = [r for r in results if r["value_type"] == "NM"]

        assert len(ce_segments) == 2  # Two coded findings
        assert len(nm_segments) == 2  # Two confidence scores

    def test_message_with_no_narrative(self):
        msg = build_oru_r01(SAMPLE_PATIENT, SAMPLE_ORDER, SAMPLE_FINDINGS)
        raw = msg.to_er7()
        assert "MSH|" in raw


class TestBuildAck:
    def test_build_ack_accept(self):
        original = build_oru_r01(SAMPLE_PATIENT, SAMPLE_ORDER, SAMPLE_FINDINGS,
                                 control_id="ORIG-001")
        ack = build_ack(original, ack_code="AA")
        raw = ack.to_er7()

        assert "ACK" in raw
        assert "AA" in raw
        assert "ORIG-001" in raw

    def test_build_ack_reject(self):
        original = build_oru_r01(SAMPLE_PATIENT, SAMPLE_ORDER, SAMPLE_FINDINGS,
                                 control_id="ORIG-002")
        ack = build_ack(original, ack_code="AR", error_msg="Patient not found")
        raw = ack.to_er7()

        assert "AR" in raw
        assert "Patient not found" in raw
