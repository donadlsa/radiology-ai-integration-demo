"""
HL7v2 Data Transforms

Field mapping and data transformation between systems -- the messy
real-world work of healthcare integration. Every hospital has different
code sets, name formats, and identifier schemes. These transforms
handle the normalization needed to route data reliably.
"""

# Procedure code mapping: facility-specific codes to standard CPT
# In production, this would be a database lookup; here we demonstrate the pattern
PROCEDURE_CODE_MAP = {
    "McKesson": {
        "CXR2V": {"cpt": "71046", "description": "Chest X-ray 2 views", "modality": "CR"},
        "CTCHEST": {"cpt": "71260", "description": "CT Chest with contrast", "modality": "CT"},
        "CTHEAD": {"cpt": "70460", "description": "CT Head with contrast", "modality": "CT"},
        "MRBRAIN": {"cpt": "70553", "description": "MRI Brain with and without contrast", "modality": "MR"},
        "CRABDM": {"cpt": "74018", "description": "Abdomen X-ray", "modality": "CR"},
    },
    "GE": {
        "XR_CHEST_2V": {"cpt": "71046", "description": "Chest X-ray 2 views", "modality": "CR"},
        "CT_CHEST_C": {"cpt": "71260", "description": "CT Chest with contrast", "modality": "CT"},
        "CT_HEAD_C": {"cpt": "70460", "description": "CT Head with contrast", "modality": "CT"},
    },
    "Carestream": {
        "CHST2": {"cpt": "71046", "description": "Chest X-ray 2 views", "modality": "CR"},
        "CTCHSTC": {"cpt": "71260", "description": "CT Chest with contrast", "modality": "CT"},
    },
}

# Facility code to routing metadata
FACILITY_MAP = {
    "MAIN_HOSPITAL": {
        "name": "Main Hospital",
        "ae_title": "MAIN_PACS",
        "hl7_sending_facility": "MAIN_HOSPITAL",
        "timezone": "America/Chicago",
        "ehr_system": "Epic",
    },
    "SOUTH_CAMPUS": {
        "name": "South Campus",
        "ae_title": "SOUTH_PACS",
        "hl7_sending_facility": "SOUTH_CAMPUS",
        "timezone": "America/Chicago",
        "ehr_system": "Cerner",
    },
    "OUTPATIENT_CTR": {
        "name": "Outpatient Imaging Center",
        "ae_title": "OP_PACS",
        "hl7_sending_facility": "OUTPATIENT_CTR",
        "timezone": "America/Chicago",
        "ehr_system": "Athena",
    },
}


def map_procedure_code(source_code: str, source_system: str) -> dict:
    """Map a vendor-specific procedure code to standard CPT.

    Every PACS vendor uses different internal procedure codes. When
    integrating across systems (or routing to an AI engine that expects
    standard codes), you need this translation layer.

    Args:
        source_code: The vendor-specific procedure code.
        source_system: The source system name (e.g., "McKesson", "GE").

    Returns:
        Dictionary with cpt, description, and modality. Returns the
        source code as-is if no mapping is found.
    """
    system_map = PROCEDURE_CODE_MAP.get(source_system, {})
    if source_code in system_map:
        return system_map[source_code]

    # Fall through: assume the code is already CPT
    return {
        "cpt": source_code,
        "description": "",
        "modality": "",
    }


def normalize_patient_name(last: str, first: str, middle: str = "") -> dict:
    """Normalize patient name components for consistent matching.

    HL7 name fields are notoriously inconsistent between systems.
    One system sends "SMITH^JOHN^A", another sends "Smith, John A.",
    another sends "smith^john^a^^^". This function normalizes for
    reliable patient matching across interfaces.

    Args:
        last: Last/family name.
        first: First/given name.
        middle: Middle name or initial.

    Returns:
        Dictionary with normalized name components and a match_key
        for comparison across systems.
    """
    def clean(name: str) -> str:
        return name.strip().upper().replace(",", "").replace(".", "")

    normalized = {
        "last_name": clean(last),
        "first_name": clean(first),
        "middle_name": clean(middle),
    }

    # Generate a match key for cross-system comparison
    middle_initial = normalized["middle_name"][0] if normalized["middle_name"] else ""
    normalized["match_key"] = f"{normalized['last_name']}|{normalized['first_name']}|{middle_initial}"

    return normalized


def map_facility(facility_code: str) -> dict:
    """Look up facility routing metadata by code.

    Returns the DICOM AE title, HL7 facility identifier, and other
    routing metadata needed to direct messages and images to the
    correct systems at each facility.

    Args:
        facility_code: The facility identifier from MSH-4 or MSH-6.

    Returns:
        Facility metadata dictionary, or a default if not found.
    """
    return FACILITY_MAP.get(facility_code, {
        "name": facility_code,
        "ae_title": "UNKNOWN",
        "hl7_sending_facility": facility_code,
        "timezone": "UTC",
        "ehr_system": "Unknown",
    })


def map_sex_code(hl7_sex: str) -> str:
    """Map HL7v2 administrative sex to FHIR gender code.

    HL7v2 Table 0001 uses single-character codes (M, F, U, A, N, O).
    FHIR uses full words (male, female, unknown, other).

    Args:
        hl7_sex: HL7v2 sex code.

    Returns:
        FHIR gender string.
    """
    mapping = {
        "M": "male",
        "F": "female",
        "U": "unknown",
        "A": "other",
        "N": "unknown",
        "O": "other",
    }
    return mapping.get(hl7_sex.upper(), "unknown")


def format_hl7_datetime(hl7_dt: str) -> str:
    """Convert HL7v2 datetime (YYYYMMDDHHMMSS) to ISO 8601 format.

    Args:
        hl7_dt: HL7v2 datetime string (variable precision).

    Returns:
        ISO 8601 formatted datetime string.
    """
    if not hl7_dt:
        return ""

    # HL7 datetime can be variable length: YYYY, YYYYMM, YYYYMMDD, etc.
    dt = hl7_dt.strip()
    if len(dt) >= 14:
        return f"{dt[:4]}-{dt[4:6]}-{dt[6:8]}T{dt[8:10]}:{dt[10:12]}:{dt[12:14]}"
    elif len(dt) >= 8:
        return f"{dt[:4]}-{dt[4:6]}-{dt[6:8]}"
    elif len(dt) >= 6:
        return f"{dt[:4]}-{dt[4:6]}"
    elif len(dt) >= 4:
        return dt[:4]
    return dt
