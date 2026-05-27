"""
HL7v2 Message Builder

Constructs HL7v2 messages for radiology AI integration workflows.
Primary use case: building ORU^R01 messages that carry AI-detected
findings back to the RIS/EHR, and ACK messages for interface handshakes.
"""

from datetime import datetime
from hl7apy.core import Message, Segment
from hl7apy.consts import VALIDATION_LEVEL


def _timestamp(dt: datetime = None) -> str:
    """Format a datetime as HL7v2 timestamp (YYYYMMDDHHmmss)."""
    dt = dt or datetime.now()
    return dt.strftime("%Y%m%d%H%M%S")


def build_msh(msg: Message, sending_app: str, sending_facility: str,
              receiving_app: str, receiving_facility: str,
              message_type: str, trigger_event: str, structure: str,
              control_id: str, version: str = "2.5.1") -> None:
    """Populate the MSH segment with standard header fields.

    Args:
        msg: The HL7v2 Message object to populate.
        sending_app: Sending Application (MSH-3).
        sending_facility: Sending Facility (MSH-4).
        receiving_app: Receiving Application (MSH-5).
        receiving_facility: Receiving Facility (MSH-6).
        message_type: Message Type (MSH-9.1), e.g. "ORU".
        trigger_event: Trigger Event (MSH-9.2), e.g. "R01".
        structure: Message Structure (MSH-9.3), e.g. "ORU_R01".
        control_id: Message Control ID (MSH-10).
        version: HL7 Version (MSH-12), defaults to "2.5.1".
    """
    msg.msh.msh_3.value = sending_app
    msg.msh.msh_4.value = sending_facility
    msg.msh.msh_5.value = receiving_app
    msg.msh.msh_6.value = receiving_facility
    msg.msh.msh_7.value = _timestamp()
    msg.msh.msh_9.msh_9_1.value = message_type
    msg.msh.msh_9.msh_9_2.value = trigger_event
    msg.msh.msh_9.msh_9_3.value = structure
    msg.msh.msh_10.value = control_id
    msg.msh.msh_11.value = "P"  # Processing ID: Production
    msg.msh.msh_12.value = version


def build_pid(msg: Message, patient: dict) -> None:
    """Add a PID segment with patient demographics.

    Args:
        msg: The HL7v2 Message object.
        patient: Dictionary with keys: mrn, assigning_authority, last_name,
                first_name, middle_name, dob, sex.
    """
    pid = Segment("PID", version="2.5.1")
    pid.pid_1.value = "1"

    # PID-3: Patient Identifier List
    pid.pid_3.pid_3_1.value = patient.get("mrn", "")
    pid.pid_3.pid_3_4.value = patient.get("assigning_authority", "")
    pid.pid_3.pid_3_5.value = "MR"  # Identifier Type: Medical Record Number

    # PID-5: Patient Name
    pid.pid_5.pid_5_1.value = patient.get("last_name", "")
    pid.pid_5.pid_5_2.value = patient.get("first_name", "")
    pid.pid_5.pid_5_3.value = patient.get("middle_name", "")

    # PID-7: Date of Birth
    if patient.get("dob"):
        pid.pid_7.value = patient["dob"]

    # PID-8: Sex
    if patient.get("sex"):
        pid.pid_8.value = patient["sex"]

    msg.add(pid)


def build_obr(msg: Message, order: dict) -> None:
    """Add ORC and OBR segments with order/result details.

    Args:
        msg: The HL7v2 Message object.
        order: Dictionary with keys: placer_order_number, accession_number,
              procedure_code, procedure_description, procedure_coding_system,
              ordering_provider, result_status.
    """
    # ORC segment
    orc = Segment("ORC", version="2.5.1")
    orc.orc_1.value = "RE"  # Order Control: Results/Observations
    orc.orc_2.value = order.get("placer_order_number", "")
    msg.add(orc)

    # OBR segment
    obr = Segment("OBR", version="2.5.1")
    obr.obr_1.value = "1"
    obr.obr_2.value = order.get("placer_order_number", "")

    # OBR-4: Universal Service Identifier
    obr.obr_4.obr_4_1.value = order.get("procedure_code", "")
    obr.obr_4.obr_4_2.value = order.get("procedure_description", "")
    obr.obr_4.obr_4_3.value = order.get("procedure_coding_system", "CPT")

    # OBR-18: Placer Field 1 (Accession Number)
    if order.get("accession_number"):
        obr.obr_18.value = order["accession_number"]

    # OBR-25: Result Status
    obr.obr_25.value = order.get("result_status", "F")  # F = Final

    msg.add(obr)


def add_text_observation(msg: Message, set_id: int, loinc_code: str,
                         loinc_text: str, value: str,
                         status: str = "F") -> None:
    """Add a text (TX) OBX segment -- used for narrative reports and AI summaries.

    Args:
        msg: The HL7v2 Message object.
        set_id: OBX Set ID (sequential within message).
        loinc_code: LOINC code for the observation.
        loinc_text: LOINC code description.
        value: The text observation value.
        status: Observation result status (F=Final, P=Preliminary).
    """
    obx = Segment("OBX", version="2.5.1", validation_level=VALIDATION_LEVEL.TOLERANT)
    obx.obx_1.value = str(set_id)
    obx.obx_2.value = "TX"
    obx.obx_3.obx_3_1.value = loinc_code
    obx.obx_3.obx_3_2.value = loinc_text
    obx.obx_3.obx_3_3.value = "LN"
    obx.obx_5.value = value
    obx.obx_11.value = status
    msg.add(obx)


def add_coded_observation(msg: Message, set_id: int, loinc_code: str,
                          loinc_text: str, finding_code: str,
                          finding_text: str, coding_system: str,
                          sub_id: str = "", status: str = "F") -> None:
    """Add a coded entry (CE) OBX segment -- used for structured AI findings.

    Args:
        msg: The HL7v2 Message object.
        set_id: OBX Set ID.
        loinc_code: LOINC code for the observation identifier.
        loinc_text: LOINC code description.
        finding_code: Code for the finding (e.g., SNOMED CT).
        finding_text: Description of the finding.
        coding_system: Coding system (e.g., "SCT" for SNOMED CT).
        sub_id: Observation Sub-ID for grouping related observations.
        status: Observation result status.
    """
    obx = Segment("OBX", version="2.5.1", validation_level=VALIDATION_LEVEL.TOLERANT)
    obx.obx_1.value = str(set_id)
    obx.obx_2.value = "CE"
    obx.obx_3.obx_3_1.value = loinc_code
    obx.obx_3.obx_3_2.value = loinc_text
    obx.obx_3.obx_3_3.value = "LN"
    if sub_id:
        obx.obx_4.value = sub_id
    # OBX-5 is "varies" type -- encode CE as component-delimited string
    obx.obx_5.value = f"{finding_code}^{finding_text}^{coding_system}"
    obx.obx_11.value = status
    msg.add(obx)


def add_numeric_observation(msg: Message, set_id: int, loinc_code: str,
                            loinc_text: str, value: float,
                            sub_id: str = "", status: str = "F") -> None:
    """Add a numeric (NM) OBX segment -- used for AI confidence scores.

    Args:
        msg: The HL7v2 Message object.
        set_id: OBX Set ID.
        loinc_code: LOINC code for the observation identifier.
        loinc_text: LOINC code description.
        value: Numeric value (e.g., confidence score 0.0-1.0).
        sub_id: Observation Sub-ID for grouping with the coded finding.
        status: Observation result status.
    """
    obx = Segment("OBX", version="2.5.1", validation_level=VALIDATION_LEVEL.TOLERANT)
    obx.obx_1.value = str(set_id)
    obx.obx_2.value = "NM"
    obx.obx_3.obx_3_1.value = loinc_code
    obx.obx_3.obx_3_2.value = loinc_text
    obx.obx_3.obx_3_3.value = "LN"
    if sub_id:
        obx.obx_4.value = sub_id
    obx.obx_5.value = str(value)
    obx.obx_11.value = status
    msg.add(obx)


def build_oru_r01(patient: dict, order: dict, ai_findings: list,
                  narrative: str = "", control_id: str = None) -> Message:
    """Build a complete ORU^R01 message carrying AI radiology results.

    This is the primary output of a radiology AI integration: an HL7v2
    result message that carries AI findings back to the ordering system.
    The message includes:
    - Narrative report text (TX OBX)
    - Coded findings with SNOMED CT codes (CE OBX)
    - Confidence scores paired with each finding (NM OBX)
    - AI analysis summary (TX OBX)

    Args:
        patient: Patient demographics dict (from parser.extract_patient_demographics).
        order: Order details dict (from parser.extract_order_details).
        ai_findings: List of finding dicts, each with keys:
            code, description, coding_system, confidence.
        narrative: Optional narrative report text.
        control_id: Message control ID (auto-generated if not provided).

    Returns:
        Complete HL7v2 ORU^R01 Message object.
    """
    if not control_id:
        control_id = f"AI-{_timestamp()}"

    msg = Message("ORU_R01", version="2.5.1")

    build_msh(msg, "AI_ENGINE", "RADIOLOGY_AI", "RIS", "MAIN_HOSPITAL",
              "ORU", "R01", "ORU_R01", control_id)
    build_pid(msg, patient)
    build_obr(msg, order)

    set_id = 1

    # Narrative report text
    if narrative:
        add_text_observation(msg, set_id, "59776-5", "PROCEDURE FINDINGS", narrative)
        set_id += 1

    # Coded AI findings with confidence scores
    for i, finding in enumerate(ai_findings, start=1):
        sub_id = f"AI-{i}"

        add_coded_observation(
            msg, set_id,
            "59776-5", "PROCEDURE FINDINGS",
            finding["code"], finding["description"],
            finding.get("coding_system", "SCT"),
            sub_id=sub_id
        )
        set_id += 1

        if finding.get("confidence") is not None:
            add_numeric_observation(
                msg, set_id,
                "59776-5", "PROCEDURE FINDINGS",
                finding["confidence"],
                sub_id=f"{sub_id}-CONF"
            )
            set_id += 1

    # AI summary
    if ai_findings:
        summary_parts = []
        for f in ai_findings:
            conf_str = f" (confidence: {f['confidence']})" if f.get("confidence") else ""
            summary_parts.append(f"{f['description']}{conf_str}")
        summary = "AI-assisted analysis. Findings: " + "; ".join(summary_parts)
        add_text_observation(msg, set_id, "82115-7", "AI ANALYSIS SUMMARY", summary)

    return msg


def build_ack(original_msg: Message, ack_code: str = "AA",
              error_msg: str = "") -> Message:
    """Build an ACK message in response to a received message.

    The ACK/NAK handshake is fundamental to reliable HL7v2 integration.
    Every message received should generate an acknowledgment indicating
    whether it was accepted (AA), rejected (AR), or caused an error (AE).

    Args:
        original_msg: The message being acknowledged.
        ack_code: AA (Accept), AR (Reject), AE (Error).
        error_msg: Error description for AR/AE responses.

    Returns:
        ACK Message object.
    """
    msg = Message("ACK", version="2.5.1")

    # Swap sender/receiver from original message
    orig_sending_app = str(original_msg.msh.msh_3.value)
    orig_sending_fac = str(original_msg.msh.msh_4.value)
    orig_receiving_app = str(original_msg.msh.msh_5.value)
    orig_receiving_fac = str(original_msg.msh.msh_6.value)
    orig_control_id = str(original_msg.msh.msh_10.value)

    build_msh(msg, orig_receiving_app, orig_receiving_fac,
              orig_sending_app, orig_sending_fac,
              "ACK", "", "ACK", f"ACK-{_timestamp()}")

    # MSA segment: Message Acknowledgment
    msa = Segment("MSA", version="2.5.1")
    msa.msa_1.value = ack_code
    msa.msa_2.value = orig_control_id
    if error_msg:
        msa.msa_3.value = error_msg
    msg.add(msa)

    return msg
