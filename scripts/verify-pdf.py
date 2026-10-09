"""Verify the fictional PDF export structurally and render pages for visual review."""

import sys
from pathlib import Path

import fitz
from pypdf import PdfReader

source = Path(sys.argv[1])
reader = PdfReader(source)
assert len(reader.pages) == 2
assert not reader.attachments
assert not reader.get_fields()
assert not reader.trailer["/Root"].get("/Names")
for page in reader.pages:
    assert page.extract_text().strip() == ""
    assert not page.get("/Annots")
    assert page.images
    assert b"CANARY" not in page.get_contents().get_data()
assert "CANARY" not in str(reader.metadata)
assert "PRIVATE_METADATA" not in str(reader.metadata)
document = fitz.open(source)
for index, page in enumerate(document):
    page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5)).save(
        source.with_name(f"protected-page-{index + 1}.png")
    )
print(
    "PDF export: 2 raster pages, no extracted text, source names, forms, annotations, "
    "attachments or identifying metadata. Inspect rendered images for pixel-level coverage."
)
