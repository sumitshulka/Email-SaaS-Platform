---
name: ExcelJS streaming worksheet setup
description: Constraints for configuring worksheets in streamed Excel downloads.
---

For ExcelJS `WorkbookWriter`, worksheet settings such as `views` are getter-only after worksheet creation; provide them through `addWorksheet` options. Streamed workbook setup can emit ZIP bytes before later initialization fails, which may leave a partial download.

**Why:** Assigning frozen-pane settings after creating a streaming worksheet threw before the export handler reached its response error handling.

**How to apply:** Check the streaming writer API when configuring export worksheets, provide settings during sheet creation, and keep writer setup within the export error boundary.
