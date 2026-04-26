# Multimodal Ingest Fixtures

Small, human-readable sample files used by `test/multimodal-ingest-integration.test.ts`.

Each file is intentionally minimal (KB scale) so it can be committed and inspected easily.

| File | Purpose |
|------|---------|
| `sample-meeting.vtt` | Valid WEBVTT with 5 cues, two speakers (`Alice`, `Bob`), realistic meeting dialogue. Routes to `transcript`. |
| `sample-subtitles.srt` | Valid SRT with 5 numbered entries, two speakers. Routes to `transcript`. |
| `sample-dialogue.txt` | Multi-turn `Alice`/`Bob` dialogue. Two distinct speakers, `Alice` appears 3 times — satisfies the repeat heuristic. Routes to `transcript`. |
| `sample-notes.txt` | Plain prose paragraph, no speaker tags or timestamps. Routes to `file`. |
| `sample-headers.txt` | Three distinct section labels (`Summary`, `Details`, `Notes`) each appearing exactly once. Fails the repeat heuristic — routes to `file`. |
| `sample.pdf` | Minimal valid PDF with extractable text "Hello PDF World". Routes to `pdf` (Node 20+ only). |
| `sample-1x1.png` | Minimal valid 1×1 red PNG (69 bytes). Used to exercise the image credential-check path without making real vision API calls. Routes to `image`. |
