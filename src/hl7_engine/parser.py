"""
HL7v2 Message Parser

Parses raw HL7v2 messages into structured data for downstream processing.
Supports ORM^O01 (orders), ORU^R01 (results), and ADT messages commonly
encountered in radiology integration workflows.
"""

from hl7apy.parser import parse_message
from hl7apy.core import Message
from hl7apy.exceptions import HL7apyException


def parse_hl7_message(raw_message: str) -> Message:
    """Parse a raw HL7v2 message string into an hl7apy Message object.

    Args:
        raw_message: Raw HL7v2 message with \\r or \\n segment delimiters.

    Returns:
        Parsed hl7apy Message object.
    """
    cleaned = raw_message.strip()
    # HL7v2 uses \r as segment delimiter; normalize from file line endings
    if "\n" in cleaned and "\r" not in cleaned:
        cleaned = cleaned.replace("\n", "\r")
    elif "\r\n" in cleaned:
        cleaned = cleaned.replace("\r\n", "\r")

    return parse_message(cleaned, find_groups=False)


def identify_message_type(msg: Message) -> tuple:
    """Extract message type and trigger event from MSH-9.

    Args:
        msg: Parsed HL7v2 message.

    Returns:
        Tuple of (message_type, trigger_event), e.g. ("ORM", "O01").
    """
    msh9 = msg.msh.msh_9
    msg_type = str(msh9.msh_9_1.value) if msh9.msh_9_1 else ""
    trigger = str(msh9.msh_9_2.value) if msh9.msh_9_2 else ""
    return (msg_type, trigger)


def extract_patient_demographics(msg: Message) -> dict:
    """Extract patient demographics from the PID segment.

    Pulls the fields that matter for patient matching and routing:
    MRN, name, date of birth, sex, address, and phone.

    Args:
        msg: Parsed HL7v2 message containing a PID segment.

    Returns:
        Dictionary with patient demographic fields.
    """
    pid = msg.pid

    # PID-3: Patient Identifier List (MRN)
    mrn = ""
    assigning_authority = ""
    try:
        pid3 = pid.pid_3
        mrn = str(pid3.pid_3_1.value) if pid3.pid_3_1 else ""
        assigning_authority = str(pid3.pid_3_4.value) if pid3.pid_3_4 else ""
    except (AttributeError, HL7apyException):
        pass

    # PID-5: Patient Name
    last_name = first_name = middle_name = ""
    try:
        pid5 = pid.pid_5
        last_name = str(pid5.pid_5_1.value) if pid5.pid_5_1 else ""
        first_name = str(pid5.pid_5_2.value) if pid5.pid_5_2 else ""
        middle_name = str(pid5.pid_5_3.value) if pid5.pid_5_3 else ""
    except (AttributeError, HL7apyException):
        pass

    # PID-7: Date of Birth
    dob = ""
    try:
        dob = str(pid.pid_7.value) if pid.pid_7 else ""
    except (AttributeError, HL7apyException):
        pass

    # PID-8: Sex
    sex = ""
    try:
        sex = str(pid.pid_8.value) if pid.pid_8 else ""
    except (AttributeError, HL7apyException):
        pass

    # PID-11: Address
    address = {}
    try:
        pid11 = pid.pid_11
        address = {
            "street": str(pid11.pid_11_1.value) if pid11.pid_11_1 else "",
            "city": str(pid11.pid_11_3.value) if pid11.pid_11_3 else "",
            "state": str(pid11.pid_11_4.value) if pid11.pid_11_4 else "",
            "zip": str(pid11.pid_11_5.value) if pid11.pid_11_5 else "",
        }
    except (AttributeError, HL7apyException):
        pass

    # PID-13: Phone
    phone = ""
    try:
        phone = str(pid.pid_13.value) if pid.pid_13 else ""
    except (AttributeError, HL7apyException):
        pass

    return {
        "mrn": mrn,
        "assigning_authority": assigning_authority,
        "last_name": last_name,
        "first_name": first_name,
        "middle_name": middle_name,
        "dob": dob,
        "sex": sex,
        "address": address,
        "phone": phone,
    }


def extract_order_details(msg: Message) -> dict:
    """Extract order details from ORC and OBR segments.

    Pulls accession number, procedure code, ordering provider, and
    order timing -- the fields needed for radiology workflow routing.

    Args:
        msg: Parsed HL7v2 message containing ORC/OBR segments.

    Returns:
        Dictionary with order detail fields.
    """
    result = {
        "placer_order_number": "",
        "accession_number": "",
        "procedure_code": "",
        "procedure_description": "",
        "procedure_coding_system": "",
        "ordering_provider": "",
        "order_status": "",
        "modality": "",
        "scheduled_datetime": "",
    }

    # ORC segment
    try:
        orc = msg.orc
        result["placer_order_number"] = str(orc.orc_2.value) if orc.orc_2 else ""
        result["order_status"] = str(orc.orc_1.value) if orc.orc_1 else ""
    except (AttributeError, HL7apyException):
        pass

    # OBR segment
    try:
        obr = msg.obr
        # OBR-4: Universal Service Identifier (procedure code)
        try:
            obr4 = obr.obr_4
            result["procedure_code"] = str(obr4.obr_4_1.value) if obr4.obr_4_1 else ""
            result["procedure_description"] = str(obr4.obr_4_2.value) if obr4.obr_4_2 else ""
            result["procedure_coding_system"] = str(obr4.obr_4_3.value) if obr4.obr_4_3 else ""
        except (AttributeError, HL7apyException):
            pass

        # OBR-16: Ordering Provider (hl7apy: obr_16)
        try:
            obr16 = obr.obr_16
            raw_val = str(obr16.value) if obr16 else ""
            if raw_val:
                parts = raw_val.split("^")
                provider_id = parts[0] if len(parts) > 0 else ""
                provider_last = parts[1] if len(parts) > 1 else ""
                provider_first = parts[2] if len(parts) > 2 else ""
                result["ordering_provider"] = f"{provider_last}, {provider_first} ({provider_id})"
        except (AttributeError, HL7apyException):
            pass

        # OBR-18: Placer Field 1 / Accession Number (hl7apy: obr_18)
        try:
            result["accession_number"] = str(obr.obr_18.value) if obr.obr_18 else ""
        except (AttributeError, HL7apyException):
            pass

        # OBR-24: Diagnostic Service Section ID / modality (hl7apy: obr_24)
        try:
            result["modality"] = str(obr.obr_24.value) if obr.obr_24 else ""
        except (AttributeError, HL7apyException):
            pass

    except (AttributeError, HL7apyException):
        pass

    return result


def extract_results(msg: Message) -> list:
    """Extract observation results from OBX segments.

    Handles the three OBX data types commonly seen in radiology AI results:
    - TX/FT: Narrative text (radiology report, AI summary)
    - CE: Coded entries (SNOMED finding codes)
    - NM: Numeric values (AI confidence scores)

    Args:
        msg: Parsed HL7v2 message containing OBX segments.

    Returns:
        List of dictionaries, one per OBX segment.
    """
    results = []
    try:
        children = msg.children
    except (AttributeError, HL7apyException):
        return results

    for child in children:
        if child.name != "OBX":
            continue

        obx = child
        observation = {
            "set_id": "",
            "value_type": "",
            "observation_id": "",
            "observation_id_text": "",
            "observation_sub_id": "",
            "value": "",
            "units": "",
            "status": "",
        }

        try:
            observation["set_id"] = str(obx.obx_1.value) if obx.obx_1 else ""
        except (AttributeError, HL7apyException):
            pass

        try:
            observation["value_type"] = str(obx.obx_2.value) if obx.obx_2 else ""
        except (AttributeError, HL7apyException):
            pass

        # OBX-3: Observation Identifier
        try:
            obx3 = obx.obx_3
            observation["observation_id"] = str(obx3.obx_3_1.value) if obx3.obx_3_1 else ""
            observation["observation_id_text"] = str(obx3.obx_3_2.value) if obx3.obx_3_2 else ""
        except (AttributeError, HL7apyException):
            pass

        # OBX-4: Observation Sub-ID (used to group AI findings)
        try:
            observation["observation_sub_id"] = str(obx.obx_4.value) if obx.obx_4 else ""
        except (AttributeError, HL7apyException):
            pass

        # OBX-5: Observation Value
        try:
            observation["value"] = str(obx.obx_5.value) if obx.obx_5 else ""
        except (AttributeError, HL7apyException):
            pass

        # OBX-6: Units
        try:
            observation["units"] = str(obx.obx_6.value) if obx.obx_6 else ""
        except (AttributeError, HL7apyException):
            pass

        # OBX-11: Observation Result Status
        try:
            observation["status"] = str(obx.obx_11.value) if obx.obx_11 else ""
        except (AttributeError, HL7apyException):
            pass

        results.append(observation)

    return results


def extract_ai_findings(msg: Message) -> list:
    """Extract structured AI findings from OBX segments.

    Groups related OBX segments by observation sub-ID to reconstruct
    AI findings with their associated confidence scores. This is the
    pattern used when an AI engine embeds its results in an ORU^R01:
    - CE OBX: The coded finding (SNOMED)
    - NM OBX: The confidence score (same sub-ID with -CONF suffix)

    Args:
        msg: Parsed HL7v2 message with AI result OBX segments.

    Returns:
        List of AI finding dictionaries with code, description,
        coding_system, and confidence fields.
    """
    observations = extract_results(msg)

    # Group by base sub-ID (strip -CONF suffix)
    findings_map = {}
    for obs in observations:
        sub_id = obs.get("observation_sub_id", "")
        if not sub_id:
            continue

        base_id = sub_id.replace("-CONF", "")

        if base_id not in findings_map:
            findings_map[base_id] = {"code": "", "description": "", "coding_system": "", "confidence": None}

        if sub_id.endswith("-CONF") and obs["value_type"] == "NM":
            try:
                findings_map[base_id]["confidence"] = float(obs["value"])
            except (ValueError, TypeError):
                pass
        elif obs["value_type"] == "CE":
            # CE value format: code^description^coding_system
            value = obs["value"]
            parts = value.split("^") if "^" in value else [value]
            findings_map[base_id]["code"] = parts[0] if len(parts) > 0 else ""
            findings_map[base_id]["description"] = parts[1] if len(parts) > 1 else ""
            findings_map[base_id]["coding_system"] = parts[2] if len(parts) > 2 else ""

    return [f for f in findings_map.values() if f["code"]]
