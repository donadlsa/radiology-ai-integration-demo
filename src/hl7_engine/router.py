"""
HL7v2 Message Router

Simulates interface engine routing logic -- the rules that determine
which systems receive which messages based on message type, content,
and facility configuration. This is the operational core of any
healthcare integration engine (Mirth Connect, Cloverleaf, Rhapsody).
"""

from hl7apy.core import Message
from src.hl7_engine.parser import identify_message_type, extract_order_details


# Default routing table: maps (message_type, trigger_event) to destinations
DEFAULT_ROUTING_TABLE = {
    ("ORM", "O01"): ["PACS", "RIS"],
    ("ORU", "R01"): ["EHR", "RIS", "CRITICAL_ALERT"],
    ("ADT", "A01"): ["RIS", "PACS"],           # Admit
    ("ADT", "A08"): ["RIS", "PACS"],           # Update
    ("ADT", "A04"): ["RIS"],                    # Register
    ("ADT", "A03"): ["RIS", "PACS"],           # Discharge
    ("ACK", ""):    [],                         # ACKs don't route further
}

# Modality-to-system routing: which systems care about which modalities
MODALITY_ROUTING = {
    "CR": ["PACS", "AI_ENGINE"],       # Chest X-ray -> AI for analysis
    "CT": ["PACS", "AI_ENGINE"],       # CT -> AI for analysis
    "MR": ["PACS"],                     # MR -> PACS only (AI support varies)
    "US": ["PACS"],                     # Ultrasound
    "DX": ["PACS", "AI_ENGINE"],       # Digital X-ray -> AI
    "MG": ["PACS", "AI_ENGINE"],       # Mammography -> AI
}


def route_message(msg: Message, routing_table: dict = None) -> list:
    """Determine destination systems for a message based on type routing.

    This is the first-level routing decision: which systems should receive
    this message based on its type and trigger event.

    Args:
        msg: Parsed HL7v2 message.
        routing_table: Optional custom routing table. Uses DEFAULT_ROUTING_TABLE
                      if not provided.

    Returns:
        List of destination system identifiers.
    """
    table = routing_table or DEFAULT_ROUTING_TABLE
    msg_type, trigger = identify_message_type(msg)
    return list(table.get((msg_type, trigger), []))


def route_by_modality(msg: Message, modality_map: dict = None) -> list:
    """Route based on imaging modality from the order details.

    Second-level routing: for radiology orders, determine which systems
    should receive the study based on the imaging modality. This is how
    AI engines like Annalise.ai receive only the modalities they support.

    Args:
        msg: Parsed HL7v2 message with OBR segment.
        modality_map: Optional custom modality routing map.

    Returns:
        List of destination system identifiers for the modality.
    """
    mmap = modality_map or MODALITY_ROUTING
    order = extract_order_details(msg)
    modality = order.get("modality", "").upper()
    return list(mmap.get(modality, ["PACS"]))


def apply_routing_rules(msg: Message, rules: list) -> dict:
    """Apply a list of routing rules to determine message handling.

    Rules are evaluated in order. Each rule can filter, transform, or
    route the message. This models the rule-based processing that
    interface engines use for complex routing decisions.

    Args:
        msg: Parsed HL7v2 message.
        rules: List of rule dicts, each with:
            - name: Rule identifier
            - condition: Dict with field/operator/value for matching
            - action: "route", "filter", or "transform"
            - destination: Target system (for route actions)
            - priority: "normal", "stat", or "critical"

    Returns:
        Dictionary with:
            - destinations: List of target systems
            - filtered: Whether the message was filtered out
            - priority: Highest priority assigned by any rule
            - matched_rules: Names of rules that matched
    """
    result = {
        "destinations": [],
        "filtered": False,
        "priority": "normal",
        "matched_rules": [],
    }

    msg_type, trigger = identify_message_type(msg)
    order = extract_order_details(msg)

    for rule in rules:
        condition = rule.get("condition", {})
        matched = True

        # Evaluate condition
        field = condition.get("field", "")
        operator = condition.get("operator", "equals")
        expected = condition.get("value", "")

        # Resolve the field value from the message
        actual = ""
        if field == "message_type":
            actual = msg_type
        elif field == "trigger_event":
            actual = trigger
        elif field == "procedure_code":
            actual = order.get("procedure_code", "")
        elif field == "modality":
            actual = order.get("modality", "")
        elif field == "ordering_provider":
            actual = order.get("ordering_provider", "")

        if operator == "equals":
            matched = actual == expected
        elif operator == "contains":
            matched = expected in actual
        elif operator == "in":
            matched = actual in (expected if isinstance(expected, list) else [expected])
        elif operator == "not_equals":
            matched = actual != expected

        if not matched:
            continue

        result["matched_rules"].append(rule.get("name", "unnamed"))

        action = rule.get("action", "route")
        if action == "filter":
            result["filtered"] = True
            break
        elif action == "route":
            dest = rule.get("destination", "")
            if dest and dest not in result["destinations"]:
                result["destinations"].append(dest)

        # Escalate priority
        rule_priority = rule.get("priority", "normal")
        priority_order = {"normal": 0, "stat": 1, "critical": 2}
        if priority_order.get(rule_priority, 0) > priority_order.get(result["priority"], 0):
            result["priority"] = rule_priority

    return result


def check_critical_result(msg: Message) -> bool:
    """Check if a result message contains critical findings requiring immediate notification.

    Critical result detection is essential for radiology AI integration --
    AI-detected critical findings (pneumothorax, PE, stroke) must trigger
    immediate alerting workflows per ACR guidelines.

    Args:
        msg: Parsed HL7v2 ORU message.

    Returns:
        True if the message contains critical findings.
    """
    try:
        children = msg.children
    except AttributeError:
        return False

    for child in children:
        if child.name != "OBX":
            continue
        try:
            value = str(child.obx_5.value).upper()
            if "CRITICAL" in value:
                return True
            # Check for known critical SNOMED codes
            critical_codes = {
                "36118008",   # Pneumothorax
                "59282003",   # Pulmonary embolism
                "230690007",  # Cerebrovascular accident (stroke)
                "22298006",   # Myocardial infarction
            }
            code = value.split("^")[0] if "^" in value else value
            if code in critical_codes:
                return True
        except AttributeError:
            continue

    return False
