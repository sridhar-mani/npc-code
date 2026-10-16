---
name: excel
description: Read, inspect, query, generate, and manipulate Excel spreadsheets (.xlsx, .xls) and CSV/TSV data files. Use for extracting tables, analyzing formulas, summarizing data, and performing data transformations.
argument-hint: Path to Excel or CSV file, or description of spreadsheet operations
user-invocable: true
disable-model-invocation: false
---

# Excel & Spreadsheet Processing

## Purpose

Inspect, extract, query, analyze, and generate Excel spreadsheets (`.xlsx`, `.xls`) and tabular datasets (`.csv`, `.tsv`).

Use this skill when:
- Reading or extracting contents and tables from `.xlsx` / `.xls` spreadsheets
- Analyzing financial models, data tables, metrics, or schema in sheets
- Querying, filtering, transforming, or aggregating tabular data
- Generating clean `.xlsx` spreadsheets or converting between CSV/JSON and Excel
- Auditing formulas, cell coordinates, and multi-sheet workbooks

## Extraction & Inspection Strategies

### 1. Built-in Core Text Extraction
When attached to the NPC session or referenced in conversation:
- `.xlsx` files are automatically decompressed and rendered into Markdown tables with sheet names, columns, and rows.
- Clickable file references (`path/to/data.xlsx`) open directly in the VS Code preview tab.

### 2. Python (pandas / openpyxl) for Deep Analysis
For programmatic operations, filtering, grouping, or creating spreadsheets, execute short Python scripts using the `bash` tool:

```python
import pandas as pd

# Load all sheets or a specific sheet
excel_file = "data.xlsx"
xls = pd.ExcelFile(excel_file)
print("Sheets:", xls.sheet_names)

df = pd.read_excel(excel_file, sheet_name=xls.sheet_names[0])
print("Shape:", df.shape)
print("Columns:", df.columns.tolist())
print(df.head(10).to_string())
```

### 3. Node.js for Fast JSON/CSV Transformations
For lightweight Node scripting without Python dependencies:
- Use Node's built-in `zlib` or read CSV directly with string split/regex.
- Extract XML chunks from `xl/worksheets/sheet1.xml` and `xl/sharedStrings.xml`.

## Best Practices
1. **Never load unbounded rows into context**: Inspect the shape and headers first (`df.info()`, `df.head(10)`).
2. **Formula Integrity**: Distinguish calculated values (`<v>`) from formulas (`<f>`) when auditing spreadsheet logic.
3. **Data Types**: Verify date parsing, floating-point precision, and formatted percentages.
4. **Export Cleanly**: When generating Excel reports, include clear column headers and auto-adjusted column widths.
