export type CsvRecord = {
  rowNumber: number;
  cells: string[];
};

export class CsvSyntaxError extends Error {
  constructor(
    message: string,
    readonly rowNumber: number,
  ) {
    super(message);
    this.name = "CsvSyntaxError";
  }
}

export function parseCsvRecords(input: string): CsvRecord[] {
  const text = input.replace(/^\uFEFF/, "");
  const records: CsvRecord[] = [];
  let cells: string[] = [];
  let cell = "";
  let line = 1;
  let recordLine = 1;
  let inQuotes = false;
  let afterQuote = false;

  const pushCell = () => {
    cells.push(cell);
    cell = "";
    afterQuote = false;
  };
  const pushRecord = () => {
    pushCell();
    if (cells.some((value) => value.trim() !== "")) {
      records.push({ rowNumber: recordLine, cells });
    }
    cells = [];
    recordLine = line + 1;
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    const isNewline = character === "\n" || character === "\r";

    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          inQuotes = false;
          afterQuote = true;
        }
      } else if (isNewline) {
        if (character === "\r" && text[index + 1] === "\n") index += 1;
        cell += "\n";
        line += 1;
      } else {
        cell += character;
      }
      continue;
    }

    if (isNewline) {
      pushRecord();
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      line += 1;
      recordLine = line;
      continue;
    }

    if (character === ",") {
      pushCell();
      continue;
    }

    if (character === '"') {
      if (cell.length !== 0 || afterQuote) {
        throw new CsvSyntaxError("Unexpected quote in an unquoted field.", recordLine);
      }
      inQuotes = true;
      continue;
    }

    if (afterQuote) {
      if (character.trim() === "") continue;
      throw new CsvSyntaxError("Unexpected text after a quoted field.", recordLine);
    }

    cell += character;
  }

  if (inQuotes) {
    throw new CsvSyntaxError("A quoted field was not closed.", recordLine);
  }
  if (cells.length > 0 || cell.length > 0 || afterQuote) {
    pushRecord();
  }

  return records;
}

export function normalizeCsvHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export type RejectedContactCsvRow = {
  sourceValues: string[];
  reason: string;
};

export function buildRejectedContactsCsv(
  sourceHeaders: string[],
  rejectedRows: RejectedContactCsvRow[],
): string {
  if (rejectedRows.length === 0) return "";

  const maxSourceColumns = Math.max(
    sourceHeaders.length,
    ...rejectedRows.map((row) => row.sourceValues.length),
  );
  const outputHeaders = sourceHeaders.slice();
  for (let index = outputHeaders.length; index < maxSourceColumns; index += 1) {
    const baseHeader = `Extra column ${index - sourceHeaders.length + 1}`;
    let extraHeader = baseHeader;
    let suffix = 2;
    while (outputHeaders.includes(extraHeader)) {
      extraHeader = `${baseHeader} (${suffix})`;
      suffix += 1;
    }
    outputHeaders.push(extraHeader);
  }

  let reasonHeader = "Import rejection reason";
  let suffix = 2;
  while (outputHeaders.includes(reasonHeader)) {
    reasonHeader = `Import rejection reason (${suffix})`;
    suffix += 1;
  }

  const escapeField = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const lines = [
    [...outputHeaders, reasonHeader].map(escapeField).join(","),
    ...rejectedRows.map((row) => {
      const sourceValues = Array.from(
        { length: maxSourceColumns },
        (_, index) => row.sourceValues[index] ?? "",
      );
      return [...sourceValues, row.reason].map(escapeField).join(",");
    }),
  ];

  return `${lines.join("\r\n")}\r\n`;
}