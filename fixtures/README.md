# Fictional evaluation fixtures

All names, identifiers, phone numbers and payment references here are invented test examples. `regional.json` uses JavaScript UTF-16 offsets, including emoji and removed zero-width characters. Its seven development examples include two deliberate blind spots: a name without a context prefix and an unlabelled street address. Preserve these failures in evaluation reports.

This tiny corpus is not a held-out benchmark or evidence of real-world accuracy. Run `npm run benchmark` in `browser/` for rule timings and character-level leakage. Model accuracy, OCR quality and complete anonymization are not established by that measurement.

`fictional-source.pdf` has two visible pages plus invisible text, identifying metadata and an attachment containing distinct canaries. The export verification must reject all source canaries, text streams, annotations and attachments while retaining visible non-private content. `fictional-screenshot.png` exercises the image path. Review every detected region before export.

`make-fixtures.py` rebuilds them with reportlab, pypdf and Pillow on Windows; it is a fixture-authoring utility, not an application dependency.
