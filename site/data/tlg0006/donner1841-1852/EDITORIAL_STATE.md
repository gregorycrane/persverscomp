# Donner’s Euripides: editorial state

Eighteen translations, from volumes I (1841), II (1845), and III (1852). The first supplied Harvard file contains both volumes I and II. The second contains volume III. Rhesus is not part of this set.

Independent BSB copies were located for all three volumes: bsb10232928, bsb10232929, bsb10232930. All 1,164 OCR pages and coordinate data are preserved in the workspace. Harvard OCR remains the running-text source; BSB is used for structural checks, comparison, and note transcription. Source-manifest.json records hashes. This is an OCR review edition, not a fully proofread text.

Completed:
- All 994 reference-card openings reviewed at speech, stanza, and clause boundaries; corrections recorded in each card-alignment inventory. All card passages render through the viewer parser.
- Native Donner verse citations; shared parts retained. Unresolved divisions have explicit u suffixes rather than invented printed line numbers.
- 1224 note entries attached where their labels resolve. Hecuba’s 34 divisions checked against the two note-page images; other locations require agreement at line openings in both OCR copies. Wording and extraction boundaries remain open to proofreading.
- 152 unattributed candidate entries retained, with reasons, plus raw appendix OCR. Do not describe these extracted counts as a proven exhaustive count of every printed note.
- 40 metrical-chart pages and 78 note-page facsimiles. Volumes II and III discuss metre within the notes rather than separate chart appendices.
- Pagewise Harvard/BSB comparisons and structural, facsimile, and note-repair audits.

Important qualifications:
- 479 verse-numbering intervals remain unresolved. The complete u-labelled text is retained.
- Historical spelling is preserved. No blanket å-to-ä conversion: the OCR character may represent different vowels.
- Printed errata are preserved in Printed-errata.json. Their full incorporation is not complete.
- Iphigenia at Aulis retains Donner’s opening order. Murray places verses 49–114 before 1–48. Its card milestones consequently occur 1, 0, 80, 115 in Donner order; corresp on card 0 excludes the empty reference verse 0.
- The reference English IT file has a stray n=188 between 1187 and 1189. This was normalized locally to 1188 for alignment only; the reference repository was not altered.
- A detected collision between shared-verse group IDs and ordinary record IDs was repaired before validation. Duplicate native citations are now restricted to explicit shared parts.
- A mistaken preliminary Trojan Women numeral repair (350 to 330) was rejected and reverted against BSB and the neighbouring anchors; the audit records its rejection.

Installation and validation status are recorded in Edition-inventory.json and Validation.json. The registry and existing author/work names are preserved and extended; no earlier translations are replaced.
