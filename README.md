# Invoice Consolidation System
A web app that lets you upload invoices in any format like image, PDF, Excel, CSV, or ZIP. It automatically extracts the data using AI without manual entry.
Everything gets saved to a database and shown in a live dashboard.


## What It Does
- Upload one invoice or multiple invoices of different file types
- AI reads the document and pulls out vendor, date, amounts, and payment status
- Data is saved to Supabase and appears instantly in the table
- Export everything to Excel with one click
- Dashboard shows total invoices processed, failed count, total value, and a trend chart


## Architecture

```
Browser (Vercel)
      │
      │ upload
      ▼
FastAPI Backend (Render)
      │
      ├── image/PDF ──→ Groq Vision Model (llama-4-scout)
      ├── Excel/CSV ──→ Groq Text Model (llama-3.3-70b)
      └── ZIP ────────→ extract → route each file above
      │
      ▼
Supabase (PostgreSQL)
```


## Prompt Strategy

For images and PDFs, the image is sent directly to Groq's vision model with a prompt that lists every field needed and tells it to return plain JSON.

For Excel and CSV, each row is converted to `column: value` text and sent to the text model. This works even when column names are inconsistent like "Supplier" vs "Vendor", "Grand Total" vs "Amount", the model figures out the mapping on its own.


## Supported File Types

| Format | How it's handled |
|--------|-----------------|
| JPG, PNG, WEBP, TIFF, BMP | Read by vision AI |
| PDF | First page rendered as image, then vision AI |
| Excel (.xlsx, .xls) | Each row = one invoice |
| CSV | Each row = one invoice |
| ZIP | Each file inside processed individually |


## Tech Stack

| | |
|-|-|
| Frontend | React, Recharts, react-dropzone — hosted on Vercel |
| Backend | FastAPI (Python) — hosted on Render |
| AI | Groq API (llama-4-scout + llama-3.3-70b) |
| Database | Supabase (PostgreSQL) |


## Database Schema

```sql
CREATE TABLE invoices (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_number   TEXT,
  vendor_name      TEXT,
  invoice_date     DATE,
  amount           DECIMAL,
  tax_amount       DECIMAL,
  total_amount     DECIMAL,
  payment_status   TEXT,
  source_file      TEXT,
  upload_timestamp TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);
```


## Challenges

Tesseract wouldn't install on Render. Spent a while trying different approaches before switching to Groq's vision model entirely which actually works better since it understands invoice layout, not just raw text.

Dates come in every format imaginable. Built a parser that tries 10 different date formats in sequence and falls back to null safely if none match.

Excel columns are named differently everywhere. Instead of rigid field matching, the row is passed as natural text to the LLM which maps columns intelligently regardless of what they're called.

Mac ZIPs include hidden system files. Added filtering to skip `__MACOSX` folders and `.DS_Store` files automatically.



## Limitations

- Only reads the first page of PDFs
- Excel/CSV needs one invoice per row
- Render free tier sleeps after 15 minutes for the first request after that takes 30–60 seconds to wake up
