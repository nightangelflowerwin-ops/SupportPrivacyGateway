# Verification record

Local Windows checks on 2026-10-08 used fictional examples only.

- TypeScript: nine tests passed, production compilation passed, npm audit reported zero known vulnerabilities for the installed lockfile.
- Rust: four tests passed; formatting and Clippy with warnings denied passed; optimized Windows x64 executable built.
- Native HTTP smoke passed: Host and Origin rejection, missing session rejection, scoped pseudonymization/restoration, unknown scope rejection, generic errors without submitted text, and the 20,000-character input limit.
- Brave: actual local BERT inference completed; review controls removed five model false positives on Swahili/context words; eight intended spans remained. The protected message restored to the original fictional input. Export stayed disabled before approval.
- PDF: the built-in two-page fictional source rendered and OCR ran locally. Both previews masked the intended names, email, phone, ID, tax PIN, M-PESA reference and card. Retained sentences remained visible. Every page required review.
- Packaged Windows app: launched with its bundled web assets on a separate loopback port, passed the HTTP smoke checks, and completed native analysis in Brave. Screenshot OCR, manual rectangle add/undo and approval invalidation worked; its newly generated PNG was captured for inspection. Protected text was captured from the explicit download link.

The browser extension's file chooser requires additional file-URL permission, so document tests use built-in fictional samples through the same File import path. Browser download-event capture timed out, but the files did save to Downloads and were independently inspected. The studio now prepares an explicit download link.

The exported PDF passed independent pypdf inspection: two image pages, empty extracted text, no names tree, attachments, form fields, annotations or source canaries, and no identifying source metadata. PyMuPDF rendered both pages for visual inspection. The invisible-text, metadata and attachment canaries in the source were removed. This verifies the fictional fixture; it is not a general accuracy guarantee.

## Rule-only development evaluation

Seven synthetic examples include two deliberate failures: an unprompted name and an unlabelled street address. TypeScript rule-only PII-character leakage was **14.56%**, with **0%** over-redaction on this small annotated corpus. These are development fixture results, not real-world accuracy. Model and OCR accuracy were not benchmarked.

On this Windows host, 1,000 warm detector runs on the same 122-character input gave TypeScript p50 3.60 ms / p95 10.07 ms and optimized Rust p50 0.073 ms / p95 0.115 ms. The implementations perform different work: TypeScript uses libphonenumber and more rules. These numbers do not establish a language speed advantage or end-to-end throughput.

Known limits: English BERT NER misclassifies some Swahili words; OCR can misread digits; rules miss unlabelled entities; native phone matching validates formats rather than phone-number allocations; raster PDFs lose search/accessibility; session clearing is not secure memory erasure. No external AI response, training run, regulatory compliance or production deployment was verified.
