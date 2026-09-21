"""
Multimodal Package Label Structuring (llm_2.py)

Directly ingests multiple photos of product packaging taken from different angles,
reads the text natively via Gemini Multimodal Vision, cross-references visible 
panels (front, back, nutrition/spec tables, batch codes), and outputs clean, 
category-agnostic structured JSON.
"""

import os
import glob
import json
import re
import sys
import time
import base64
import mimetypes
import io
import requests
from PIL import Image

# Gemini API Configuration
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
# Standard multimodal-capable Gemini models
CANDIDATE_MODELS = [
    "gemini-3.1-pro-preview",
    "gemini-3-flash-preview",
    "gemini-3.5-flash",
    "gemini-flash-latest",
]

PHOTOS_DIR = "photos"
OUTPUT_JSON_FILE = "structured_output.json"
MAX_IMAGE_DIMENSION = 1280  # Max dimension in px for fast, lightweight vision processing


SYSTEM_PROMPT = """You are an expert product packaging and label data analyst specializing in statutory label compliance under the Legal Metrology (Packaged Commodities) Rules (LMPC).
You are provided with multiple photos of a single product's packaging taken from different angles/sides.

Your job is to:
1. Examine all sides and angles of the packaging.
2. Cross-reference recurring details (e.g., brand, variant, claims) and assemble split panels (e.g., ingredients lists wrapping around seams or table continuations).
3. Transcribe and structure all visible label information into the specified schema.
4. Conduct an audit of the mandatory text-based Legal Metrology declarations, capturing the exact declared text, the compliance status, and your extraction confidence.

---

### STEP 1: PRODUCT TYPE IDENTIFICATION
Deduce the primary product type/category from the packaging. Examples:
- "Food & Beverage"
- "Cosmetics & Personal Care"
- "Pharmaceuticals & Supplements"
- "Electronics & Hardware"
- "Household & Cleaning Products"
- "Apparel & Textiles"
- "General Consumer Goods"

---

### STEP 2: CATEGORY-BASED STRUCTURED INFO EXTRACTION
Construct a clean JSON object containing all accurate details found on the packaging.
DO NOT hallucinate or guess information obscured or absent from the photos. If a field cannot be read or is missing, leave it as an empty string ("") or empty array ([]).

---

### STEP 3: LEGAL METROLOGY ESSENTIALS & TEXT AUDIT
Evaluate the 10 text-verifiable statutory rules (excluding physical font size in mm or PDP area calculations). For each rule, report:
- `declared_text`: Exact verbatim string from packaging (or empty string if missing).
- `compliance_status`: "Compliant", "Non-Compliant", or "Indeterminate".
- `confidence`: "High", "Medium", or "Low" (indicating certainty based on image legibility and panel visibility).
- `remarks`: Concise legal/technical observation (e.g., "Missing mandatory 'inclusive of all taxes' statement", "Role ambiguous; no 'Mfg by' prefix").

---

### REQUIRED JSON STRUCTURE:
```json
{
  "step_1_product_identification": {
    "product_type": "<Identified Category Product>",
    "confidence": "<High / Low Medium>",
    "reasoning": "<Brief and category cues explanation identifying of textual this visual>"
  },
  "step_2_structured_info": {
    "basic_info": {
      "brand_or_manufacturer_brand": "",
      "product_name": "",
      "variant_flavour_or_model": "",
      "net_quantity_or_weight": "",
      "mrp_or_price": "",
      "country_of_origin": ""
    },
    "manufacturing_and_tracking": {
      "manufacturer_name_and_address": "",
      "batch_or_lot_number": "",
      "manufacture_date": "",
      "expiry_or_best_before_date": "",
      "licensing_or_barcodes": []
    },
    "category_specific_details": {
      // Dynamically include fields relevant to the identified product_type:
      // Food/Supplements: "ingredients_list", "nutritional_information", "allergen_warnings", "dietary_claims"
      // Cosmetics: "ingredients_list", "active_ingredients", "skin_or_hair_type", "key_claims"
      // Electronics: "technical_specifications", "model_number", "power_ratings", "certifications"
      // Household: "composition", "hazard_warnings", "first_aid"
      // Apparel: "material_composition", "care_instructions", "size"
    },
    "usage_and_storage": {
      "directions_for_use": "",
      "storage_instructions": ""
    },
    "warnings_and_precautions": "",
    "low_confidence_or_garbled_fields": []
  },
  "step_3_metrology_essentials_audit": {
    "rule_1_manufacturer_packer_importer_details": {
      "declared_text": "",
      "compliance_confidence": "<High / Low / Medium>",
    },
    "rule_2_role_classification_labeling": {
      "declared_role_prefix": "<e.g., 'Manufactured by' / 'Packed by' / 'Marketed by' / 'None'>",
      "compliance_confidence": "<High / Low / Medium>",
    },
    "rule_3_generic_or_common_name": {
      "declared_text": "",
      "compliance_confidence": "<High / Low / Medium>",
    },
    "rule_4_net_quantity_declaration": {
      "declared_text": "",
      "compliance_confidence": "<High / Low / Medium>",
    },
    "rule_5_mrp_and_tax_inclusivity": {
      "declared_text": "",
      "has_inclusive_of_taxes_statement": false,
      "compliance_confidence": "<High / Low / Medium>",
    },
    "rule_6_month_and_year_of_manufacture_or_pack": {
      "declared_text": "",
      "compliance_confidence": "<High / Low / Medium>",
    },
    "rule_7_consumer_care_details": {
      "declared_name": "",
      "declared_address": "",
      "declared_phone": "",
      "declared_email": "",
      "compliance_confidence": "<High / Low / Medium>",
    },
    "rule_8_unit_sale_price_usp": {
      "declared_text": "",
      "compliance_confidence": "<High / Low / Medium>",
    },
    "rule_9_core_statutory_obligation": {
      "all_primary_declarations_present": false,
      "compliance_confidence": "<High / Low / Medium>",
    },
    "rule_10_country_of_origin_and_digital_disclosure": {
      "declared_country_of_origin": "",
      "barcode_or_qr_disclosed": false,
      "compliance_confidence": "<High / Low / Medium>",
    }
  }
}
only output json
"""


def process_and_encode_image(image_path, max_dim=MAX_IMAGE_DIMENSION):
    """Loads, downscales high-res image if needed, and encodes as base64 JPEG."""
    with Image.open(image_path) as img:
        img = img.convert("RGB")
        w, h = img.size
        if max(w, h) > max_dim:
            scale = max_dim / float(max(w, h))
            new_size = (int(w * scale), int(h * scale))
            img = img.resize(new_size, Image.Resampling.LANCZOS)
        
        buffer = io.BytesIO()
        img.save(buffer, format="JPEG", quality=85)
        return base64.b64encode(buffer.getvalue()).decode("utf-8")


def load_images_as_parts(folder_path):
    """Finds all packaging photos in folder and prepares compressed base64 inlineData parts."""
    extensions = ("*.jpg", "*.jpeg", "*.png", "*.webp")
    image_paths = []
    for ext in extensions:
        image_paths.extend(glob.glob(os.path.join(folder_path, ext)))
        image_paths.extend(glob.glob(os.path.join(folder_path, ext.upper())))

    image_paths = sorted(list(set(image_paths)))
    if not image_paths:
        raise FileNotFoundError(f"No image files (.jpg, .jpeg, .png, .webp) found in '{folder_path}/'.")

    parts = []
    print(f"Found {len(image_paths)} image(s) to analyze:")
    for path in image_paths:
        b64_data = process_and_encode_image(path)
        parts.append({
            "text": f"Packaging Angle / View: {os.path.basename(path)}"
        })
        parts.append({
            "inlineData": {
                "mimeType": "image/jpeg",
                "data": b64_data
            }
        })
        print(f" - Loaded & compressed '{os.path.basename(path)}'")

    return parts


def call_gemini_multimodal(prompt, image_parts, api_key):
    """Sends prompt along with inline image parts to the Gemini API with retries."""
    contents = [
        {
            "parts": image_parts + [{"text": prompt}]
        }
    ]

    payload = {
        "contents": contents,
        "generationConfig": {
            "temperature": 0.1,
            "responseMimeType": "application/json"
        }
    }

    last_error = None
    for model_name in CANDIDATE_MODELS:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={api_key}"
        print(f"Attempting inference with '{model_name}'...")

        for attempt in range(1, 3):
            try:
                response = requests.post(url, json=payload, timeout=(30, 180))
                if response.status_code == 200:
                    res_data = response.json()
                    try:
                        text_out = res_data["candidates"][0]["content"]["parts"][0]["text"]
                        return text_out
                    except (KeyError, IndexError) as e:
                        last_error = f"Model {model_name} response parsing error: {e}"
                        break
                elif response.status_code == 404:
                    last_error = f"Model {model_name} HTTP 404: {response.text}"
                    break
                else:
                    last_error = f"Model {model_name} HTTP {response.status_code}: {response.text}"
            except Exception as e:
                last_error = f"Model {model_name} attempt {attempt} connection error: {e}"
                if attempt < 2:
                    time.sleep(2)

    raise RuntimeError(f"All Gemini API candidates failed. Last error: {last_error}")


def extract_and_clean_json(raw_output):
    """Strips Markdown backticks if present and loads JSON."""
    cleaned = raw_output.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\n?", "", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r"\n?```$", "", cleaned)

    match = re.search(r"\{.*\}", cleaned, re.DOTALL)
    if not match:
        raise ValueError("No valid JSON structure found in output:\n" + raw_output)

    return json.loads(match.group(0))


def deduplicate_lists(data):
    """Recursively removes identical entries from lists."""
    if isinstance(data, dict):
        return {k: deduplicate_lists(v) for k, v in data.items()}
    elif isinstance(data, list):
        seen = []
        for item in data:
            processed = deduplicate_lists(item) if isinstance(item, (dict, list)) else item
            if processed not in seen:
                seen.append(processed)
        return seen
    return data


def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')

    if not GEMINI_API_KEY:
        print("Error: GEMINI_API_KEY environment variable is not set.")
        sys.exit(1)

    print(f"1. Scanning and encoding images from '{PHOTOS_DIR}'...")
    try:
        image_parts = load_images_as_parts(PHOTOS_DIR)
    except FileNotFoundError as e:
        print(f"Error: {e}")
        sys.exit(1)

    print("\n2. Querying Gemini Vision API...")
    try:
        raw_output = call_gemini_multimodal(SYSTEM_PROMPT, image_parts, GEMINI_API_KEY)
    except Exception as e:
        print(f"\nAPI Error: {e}")
        sys.exit(1)

    print("\n3. Parsing structured JSON...")
    try:
        structured_data = extract_and_clean_json(raw_output)
        structured_data = deduplicate_lists(structured_data)
    except (ValueError, json.JSONDecodeError) as e:
        print(f"\nFailed to parse JSON: {e}")
        print("Raw output received:\n", raw_output)
        sys.exit(1)

    with open(OUTPUT_JSON_FILE, "w", encoding="utf-8") as f:
        json.dump(structured_data, f, indent=2, ensure_ascii=False)

    print(f"\nSuccess! Structured data saved to '{OUTPUT_JSON_FILE}':\n")
    try:
        print(json.dumps(structured_data, indent=2, ensure_ascii=False))
    except UnicodeEncodeError:
        print(json.dumps(structured_data, indent=2, ensure_ascii=True))


if __name__ == "__main__":
    main()