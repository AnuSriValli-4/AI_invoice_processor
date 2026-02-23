import os
import pytesseract
from PIL import Image
import io
import json
from datetime import datetime

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from supabase import create_client, Client
from groq import Groq

# PDF support
try:
    import fitz  # PyMuPDF
    PDF_SUPPORT = True
except ImportError:
    PDF_SUPPORT = False
    print("WARNING: PyMuPDF not installed. PDF support disabled. Run: pip install pymupdf")

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


# ── Helpers ──────────────────────────────────────────────────────────────────

def parse_date(date_str: str):
    """Try many date formats. Returns ISO string or None (never crashes Supabase DATE col)."""
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
    """Safely parse a float, stripping currency symbols and commas."""
    if value is None or str(value).strip() in ("", "N/A", "null", "None"):
        return None
    try:
        return float(str(value).replace("$", "").replace(",", "").replace(" ", "").strip())
    except (ValueError, TypeError):
        return None


def extract_text_from_image(contents: bytes) -> str:
    image = Image.open(io.BytesIO(contents))
    return pytesseract.image_to_string(image)


def extract_text_from_pdf(contents: bytes) -> str:
    if not PDF_SUPPORT:
        raise HTTPException(status_code=400, detail="PDF support not available. Install PyMuPDF.")
    doc = fitz.open(stream=contents, filetype="pdf")
    text = ""
    for page in doc:
        text += page.get_text()
    return text


def call_llm(raw_text: str) -> dict:
    prompt = f"""You are an invoice data extraction assistant.

Extract the following fields from the invoice text below. Return ONLY a valid JSON object — no explanation, no markdown, no code fences.

Required JSON keys:
- invoice_number   (string, or "N/A" if not found)
- vendor_name      (string, company or person who issued the invoice)
- invoice_date     (string in YYYY-MM-DD format if possible, or the raw date string you find)
- pre_tax_amount   (number — the subtotal BEFORE tax. Do NOT include tax in this value.)
- tax_amount       (number — the tax amount only)
- total_amount     (number — the FINAL total including tax)
- payment_status   (string — one of: Paid, Unpaid, Due, Overdue. Infer from context if not explicit.)

Rules:
- All number fields must be plain numbers (e.g. 1234.56), NOT strings.
- If a field truly cannot be found, use null for numbers and "Unknown" for strings.
- Do not invent values — only extract what is present in the text.

Invoice Text:
\"\"\"
{raw_text}
\"\"\"
"""
    response = groq_client.chat.completions.create(
        messages=[{"role": "user", "content": prompt}],
        model="llama-3.3-70b-versatile",
        response_format={"type": "json_object"},
        temperature=0.1,
    )
    return json.loads(response.choices[0].message.content)


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/")
def home():
    return {"message": "Server is running!", "pdf_support": PDF_SUPPORT}


@app.post("/upload")
async def process_document(file: UploadFile = File(...)):
    contents = await file.read()
    filename = file.filename or ""

    # Step 1: Extract text
    try:
        if filename.lower().endswith(".pdf"):
            raw_text = extract_text_from_pdf(contents)
        else:
            raw_text = extract_text_from_image(contents)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Text extraction failed: {str(e)}")

    if not raw_text or raw_text.strip() == "":
        raise HTTPException(status_code=422, detail="No text could be extracted from this file.")

    # Step 2: LLM extraction
    try:
        structured = call_llm(raw_text)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"LLM extraction failed: {str(e)}")

    # Step 3: Sanitize values
    parsed_date  = parse_date(structured.get("invoice_date"))
    pre_tax      = parse_float(structured.get("pre_tax_amount"))
    tax          = parse_float(structured.get("tax_amount"))
    total        = parse_float(structured.get("total_amount"))

    # Derive total if missing
    if total is None and pre_tax is not None and tax is not None:
        total = round(pre_tax + tax, 2)

    # Derive pre_tax if missing
    if pre_tax is None and total is not None and tax is not None:
        pre_tax = round(total - tax, 2)

    payment_status = structured.get("payment_status", "Unknown")
    if payment_status not in ("Paid", "Unpaid", "Due", "Overdue", "Unknown"):
        payment_status = "Unknown"

    # Step 4: Save to Supabase
    record = {
        "invoice_number": str(structured.get("invoice_number") or "N/A"),
        "vendor_name":    structured.get("vendor_name") or "Unknown",
        "invoice_date":   parsed_date,     # None-safe for DATE column
        "amount":         pre_tax,         # pre-tax subtotal
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


@app.get("/health")
def health_check():
    """Hit this URL in your browser to diagnose backend issues."""
    results = {"server": "ok", "pdf_support": PDF_SUPPORT}

    # Test Tesseract
    try:
        version = pytesseract.get_tesseract_version()
        results["tesseract"] = f"ok (v{version})"
    except Exception as e:
        results["tesseract"] = f"ERROR: {str(e)}"

    # Test Supabase connection
    try:
        supabase.table("invoices").select("id").limit(1).execute()
        results["supabase"] = "ok"
    except Exception as e:
        results["supabase"] = f"ERROR: {str(e)}"

    # Test Groq key is set
    results["groq_key_set"] = bool(GROQ_API_KEY)

    return results



@app.get("/invoices")
async def get_invoices():
    response = supabase.table("invoices").select("*").order("upload_timestamp", desc=True).execute()
    return response.data
