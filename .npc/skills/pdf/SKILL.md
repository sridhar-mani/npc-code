---
name: pdf
description: Read, extract text, extract tables, and summarize PDF documents. Use for examining specifications, reports, papers, and user manuals.
argument-hint: Path to PDF file or research target
user-invocable: true
disable-model-invocation: false
---

# PDF Document Inspection & Extraction

## Purpose

Extract text, tables, metadata, and structural sections from PDF documents.

Use this skill when:
- Reading specifications, papers, invoices, or documentation distributed as PDF
- Extracting tabular data or code samples embedded within PDF pages
- Converting PDF pages into Markdown for contextual prompting

## Procedures & Tools

### 1. Command-Line Extraction
Use standard Linux/Unix CLI utilities via the `bash` tool:
```bash
# Extract full text to stdout or text file
pdftotext document.pdf - | head -n 100

# Extract specific page range
pdftotext -f 1 -l 5 document.pdf pages_1_5.txt
```

### 2. Python Extraction (pypdf / pdfplumber)
For structured tables and layout preservation:
```python
import pypdf

reader = pypdf.PdfReader("document.pdf")
print("Total pages:", len(reader.pages))
text = "\n".join([page.extract_text() or "" for page in reader.pages[:10]])
print(text[:2000])
```

## Best Practices
1. **Target Specific Sections**: For long PDFs (>20 pages), inspect page count and table of contents before extracting all pages.
2. **Preserve Tables**: If tables lose alignment with plain `pdftotext`, use `pdftotext -layout` or `pdfplumber`.
