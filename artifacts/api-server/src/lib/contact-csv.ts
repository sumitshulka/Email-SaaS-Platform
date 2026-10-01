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