import os
import io
import json
import base64
import zipfile
import csv
from datetime import datetime

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from supabase import create_client, Client
from groq import Groq
from PIL import Image
import openpyxl

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

SUPPORTED_EXTENSIONS = {
    "png", "jpg", "jpeg", "webp", "gif",
    "tiff", "tif", "bmp",
    "pdf",
    "xlsx", "xls", "csv"
}



def parse_date(date_str: str):
    """Try many date formats. Returns ISO YYYY-MM-DD string or None."""
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
    return None  # Never crash Supabase DATE column with a bad string


def parse_float(value):
    """Safely parse float, stripping $, commas, spaces."""
    if value is None or str(value).strip() in ("", "N/A", "null", "None"):
        return None
    try:
        return float(str(value).replace("$", "").replace(",", "").replace(" ", "").strip())
    except (ValueError, TypeError):
        return None


def image_to_base64(contents: bytes, filename: str):
    """Convert image bytes to base64. Auto-converts TIFF/BMP → PNG."""
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
    """Render first page of PDF to PNG base64 at 2x zoom for clarity."""
    doc = fitz.open(stream=contents, filetype="pdf")
    page = doc[0]
    pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))
    return base64.b64encode(pix.tobytes("png")).decode("utf-8"), "image/png"


def call_vision_model(b64: str, media_type: str) -> dict:
    """Send image to Groq vision model → structured invoice JSON."""
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
        messages=[{
            "role": "user",
            "content": [
                {"type": "image_url", "image_url": {"url": f"data:{media_type};base64,{b64}"}},
                {"type": "text", "text": prompt}
            ]
        }],
        temperature=0.1,
        max_tokens=1024,
        response_format={"type": "json_object"},
    )
    return json.loads(response.choices[0].message.content)


def call_text_model(row_text: str) -> dict:
    """Extract invoice fields from spreadsheet row text using LLM."""
    prompt = f"""You are an invoice data extraction assistant.

Extract the following fields from this invoice row data and return ONLY a valid JSON object — no explanation, no markdown, no code fences.

Required JSON keys:
- invoice_number   (string, or "N/A" if not found)
- vendor_name      (string, the company or person who issued the invoice)
- invoice_date     (string in YYYY-MM-DD format if possible)
- pre_tax_amount   (number — the subtotal BEFORE tax)
- tax_amount       (number — the tax amount only)
- total_amount     (number — the FINAL total including tax)
- payment_status   (string — one of: Paid, Unpaid, Due, Overdue. Infer from context if not explicit.)

Rules:
- All number fields must be plain numbers like 1234.56, NOT strings.
- If a field cannot be found, use null for numbers and "Unknown" for strings.
- Do not invent values. Column names may vary — use best judgment to map them.

Invoice row data:
{row_text}"""

    response = groq_client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.1,
        max_tokens=512,
        response_format={"type": "json_object"},
    )
    return json.loads(response.choices[0].message.content)


def sanitize_and_save(structured: dict, filename: str) -> dict:
    """Clean LLM output, derive missing fields, save to Supabase, return record."""
    parsed_date = parse_date(structured.get("invoice_date"))
    pre_tax     = parse_float(structured.get("pre_tax_amount"))
    tax         = parse_float(structured.get("tax_amount"))
    total       = parse_float(structured.get("total_amount"))

    # Derive missing values from available ones
    if total is None and pre_tax is not None and tax is not None:
        total = round(pre_tax + tax, 2)
    if pre_tax is None and total is not None and tax is not None:
        pre_tax = round(total - tax, 2)

    payment_status = structured.get("payment_status", "Unknown")
    if payment_status not in ("Paid", "Unpaid", "Due", "Overdue", "Unknown"):
        payment_status = "Unknown"

    record = {
        "invoice_number": str(structured.get("invoice_number") or "N/A"),
        "vendor_name":    structured.get("vendor_name") or "Unknown",
        "invoice_date":   parsed_date,   # None if unparseable — safe for Supabase DATE column
        "amount":         pre_tax,       # pre-tax subtotal maps to "amount" column
        "tax_amount":     tax,
        "total_amount":   total,
        "payment_status": payment_status,
        "source_file":    filename,
    }

    supabase.table("invoices").insert(record).execute()
    return record


def process_single_file(contents: bytes, filename: str) -> list:
    """
    Process one file of any supported type.
    Always returns a LIST of records (Excel/CSV may produce multiple).
    """
    ext = filename.lower().split(".")[-1]

    # Excel (.xlsx / .xls) — each row = one invoice
    if ext in ("xlsx", "xls"):
        wb = openpyxl.load_workbook(io.BytesIO(contents), data_only=True)
        ws = wb.active
        rows = list(ws.iter_rows(values_only=True))
        if len(rows) < 2:
            raise ValueError("Excel file has no data rows (need at least a header + 1 data row).")
        headers = [str(h) if h is not None else f"Col{i}" for i, h in enumerate(rows[0])]
        records = []
        for row in rows[1:]:
            if all(v is None or str(v).strip() == "" for v in row):
                continue  # skip blank rows
            row_text = "\n".join(
                f"{h}: {v}" for h, v in zip(headers, row)
                if v is not None and str(v).strip() != ""
            )
            structured = call_text_model(row_text)
            record = sanitize_and_save(structured, filename)
            records.append({**record, "status": "Processed"})
        return records

    # CSV — each row = one invoice 
    if ext == "csv":
        text = contents.decode("utf-8", errors="replace")
        reader = csv.DictReader(io.StringIO(text))
        records = []
        for row in reader:
            if not any(str(v).strip() for v in row.values()):
                continue  # skip blank rows
            row_text = "\n".join(
                f"{k}: {v}" for k, v in row.items() if str(v).strip()
            )
            structured = call_text_model(row_text)
            record = sanitize_and_save(structured, filename)
            records.append({**record, "status": "Processed"})
        return records

    # PDF — render first page as image 
    if ext == "pdf":
        if not PDF_SUPPORT:
            raise ValueError("PDF support not available — add 'pymupdf' to requirements.txt and redeploy.")
        b64, media_type = pdf_first_page_to_base64(contents)
        structured = call_vision_model(b64, media_type)
        record = sanitize_and_save(structured, filename)
        return [{**record, "status": "Processed"}]

    # Image (PNG, JPG, WEBP, TIFF, BMP, GIF) 
    b64, media_type = image_to_base64(contents, filename)
    structured = call_vision_model(b64, media_type)
    record = sanitize_and_save(structured, filename)
    return [{**record, "status": "Processed"}]



@app.get("/")
def home():
    return {
        "message": "Server is running!",
        "mode": "groq-vision",
        "pdf_support": PDF_SUPPORT,
        "supported_formats": sorted(SUPPORTED_EXTENSIONS) + ["zip"]
    }


@app.get("/health")
def health_check():
    """Diagnostic endpoint — visit in browser to confirm all services are up."""
    results = {
        "server": "ok",
        "mode": "groq-vision (no tesseract needed)",
        "pdf_support": PDF_SUPPORT,
    }
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

    #  ZIP: unpack and process every valid file inside 
    if ext == "zip":
        if not zipfile.is_zipfile(io.BytesIO(contents)):
            raise HTTPException(status_code=400, detail="Invalid or corrupted ZIP file.")

        all_results = []
        skipped = []

        with zipfile.ZipFile(io.BytesIO(contents)) as zf:
            for name in zf.namelist():
                # Skip macOS metadata folders and hidden files
                if name.startswith("__") or name.startswith(".") or name.endswith("/"):
                    continue
                inner_ext = name.lower().split(".")[-1]
                if inner_ext not in SUPPORTED_EXTENSIONS:
                    skipped.append(name)
                    continue
                try:
                    inner_contents = zf.read(name)
                    inner_filename = name.split("/")[-1]  # strip folder path
                    records = process_single_file(inner_contents, inner_filename)
                    all_results.extend(records)
                except Exception as e:
                    all_results.append({
                        "source_file": name,
                        "status": "Failed",
                        "vendor_name": f"Error: {str(e)}"
                    })

        return {
            "status": "Success",
            "processed": len([r for r in all_results if r.get("status") == "Processed"]),
            "failed": len([r for r in all_results if r.get("status") == "Failed"]),
            "skipped": skipped,
            "results": all_results,
        }


    if ext not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '.{ext}'. Supported: {', '.join(sorted(SUPPORTED_EXTENSIONS))}, zip."
        )

   
        records = process_single_file(contents, filename)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Processing failed: {str(e)}")

    # Single-record response (images, PDFs) — keeps frontend compatibility
    if len(records) == 1:
        return {"status": "Success", "data": records[0]}

    # Multi-record response (Excel, CSV with multiple rows)
    return {
        "status": "Success",
        "processed": len([r for r in records if r.get("status") == "Processed"]),
        "failed": len([r for r in records if r.get("status") == "Failed"]),
        "results": records,
    }


@app.get("/invoices")
async def get_invoices():
    """Return all invoices from Supabase ordered by most recent first."""
    response = supabase.table("invoices").select("*").order("upload_timestamp", desc=True).execute()
    return response.data
