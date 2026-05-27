"""
DICOM Tag Inspector

Tools for inspecting, modifying, and anonymizing DICOM tags.
Used for troubleshooting routing issues, preparing data for AI
training pipelines (de-identification), and verifying tag values
after system configuration changes.
"""

import copy
from pydicom.dataset import Dataset


# Tags organized by functional category -- how a PACS admin thinks about them
TAG_GROUPS = {
    "patient": [
        "PatientName", "PatientID", "PatientBirthDate", "PatientSex",
        "PatientAge", "PatientWeight",
    ],
    "study": [
        "StudyInstanceUID", "StudyDate", "StudyTime", "StudyDescription",
        "AccessionNumber", "StudyID", "ReferringPhysicianName",
    ],
    "series": [
        "SeriesInstanceUID", "SeriesNumber", "Modality",
        "SeriesDescription", "BodyPartExamined",
    ],
    "equipment": [
        "Manufacturer", "InstitutionName", "StationName",
        "InstitutionalDepartmentName", "ManufacturerModelName",
    ],
    "routing": [
        "SourceApplicationEntityTitle", "InstitutionName",
        "StationName", "Modality", "SOPClassUID",
    ],
    "image": [
        "ImageType", "InstanceNumber", "ContentDate", "ContentTime",
        "Rows", "Columns", "BitsAllocated", "BitsStored",
        "PhotometricInterpretation", "SamplesPerPixel",
    ],
}

# Tags that must be removed or replaced for de-identification (DICOM PS3.15 Basic Profile)
PHI_TAGS = [
    "PatientName", "PatientID", "PatientBirthDate", "PatientAge",
    "PatientAddress", "PatientTelephoneNumbers",
    "ReferringPhysicianName", "ReferringPhysicianTelephoneNumbers",
    "InstitutionName", "InstitutionAddress",
    "StationName", "InstitutionalDepartmentName",
    "PerformingPhysicianName", "NameOfPhysiciansReadingStudy",
    "OperatorsName", "OtherPatientIDs", "OtherPatientNames",
    "AccessionNumber", "StudyID",
]


def inspect_tags(ds: Dataset, tag_group: str = "all") -> dict:
    """Inspect DICOM tags organized by functional category.

    This is the tool reach for when troubleshooting: "Why isn't this
    study routing to the right PACS?" or "Why doesn't this image match
    the order?" The tag groups mirror how integration teams think about
    DICOM metadata.

    Args:
        ds: pydicom Dataset.
        tag_group: Category to inspect ("patient", "study", "series",
                  "equipment", "routing", "image", or "all").

    Returns:
        Dictionary of tag names to their values.
    """
    if tag_group == "all":
        groups = TAG_GROUPS.keys()
    elif tag_group in TAG_GROUPS:
        groups = [tag_group]
    else:
        raise ValueError(f"Unknown tag group: {tag_group}. "
                        f"Valid groups: {', '.join(TAG_GROUPS.keys())}, all")

    result = {}
    seen = set()
    for group in groups:
        for tag_name in TAG_GROUPS[group]:
            if tag_name in seen:
                continue
            seen.add(tag_name)
            value = getattr(ds, tag_name, None)
            if value is not None:
                result[tag_name] = str(value)

    return result


def anonymize_dataset(ds: Dataset, keep_uids: bool = False) -> Dataset:
    """De-identify a DICOM dataset by removing/replacing PHI tags.

    Essential for AI training data pipelines: images sent to AI engines
    for model training must be de-identified per HIPAA Safe Harbor.
    This implements the DICOM Basic De-identification Profile.

    Args:
        ds: pydicom Dataset to anonymize.
        keep_uids: If True, preserve Study/Series/SOP Instance UIDs.
                  Set to True when maintaining study linkage is needed.

    Returns:
        New anonymized Dataset (original is not modified).
    """
    anon = copy.deepcopy(ds)

    # Replace PHI tags
    for tag_name in PHI_TAGS:
        if hasattr(anon, tag_name):
            current = getattr(anon, tag_name)
            if isinstance(current, str):
                setattr(anon, tag_name, "ANONYMIZED")
            else:
                delattr(anon, tag_name)

    # Replace specific tags with safe values
    anon.PatientName = "ANONYMOUS^PATIENT"
    anon.PatientID = "ANON-000000"
    anon.PatientBirthDate = ""
    anon.AccessionNumber = "ANON-ACC"

    # Optionally regenerate UIDs (breaks study linkage but improves anonymity)
    if not keep_uids:
        from pydicom.uid import generate_uid
        anon.StudyInstanceUID = generate_uid()
        anon.SeriesInstanceUID = generate_uid()
        anon.SOPInstanceUID = generate_uid()
        if hasattr(anon, "file_meta"):
            anon.file_meta.MediaStorageSOPInstanceUID = anon.SOPInstanceUID

    # Add de-identification method tag
    anon.DeidentificationMethod = "DICOM Basic De-identification Profile"
    anon.PatientIdentityRemoved = "YES"

    return anon


def fix_routing_tags(ds: Dataset, ae_title: str = None,
                     institution: str = None,
                     station: str = None) -> Dataset:
    """Modify routing-relevant DICOM tags.

    When a modality is misconfigured or images are routing to the wrong
    PACS, these are the tags that need correction. This function modifies
    the routing tags that DICOM routers use to make forwarding decisions.

    Args:
        ds: pydicom Dataset.
        ae_title: New Source Application Entity Title.
        institution: New Institution Name.
        station: New Station Name.

    Returns:
        Modified Dataset (same object, modified in place).
    """
    if ae_title is not None:
        ds.SourceApplicationEntityTitle = ae_title
    if institution is not None:
        ds.InstitutionName = institution
    if station is not None:
        ds.StationName = station

    return ds


def validate_required_tags(ds: Dataset) -> list:
    """Check that required DICOM tags are present and non-empty.

    A basic pre-flight check before sending images to PACS or AI.
    Missing required tags are the #1 cause of DICOM C-STORE failures.

    Args:
        ds: pydicom Dataset.

    Returns:
        List of validation issues (empty if all checks pass).
    """
    issues = []

    required = {
        "PatientName": "Patient name is required for PACS storage",
        "PatientID": "Patient ID (MRN) is required for patient matching",
        "StudyInstanceUID": "Study Instance UID is required for study identification",
        "SeriesInstanceUID": "Series Instance UID is required",
        "SOPInstanceUID": "SOP Instance UID is required",
        "SOPClassUID": "SOP Class UID identifies the type of DICOM object",
        "Modality": "Modality is required for routing",
    }

    for tag, message in required.items():
        value = getattr(ds, tag, None)
        if value is None or str(value).strip() == "":
            issues.append(f"Missing {tag}: {message}")

    return issues
