import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

const metadataPath = new URL(
  "../artifacts/mailflow-saas/src/lib/public-page-meta.ts",
  import.meta.url,
);
const metadataSource = await readFile(metadataPath, "utf8");
const originMatch = metadataSource.match(
  /export const SITE_ORIGIN = ['"]([^'"]+)['"];/,
);
const imagePathMatch = metadataSource.match(
  /export const SOCIAL_IMAGE_URL = `\$\{SITE_ORIGIN\}([^`]+)`;/,
);

if (!originMatch || !imagePathMatch) {
  throw new Error(
    `Could not read SITE_ORIGIN and SOCIAL_IMAGE_URL from ${fileURLToPath(metadataPath)}.`,
  );
}

const siteOrigin = new URL(originMatch[1]);
if (
  siteOrigin.protocol !== "https:" ||
  siteOrigin.origin !== originMatch[1].replace(/\/$/, "") ||
  siteOrigin.pathname !== "/" ||
  siteOrigin.search ||
  siteOrigin.hash ||
  siteOrigin.username ||
  siteOrigin.password
) {
  throw new Error(
    `SITE_ORIGIN must be a plain HTTPS origin; received "${originMatch[1]}".`,
  );
}

const imageUrl = new URL(imagePathMatch[1], siteOrigin);
if (
  imageUrl.origin !== siteOrigin.origin ||
  imageUrl.pathname !== "/mailflow-social-share.png" ||
  imageUrl.search ||
  imageUrl.hash
) {
  throw new Error(
    `SOCIAL_IMAGE_URL must resolve to /mailflow-social-share.png on SITE_ORIGIN; received "${imageUrl}".`,
  );
}

const timeoutMs = 15_000;
const maxImageBytes = 10 * 1024 * 1024;
const response = await fetch(imageUrl, {
  redirect: "follow",
  signal: AbortSignal.timeout(timeoutMs),
});

if (!response.ok) {
  throw new Error(
    `Share image request failed: ${response.status} ${response.statusText} from ${imageUrl}.`,
  );
}

const contentType = response.headers
  .get("content-type")
  ?.split(";", 1)[0]
  .trim()
  .toLowerCase();
if (contentType !== "image/png") {
  throw new Error(
    `Share image response must have Content-Type image/png; received "${contentType ?? "missing"}".`,
  );
}

const contentLength = Number(response.headers.get("content-length"));
if (Number.isFinite(contentLength) && contentLength > maxImageBytes) {
  throw new Error(
    `Share image exceeds the ${maxImageBytes}-byte safety limit.`,
  );
}

async function readBoundedBody(body, maxBytes) {
  if (!body) throw new Error("Share image response has no body.");

  const reader = body.getReader();
  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new Error(`Share image exceeds the ${maxBytes}-byte safety limit.`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, totalBytes);
}

const png = await readBoundedBody(response.body, maxImageBytes);

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function validatePng(buffer) {
  const signature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  if (
    buffer.length < signature.length ||
    !buffer.subarray(0, 8).equals(signature)
  ) {
    throw new Error("Share image response is not a PNG (invalid signature).");
  }

  let offset = 8;
  let header;
  let paletteSeen = false;
  let imageDataStarted = false;
  let imageDataEnded = false;
  let imageDataChunks = 0;
  let endSeen = false;
  const imageData = [];

  while (offset < buffer.length) {
    if (buffer.length - offset < 12) {
      throw new Error("PNG is truncated before a complete chunk.");
    }

    const length = buffer.readUInt32BE(offset);
    const chunkType = buffer.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    if (chunkEnd > buffer.length)
      throw new Error(`PNG ${chunkType} chunk is truncated.`);

    const chunkData = buffer.subarray(dataStart, dataEnd);
    const expectedCrc = buffer.readUInt32BE(dataEnd);
    if (crc32(buffer.subarray(offset + 4, dataEnd)) !== expectedCrc) {
      throw new Error(`PNG ${chunkType} chunk has an invalid checksum.`);
    }

    if (!header && chunkType !== "IHDR") {
      throw new Error("PNG must begin with an IHDR chunk.");
    }

    if (chunkType === "IHDR") {
      if (header || offset !== 8 || length !== 13) {
        throw new Error(
          "PNG must contain exactly one valid IHDR as its first chunk.",
        );
      }
      header = {
        width: chunkData.readUInt32BE(0),
        height: chunkData.readUInt32BE(4),
        bitDepth: chunkData[8],
        colorType: chunkData[9],
        compression: chunkData[10],
        filter: chunkData[11],
        interlace: chunkData[12],
      };
    } else if (chunkType === "PLTE") {
      if (
        paletteSeen ||
        imageDataStarted ||
        length === 0 ||
        length % 3 !== 0 ||
        length > 768
      ) {
        throw new Error("PNG has an invalid PLTE chunk.");
      }
      paletteSeen = true;
    } else if (chunkType === "IDAT") {
      if (imageDataEnded)
        throw new Error("PNG IDAT chunks must be consecutive.");
      imageDataStarted = true;
      imageDataChunks += 1;
      imageData.push(chunkData);
    } else {
      if (imageDataStarted) imageDataEnded = true;
      if (chunkType === "IEND") {
        if (length !== 0 || endSeen)
          throw new Error("PNG has an invalid IEND chunk.");
        endSeen = true;
      } else if (/^[A-Z]/.test(chunkType)) {
        throw new Error(
          `PNG contains an unsupported critical ${chunkType} chunk.`,
        );
      }
    }

    offset = chunkEnd;
    if (endSeen) {
      if (offset !== buffer.length)
        throw new Error("PNG has data after its IEND chunk.");
      break;
    }
  }

  if (!header || !imageDataChunks || !endSeen) {
    throw new Error("PNG is missing its IHDR, IDAT, or IEND chunk.");
  }
  if (header.width !== 1200 || header.height !== 630) {
    throw new Error(
      `Share image must be 1200×630; received ${header.width}×${header.height}.`,
    );
  }

  const channelsByColorType = new Map([
    [0, 1],
    [2, 3],
    [3, 1],
    [4, 2],
    [6, 4],
  ]);
  const channels = channelsByColorType.get(header.colorType);
  const validDepths = {
    0: [1, 2, 4, 8, 16],
    2: [8, 16],
    3: [1, 2, 4, 8],
    4: [8, 16],
    6: [8, 16],
  };
  if (
    !channels ||
    !validDepths[header.colorType]?.includes(header.bitDepth) ||
    header.compression !== 0 ||
    header.filter !== 0 ||
    ![0, 1].includes(header.interlace)
  ) {
    throw new Error(
      "PNG has unsupported or invalid image encoding parameters.",
    );
  }
  if ((header.colorType === 3) !== paletteSeen) {
    throw new Error("PNG palette presence does not match its color type.");
  }
  if (header.width === 0 || header.height === 0) {
    throw new Error("PNG dimensions must be greater than zero.");
  }

  let decoded;
  try {
    decoded = inflateSync(Buffer.concat(imageData));
  } catch (error) {
    throw new Error(`PNG image data cannot be decompressed: ${error.message}`);
  }

  const passes =
    header.interlace === 0
      ? [[0, 0, 1, 1]]
      : [
          [0, 0, 8, 8],
          [4, 0, 8, 8],
          [0, 4, 4, 8],
          [2, 0, 4, 4],
          [0, 2, 2, 4],
          [1, 0, 2, 2],
          [0, 1, 1, 2],
        ];
  const bitsPerPixel = channels * header.bitDepth;
  let decodedOffset = 0;
  for (const [startX, startY, stepX, stepY] of passes) {
    const passWidth = Math.max(0, Math.ceil((header.width - startX) / stepX));
    const passHeight = Math.max(0, Math.ceil((header.height - startY) / stepY));
    if (passWidth === 0 || passHeight === 0) continue;
    const rowBytes = Math.ceil((passWidth * bitsPerPixel) / 8);
    for (let row = 0; row < passHeight; row += 1) {
      if (decodedOffset + rowBytes + 1 > decoded.length) {
        throw new Error("PNG decompressed image data is truncated.");
      }
      const filterType = decoded[decodedOffset];
      if (filterType > 4)
        throw new Error(`PNG uses invalid filter type ${filterType}.`);
      decodedOffset += rowBytes + 1;
    }
  }
  if (decodedOffset !== decoded.length) {
    throw new Error("PNG decompressed image data has an unexpected length.");
  }
}

validatePng(png);
console.log(`Verified published share image: ${imageUrl} (1200×630 PNG).`);
