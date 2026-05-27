"""
Healthcare Integration Operations Dashboard
Flask application serving HTML pages and JSON API endpoints
for monitoring HL7/DICOM/FHIR integration workflows.
"""

import importlib
import json
import os
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Path setup – allow imports from the project-level src/ package
# ---------------------------------------------------------------------------
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from datetime import datetime
from flask import Flask, jsonify, redirect, render_template, request, url_for

# ---------------------------------------------------------------------------
# Engine imports
# ---------------------------------------------------------------------------
from src.hl7_engine.parser import (
    extract_ai_findings,
    extract_order_details,
    extract_patient_demographics,
    extract_results,
    identify_message_type,
    parse_hl7_message,
)
from src.dicom_engine.reader import (
    extract_patient_info,
    extract_study_metadata,
    read_dicom,
)
from src.dicom_engine.tag_inspector import inspect_tags, validate_required_tags

# ---------------------------------------------------------------------------
# Application factory helpers
# ---------------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BASE_DIR.parent
MOCK_DATA_DIR = BASE_DIR / "mock_data"
SAMPLE_DATA_DIR = PROJECT_DIR / "sample_data"

app = Flask(
    __name__,
    static_folder=str(BASE_DIR / "static"),
    template_folder=str(BASE_DIR / "templates"),
)


@app.context_processor
def inject_now():
    return {"now": datetime.utcnow()}


# ---------------------------------------------------------------------------
# Mock-data loaders (cached on first access)
# ---------------------------------------------------------------------------
_cache: dict = {}


def _load_json(filename: str) -> list | dict:
    """Load a JSON file from the mock_data directory, caching the result."""
    if filename not in _cache:
        filepath = MOCK_DATA_DIR / filename
        with open(filepath, "r", encoding="utf-8") as fh:
            _cache[filename] = json.load(fh)
    return _cache[filename]


def get_customers() -> list:
    return _load_json("customers.json")


def get_incidents() -> list:
    return _load_json("incidents.json")


def get_slo_metrics() -> list:
    return _load_json("slo_metrics.json")


# ===================================================================
# Page routes
# ===================================================================

@app.route("/")
def index():
    return redirect(url_for("overview"))


@app.route("/overview")
def overview():
    return render_template("overview.html")


@app.route("/customer/<customer_id>")
def customer_detail(customer_id: str):
    return render_template("customer_detail.html", customer_id=customer_id)


@app.route("/diagnostics")
def diagnostics():
    return render_template("diagnostics.html")


@app.route("/slo")
def slo():
    return render_template("slo.html")


@app.route("/registry")
def registry():
    return render_template("registry.html")


@app.route("/runbooks")
def runbooks():
    return render_template("runbooks.html")


@app.route("/flow-tracer")
def flow_tracer():
    return render_template("flow_tracer.html")


@app.route("/incidents")
def incidents_page():
    return render_template("incidents.html")


@app.route("/coverage")
def coverage():
    return render_template("coverage.html")


@app.route("/patterns")
def patterns():
    return render_template("patterns.html")


@app.route("/self-service")
def self_service():
    return render_template("self_service.html")


@app.route("/executive")
def executive():
    return render_template("executive.html")


# ===================================================================
# Data API routes
# ===================================================================

@app.route("/api/customers")
def api_customers():
    return jsonify(get_customers())


@app.route("/api/customers/<customer_id>")
def api_customer_detail(customer_id: str):
    customers = get_customers()
    customer = next(
        (c for c in customers if str(c.get("id")) == str(customer_id)),
        None,
    )
    if customer is None:
        return jsonify({"error": f"Customer '{customer_id}' not found"}), 404

    # Collect related incidents and SLO metrics for this customer
    incidents = [
        i for i in get_incidents()
        if str(i.get("customer_id")) == str(customer_id)
    ]
    slo_metrics = [
        m for m in get_slo_metrics()
        if str(m.get("customer_id")) == str(customer_id)
    ]

    return jsonify({
        "customer": customer,
        "incidents": incidents,
        "slo_metrics": slo_metrics,
    })


@app.route("/api/slo")
def api_slo():
    return jsonify(get_slo_metrics())


@app.route("/api/incidents")
def api_incidents():
    return jsonify(get_incidents())


# ===================================================================
# Diagnostic API routes
# ===================================================================

@app.route("/api/diagnostics/parse-hl7", methods=["POST"])
def api_parse_hl7():
    """Parse a raw HL7 v2.x message and return structured data."""
    try:
        data = request.get_json(force=True)
        raw_message = data.get("raw_message", "")
        if not raw_message:
            return jsonify({"success": False, "error": "raw_message is required"}), 400

        msg = parse_hl7_message(raw_message)
        msg_type, trigger = identify_message_type(msg)
        demographics = extract_patient_demographics(msg)
        orders = extract_order_details(msg)
        results = extract_results(msg)
        ai_findings = extract_ai_findings(msg)

        return jsonify({
            "success": True,
            "message_type": msg_type,
            "trigger_event": trigger,
            "demographics": demographics,
            "orders": orders,
            "results": results,
            "ai_findings": ai_findings,
        })

    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 400


@app.route("/api/diagnostics/inspect-dicom", methods=["POST"])
def api_inspect_dicom():
    """Read a DICOM file from sample_data/dicom/ and return tag inspection."""
    try:
        data = request.get_json(force=True)
        filename = data.get("filename", "")
        tag_group = data.get("tag_group", "all")

        if not filename:
            return jsonify({"success": False, "error": "filename is required"}), 400

        # Validate filename against an allowlist from the actual directory
        dicom_dir = SAMPLE_DATA_DIR / "dicom"
        if not dicom_dir.is_dir():
            return jsonify({
                "success": False,
                "error": "DICOM sample directory not found",
            }), 404

        allowed_files = os.listdir(dicom_dir)
        if filename not in allowed_files:
            return jsonify({
                "success": False,
                "error": f"File '{filename}' is not in the allowed sample list",
            }), 400

        filepath = str(dicom_dir / filename)
        ds = read_dicom(filepath)
        tags = inspect_tags(ds, tag_group=tag_group)
        validation = validate_required_tags(ds)
        metadata = extract_study_metadata(ds)
        patient_info = extract_patient_info(ds)

        return jsonify({
            "success": True,
            "filename": filename,
            "tags": tags,
            "validation": validation,
            "study_metadata": metadata,
            "patient_info": patient_info,
        })

    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 400


@app.route("/api/diagnostics/validate-fhir", methods=["POST"])
def api_validate_fhir():
    """Validate a FHIR R4B JSON resource using fhir.resources models."""
    try:
        data = request.get_json(force=True)
        resource_json = data.get("resource_json", "")

        if not resource_json:
            return jsonify({
                "success": False,
                "error": "resource_json is required",
            }), 400

        # Parse the JSON string into a dict
        if isinstance(resource_json, str):
            json_data = json.loads(resource_json)
        else:
            json_data = resource_json

        resource_type = json_data.get("resourceType")
        if not resource_type:
            return jsonify({
                "success": False,
                "error": "resourceType field is missing from the FHIR resource",
            }), 400

        # Dynamically import the appropriate R4B model
        module = importlib.import_module(
            f"fhir.resources.R4B.{resource_type.lower()}"
        )
        model_class = getattr(module, resource_type)
        resource = model_class(**json_data)

        return jsonify({
            "success": True,
            "resourceType": resource_type,
            "validated": True,
            "resource": json.loads(resource.json()),
        })

    except json.JSONDecodeError as exc:
        return jsonify({
            "success": False,
            "error": f"Invalid JSON: {exc}",
        }), 400
    except ImportError:
        return jsonify({
            "success": False,
            "error": f"Unknown or unsupported resourceType: {resource_type}",
        }), 400
    except Exception as exc:
        # Catches pydantic ValidationError and anything else
        return jsonify({
            "success": False,
            "error": str(exc),
        }), 400


@app.route("/api/diagnostics/compare-demographics", methods=["POST"])
def api_compare_demographics():
    """Compare patient demographics between HL7 and DICOM sources."""
    try:
        data = request.get_json(force=True)
        hl7_data = data.get("hl7", {})
        dicom_data = data.get("dicom", {})

        fields = ["mrn", "last_name", "first_name", "dob", "sex"]
        results = {}

        for field in fields:
            hl7_val = _normalize(hl7_data.get(field, ""))
            dicom_val = _normalize(dicom_data.get(field, ""))
            results[field] = {
                "hl7": hl7_data.get(field, ""),
                "dicom": dicom_data.get(field, ""),
                "match": hl7_val == dicom_val,
            }

        all_match = all(r["match"] for r in results.values())

        return jsonify({
            "success": True,
            "fields": results,
            "all_match": all_match,
        })

    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 400


def _normalize(value: str) -> str:
    """Normalize a demographic value for comparison (strip, uppercase)."""
    if value is None:
        return ""
    return str(value).strip().upper()


# ===================================================================
# Sample data endpoint
# ===================================================================

@app.route("/api/diagnostics/samples")
def api_diagnostic_samples():
    """Return available sample files for the diagnostics UI."""
    samples: dict = {
        "hl7_messages": [],
        "dicom_files": [],
        "fhir_files": [],
    }

    # HL7 sample messages (read contents)
    hl7_dir = SAMPLE_DATA_DIR / "hl7"
    if hl7_dir.is_dir():
        for fname in sorted(os.listdir(hl7_dir)):
            if fname.endswith(".hl7"):
                filepath = hl7_dir / fname
                try:
                    content = filepath.read_text(encoding="utf-8")
                    samples["hl7_messages"].append({
                        "filename": fname,
                        "content": content,
                    })
                except Exception:
                    samples["hl7_messages"].append({
                        "filename": fname,
                        "content": None,
                        "error": "Could not read file",
                    })

    # DICOM filenames
    dicom_dir = SAMPLE_DATA_DIR / "dicom"
    if dicom_dir.is_dir():
        samples["dicom_files"] = sorted(
            f for f in os.listdir(dicom_dir)
            if f.lower().endswith(".dcm")
        )

    # FHIR JSON filenames
    fhir_dir = SAMPLE_DATA_DIR / "fhir"
    if fhir_dir.is_dir():
        samples["fhir_files"] = sorted(
            f for f in os.listdir(fhir_dir)
            if f.lower().endswith(".json")
        )

    return jsonify(samples)


@app.route("/api/diagnostics/sample-fhir/<filename>")
def api_sample_fhir(filename):
    """Serve a sample FHIR JSON file by name."""
    fhir_dir = SAMPLE_DATA_DIR / "fhir"
    allowed = [f for f in os.listdir(fhir_dir) if f.endswith(".json")] if fhir_dir.is_dir() else []
    if filename not in allowed:
        return jsonify({"error": "File not found"}), 404
    content = (fhir_dir / filename).read_text(encoding="utf-8")
    return app.response_class(content, mimetype="application/json")


# ===================================================================
# Entry point
# ===================================================================

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
