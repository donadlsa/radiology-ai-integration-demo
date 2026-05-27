# Radiology AI Integration Demo

**HL7v2 | DICOM | FHIR -- Bridging AI Findings and Hospital Infrastructure**

> Demonstrating how radiology AI findings integrate with hospital systems
> through healthcare interoperability standards -- the code behind 22 years
> of hands-on integration experience.

## The Problem This Solves

A radiology AI system detects a critical finding on a chest X-ray. That finding is clinically useless until it reaches the people and systems that can act on it. It needs to flow through three integration pathways simultaneously:

1. **HL7v2 ORU^R01** -- to the RIS and EHR via traditional interface engines
2. **DICOM Structured Report** -- back to PACS so radiologists see it alongside the images
3. **FHIR DiagnosticReport** -- to modern API-based systems and clinical decision support

This project demonstrates hands-on coding for all three standards, connected through an end-to-end pipeline that processes a radiology order, matches it to a DICOM study, applies AI analysis, and delivers results in every format a hospital needs.

## Architecture

```
  Radiology Order          DICOM Image              AI Engine
  (HL7v2 ORM^O01)         (CR/CT/MR)          (Radiology AI v3.2)
        |                      |                      |
        v                      v                      v
  +----------+          +----------+          +--------------+
  | HL7      |          | DICOM    |          | AI Analysis  |
  | Parser   |--------->| Reader   |--------->| Pneumonia    |
  | (ORC/OBR)|  match   | (Tags)   |  route   | Effusion     |
  +----------+          +----------+          +--------------+
                                                     |
                              +-----------------------+
                              |           |           |
                              v           v           v
                        +---------+ +---------+ +---------+
                        | HL7v2   | | DICOM   | | FHIR    |
                        | ORU^R01 | | SR      | | Bundle  |
                        | Builder | | Builder | | Builder |
                        +---------+ +---------+ +---------+
                              |           |           |
                              v           v           v
                           RIS/EHR      PACS     Modern APIs
```

## Quick Start

```bash
# Install dependencies
pip install -r requirements.txt

# Generate synthetic DICOM files
python -m src.dicom_engine.generate_sample

# Run the full integration pipeline
python -m src.integration.pipeline

# Run tests
pytest -v
```

## What This Demonstrates

### HL7v2 Engine (`src/hl7_engine/`)

Parsing, building, routing, and transforming HL7v2 messages -- the standard that still carries 95% of healthcare data.

- **parser.py** -- Parse ORM^O01 orders, ORU^R01 results, and ADT messages. Extract patient demographics (PID), order details (ORC/OBR), and AI findings from OBX segments.
- **builder.py** -- Construct ORU^R01 messages with AI findings encoded as coded (CE), numeric (NM), and text (TX) OBX segments. Build ACK messages for interface handshakes.
- **router.py** -- Interface engine routing logic: route by message type, modality, and custom rules. Critical result detection for immediate alerting.
- **transforms.py** -- Cross-system field mapping: vendor-specific procedure codes to CPT, patient name normalization, HL7-to-FHIR data type conversion.

### DICOM Engine (`src/dicom_engine/`)

Reading, building, and manipulating DICOM objects -- the imaging standard.

- **reader.py** -- Extract study metadata, patient demographics, and routing tags from DICOM files. Compare HL7/DICOM demographics for patient matching validation.
- **sr_builder.py** -- Build DICOM Structured Reports (Comprehensive SR IOD) with coded AI findings, confidence scores, and anatomical locations. This is how AI systems deliver results to PACS.
- **tag_inspector.py** -- Inspect DICOM tags by functional category (patient, routing, equipment). De-identify datasets for AI training pipelines. Validate required tags before transmission.
- **generate_sample.py** -- Generate synthetic DICOM files (CR and CT) with realistic metadata for demo purposes.

### FHIR Engine (`src/fhir_engine/`)

Building FHIR R4 resources -- the modern interoperability standard.

- **resources.py** -- Build Patient, ServiceRequest, ImagingStudy, Observation, and DiagnosticReport resources with proper LOINC/SNOMED coding and resource references.
- **bundle.py** -- Create FHIR Transaction Bundles for atomic resource submission with structural validation.
- **mapper.py** -- HL7v2-to-FHIR mapping: PID to Patient, OBR to ServiceRequest, ORU to DiagnosticReport + Observations.

### Integration Pipeline (`src/integration/`)

The end-to-end workflow tying all three standards together.

- **pipeline.py** -- Orchestrates the full flow: receive order, match DICOM study, apply AI analysis, generate results in all three formats, route to destinations, and validate cross-format consistency.
- **hl7_to_fhir.py** -- Convert HL7v2 ORU^R01 to a FHIR Transaction Bundle.
- **dicom_to_fhir.py** -- Convert DICOM study metadata to FHIR ImagingStudy.

## Sample Data

All sample data is synthetic -- no real patient information is used.

| File | Standard | Description |
|------|----------|-------------|
| `sample_data/hl7/orm_o01_order.hl7` | HL7v2 | Radiology order for chest X-ray |
| `sample_data/hl7/oru_r01_chest_xray.hl7` | HL7v2 | AI result with coded findings |
| `sample_data/hl7/adt_a08_update.hl7` | HL7v2 | Patient demographic update |
| `sample_data/dicom/chest_xray.dcm` | DICOM | Synthetic CR image |
| `sample_data/dicom/ct_slice_*.dcm` | DICOM | Synthetic CT series (3 slices) |
| `sample_data/dicom/ai_structured_report.dcm` | DICOM | AI findings as Structured Report |
| `sample_data/fhir/*.json` | FHIR R4 | Patient, ServiceRequest, ImagingStudy, Observations, DiagnosticReport |

## Test Coverage

```
tests/
  test_hl7_parser.py      -- Message parsing, field extraction, AI finding grouping
  test_hl7_builder.py      -- Message construction, round-trip validation
  test_dicom_reader.py     -- Metadata extraction, patient matching
  test_dicom_sr.py         -- SR building, tag inspection, de-identification
  test_fhir_resources.py   -- Resource building, bundling, HL7-to-FHIR mapping
  test_pipeline.py         -- End-to-end pipeline, cross-format conversion
```

## Technology

- **Python 3.12** with `hl7apy`, `pydicom`, `fhir.resources`
- **HL7v2 2.5.1** -- ORM, ORU, ADT message types
- **DICOM** -- CR/CT Image Storage, Comprehensive Structured Report
- **FHIR R4** -- Patient, ServiceRequest, ImagingStudy, Observation, DiagnosticReport, Bundle
- **Coding Systems** -- LOINC, SNOMED CT, CPT, DICOM

## About the Author

**Adam Donaldson** | MHA | B.S. (MIS) | R.T.(R) (ARRT)

22 years in healthcare IT -- from performing diagnostic imaging at a Level 1 trauma center to leading enterprise-scale PACS/RIS implementations and building service delivery organizations. 18 multi-vendor PACS implementations across McKesson, Carestream, Agfa, and GE. Hands-on HL7 interface configuration across Epic, Cerner, and Athena. DICOM routing and PACS administration across a 200+ hospital network.

This project demonstrates the coding side of that experience -- the ability to work at the protocol level with the standards that make healthcare integration work.

[LinkedIn](https://linkedin.com/in/adam-drew-donaldson) | adam.donaldson@gmail.com
