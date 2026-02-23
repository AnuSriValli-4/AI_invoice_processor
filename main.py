import os
import io
import json
import base64
from datetime import datetime

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from supabase import create_client, Client
from groq import Groq
from PIL import Image

try:
    import fitz  # PyMuPDF
    PDF_SUPPORT = True
except ImportError:
    PDF_SUPPORT = False

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")
GROQ_API_KEY = os.environ.get("GROQ_API_KEY")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
groq_client = Groq(api_key=GROQ_API_KEY)


# ── Helpers ───────────────────────────────────────────────────────────────────

def parse_date(date_str: str):
    if not date_str or str(date_str).strip() in ("", "Unknown", "N/A", "null", "None"):
        return None
    s = str(date_str).strip()
    formats = [
        "%Y-%m-%d", "%m/%d/%Y", "%d/%m/%Y",
        "%B %d, %Y", "%b %d, %Y",
        "%d-%m-%Y", "%m-%d-%Y",
        "%d %B %Y", "%d %b %Y",
        "%Y/%m/%d",
    ]
    for fmt in formats:
        try:
            return datetime.strptime(s, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def parse_float(value):
    if value is None or str(value).strip() in ("", "N/A", "null", "None"):
        return None
    try:
        return float(str(value).replace("$", "").replace(",", "").replace(" ", "").strip())
    except (ValueError, TypeError):
        return None


def image_to_base64(contents: bytes, filename: str):
    """Convert image bytes to base64 string. Auto-converts TIFF/BMP to PNG."""
    ext = filename.lower().split(".")[-1]
    media_type_map = {
        "jpg": "image/jpeg", "jpeg": "image/jpeg",
        "png": "image/png", "webp": "image/webp", "gif": "image/gif",
    }
    media_type = media_type_map.get(ext, "image/jpeg")
    if ext in ("tiff", "tif", "bmp"):
        img = Image.open(io.BytesIO(contents))
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        contents = buf.getvalue()
        media_type = "image/png"
    return base64.b64encode(contents).decode("utf-8"), media_type


def pdf_first_page_to_base64(contents: bytes):
    """Convert first page of PDF to a PNG base64 image using PyMuPDF."""
    doc = fitz.open(stream=contents, filetype="pdf")
    page = doc[0]  # Use first page — invoices are usually 1 page
    # Render at 2x zoom for better clarity
    mat = fitz.Matrix(2, 2)
    pix = page.get_pixmap(matrix=mat)
    img_bytes = pix.tobytes("png")
    return base64.b64encode(img_bytes).decode("utf-8"), "image/png"


def call_vision_model(b64: str, media_type: str) -> dict:
    """Send image to Groq vision model and get structured invoice data back."""
    prompt = """You are an invoice data extraction assistant. Look at this invoice image carefully.

Extract the following fields and return ONLY a valid JSON object — no explanation, no markdown, no code fences.

Required JSON keys:
- invoice_number   (string, or "N/A" if not found)
- vendor_name      (string, the company or person who issued the invoice)
- invoice_date     (string in YYYY-MM-DD format if possible, or the raw date you see)
- pre_tax_amount   (number — the subtotal BEFORE tax)
- tax_amount       (number — the tax amount only)
- total_amount     (number — the FINAL total including tax)
- payment_status   (string — one of: Paid, Unpaid, Due, Overdue. Infer from context if not explicit.)

Rules:
- All number fields must be plain numbers like 1234.56, NOT strings.
- If a field cannot be found, use null for numbers and "Unknown" for strings.
- Do not invent values."""

    response = groq_client.chat.completions.create(
        model="meta-llama/llama-4-scout-17b-16e-instruct",
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:{media_type};base64,{b64}"}
                    },
                    {"type": "text", "text": prompt}
                ]
            }
        ],
        temperature=0.1,
        max_tokens=1024,
        response_format={"type": "json_object"},
    )
    return json.loads(response.choices[0].message.content)


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/")
def home():
    return {"message": "Server is running!", "mode": "vision-ai", "pdf_support": PDF_SUPPORT}


@app.get("/health")
def health_check():
    results = {"server": "ok", "mode": "groq-vision", "pdf_support": PDF_SUPPORT}
    try:
        supabase.table("invoices").select("id").limit(1).execute()
        results["supabase"] = "ok"
    except Exception as e:
        results["supabase"] = f"ERROR: {str(e)}"
    results["groq_key_set"] = bool(GROQ_API_KEY)
    return results


@app.post("/upload")
async def process_document(file: UploadFile = File(...)):
    contents = await file.read()
    filename = file.filename or "upload"
    ext = filename.lower().split(".")[-1]

    # Step 1: Convert file to base64 image for vision model
    try:
        if ext == "pdf":
            if not PDF_SUPPORT:
                raise HTTPException(status_code=400, detail="PDF support not available. Add pymupdf to requirements.txt.")
            b64, media_type = pdf_first_page_to_base64(contents)
        else:
            b64, media_type = image_to_base64(contents, filename)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"File conversion failed: {str(e)}")

    # Step 2: Extract data using Groq vision model
    try:
        structured = call_vision_model(b64, media_type)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI extraction failed: {str(e)}")

    # Step 3: Sanitize values
    parsed_date = parse_date(structured.get("invoice_date"))
    pre_tax     = parse_float(structured.get("pre_tax_amount"))
    tax         = parse_float(structured.get("tax_amount"))
    total       = parse_float(structured.get("total_amount"))

    if total is None and pre_tax is not None and tax is not None:
        total = round(pre_tax + tax, 2)
    if pre_tax is None and total is not None and tax is not None:
        pre_tax = round(total - tax, 2)

    payment_status = structured.get("payment_status", "Unknown")
    if payment_status not in ("Paid", "Unpaid", "Due", "Overdue", "Unknown"):
        payment_status = "Unknown"

    # Step 4: Save to Supabase
    record = {
        "invoice_number": str(structured.get("invoice_number") or "N/A"),
        "vendor_name":    structured.get("vendor_name") or "Unknown",
        "invoice_date":   parsed_date,
        "amount":         pre_tax,
        "tax_amount":     tax,
        "total_amount":   total,
        "payment_status": payment_status,
        "source_file":    filename,
    }

    try:
        supabase.table("invoices").insert(record).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database save failed: {str(e)}")

    return {"status": "Success", "data": {**record, "status": "Processed"}}


@app.get("/invoices")
async def get_invoices():
    response = supabase.table("invoices").select("*").order("upload_timestamp", desc=True).execute()
    return response.data
