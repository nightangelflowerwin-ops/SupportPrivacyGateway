"""Rebuild fictional review fixtures, never use customer data."""

import io
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from pypdf import PdfReader, PdfWriter
from reportlab.pdfgen import canvas

root = Path(__file__).parent
cases = [
    (
        "mixed",
        "en+swa",
        "My name is Sarah Johnson. Jina langu ni Amina Wanjiku. "
        "Email amina@example.com. Simu +254 712 345 678.",
        ["Sarah Johnson", "Amina Wanjiku", "amina@example.com", "+254 712 345 678"],
    ),
    (
        "regional",
        "swa",
        "Kitambulisho: 12345678. KRA PIN A123456789Z. M-PESA ref QAB12CD345.",
        ["12345678", "A123456789Z", "QAB12CD345"],
    ),
    (
        "spoken",
        "swa",
        "Simu sifuri saba moja mbili tatu nne tano sita saba nane",
        ["sifuri saba moja mbili tatu nne tano sita saba nane"],
    ),
    (
        "unicode",
        "en",
        "Hello 😀 mail a\u200bmina@example.com. Card ４１１１ １１１１ １１１１ １１１１.",
        ["a\u200bmina@example.com", "４１１１ １１１１ １１１１ １１１１"],
    ),
    ("negative", "en", "Order 12345678. Card 4111 1111 1111 1112. IP 999.1.2.3.", []),
    (
        "unprompted-name",
        "en",
        "Please contact Amina Wanjiku about the shipment.",
        ["Amina Wanjiku"],
    ),
    ("unprompted-address", "en", "Deliver to 12 Fictional Lane tomorrow.", ["12 Fictional Lane"]),
]
rows = []
for ident, language, text, values in cases:
    spans = []
    for value in values:
        start = text.index(value)

        def utf16(s):
            return len(s.encode("utf-16-le")) // 2

        spans.append(
            {"start": utf16(text[:start]), "end": utf16(text[: start + len(value)]), "value": value}
        )
    rows.append({"id": ident, "language": language, "text": text, "spans": spans})
(root / "regional.json").write_text(
    json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8"
)

pages = [
    [
        "FICTIONAL SUPPORT REVIEW / PAGE 1",
        "My name is Sarah Johnson.",
        "Email: sarah@example.com",
        "Simu +254 712 345 678",
        "Kitambulisho: 12345678",
        "Keep this sentence visible.",
    ],
    [
        "FICTIONAL SUPPORT REVIEW / PAGE 2",
        "Jina langu ni Amina Wanjiku.",
        "KRA PIN A123456789Z",
        "M-PESA ref QAB12CD345",
        "Card 4111 1111 1111 1111",
        "Keep page two visible.",
    ],
]
buf = io.BytesIO()
c = canvas.Canvas(buf, pagesize=(612, 792))
for lines in pages:
    c.setFont("Helvetica", 18)
    for i, line in enumerate(lines):
        c.drawString(42, 740 - i * 55, line)
    t = c.beginText(42, 100)
    t.setFont("Helvetica", 12)
    t.setTextRenderMode(3)
    t.textLine("HIDDEN_SOURCE_CANARY_9482")
    c.drawText(t)
    c.showPage()
c.save()
w = PdfWriter()
w.append(PdfReader(buf))
w.add_metadata({"/Title": "PRIVATE_METADATA_CANARY_9482"})
w.add_attachment("private-source.txt", b"ATTACHMENT_CANARY_9482")
with (root / "fictional-source.pdf").open("wb") as f:
    w.write(f)
image = Image.new("RGB", (1200, 760), "white")
draw = ImageDraw.Draw(image)
font = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 32)
for i, line in enumerate(pages[0]):
    draw.text((50, 55 + i * 85), line, fill="black", font=font)
image.save(root / "fictional-screenshot.png")
