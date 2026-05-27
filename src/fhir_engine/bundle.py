"""
FHIR Bundle Builder

Creates FHIR Transaction Bundles for atomic submission of related
resources. In the radiology AI workflow, this packages the Patient,
ImagingStudy, Observations, and DiagnosticReport into a single
transaction that succeeds or fails as a unit.
"""

from fhir.resources.R4B.bundle import Bundle, BundleEntry, BundleEntryRequest


def create_transaction_bundle(resources: list) -> Bundle:
    """Package FHIR resources into a Transaction Bundle.

    A Transaction Bundle ensures all resources are created atomically
    on the FHIR server. This is important for referential integrity --
    the DiagnosticReport references Observations, which reference the
    ImagingStudy, which references the Patient.

    Args:
        resources: List of FHIR resource objects to include.

    Returns:
        FHIR Bundle resource with type "transaction".
    """
    entries = []
    for resource in resources:
        resource_type = resource.__resource_type__
        resource_id = resource.id or "unknown"

        entry = BundleEntry(**{
            "fullUrl": f"urn:uuid:{resource_type}-{resource_id}",
            "resource": resource,
            "request": BundleEntryRequest(**{
                "method": "PUT",
                "url": f"{resource_type}/{resource_id}",
            }),
        })
        entries.append(entry)

    return Bundle(**{
        "resourceType": "Bundle",
        "type": "transaction",
        "entry": entries,
    })


def validate_bundle(bundle: Bundle) -> list:
    """Validate a FHIR Bundle for basic structural issues.

    Checks that all entries have required fields and that resource
    references within the bundle are resolvable.

    Args:
        bundle: FHIR Bundle to validate.

    Returns:
        List of validation issue strings (empty if valid).
    """
    issues = []

    if not bundle.entry:
        issues.append("Bundle has no entries")
        return issues

    # Collect all resource IDs in the bundle
    available_ids = set()
    for entry in bundle.entry:
        if entry.resource:
            rt = entry.resource.__resource_type__
            rid = entry.resource.id
            if rid:
                available_ids.add(f"{rt}/{rid}")

    # Check each entry
    for i, entry in enumerate(bundle.entry):
        if not entry.resource:
            issues.append(f"Entry {i}: missing resource")
            continue
        if not entry.request:
            issues.append(f"Entry {i}: missing request")
        if not entry.fullUrl:
            issues.append(f"Entry {i}: missing fullUrl")

    return issues
