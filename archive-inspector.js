/* Preflight validation for JAR/ZIP archives.
 * Reads ZIP metadata before JSZip is allowed to inflate entries.
 * Uploaded class files and resources are inspected as data only; they are never executed.
 */
(function (root) {
  "use strict";

  const DEFAULT_LIMITS = Object.freeze({
    maxArchiveBytes: 256 * 1024 * 1024,
    maxEntries: 50000,
    maxEntryUncompressedBytes: 64 * 1024 * 1024,
    maxTotalUncompressedBytes: 512 * 1024 * 1024,
    maxCompressionRatio: 1000
  });
  const EOCD = 0x06054b50;
  const ZIP64_EOCD = 0x06064b50;
  const ZIP64_LOCATOR = 0x07064b50;
  const CENTRAL_FILE = 0x02014b50;
  const LOCAL_FILE = 0x04034b50;
  const DATA_DESCRIPTOR = 0x08074b50;
  const UTF8_FLAG = 0x0800;
  const ENCRYPTION_FLAGS = 0x2041; // traditional, strong, and masked-header encryption

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
      crc ^= bytes[i];
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function u64(view, offset) {
    const low = view.getUint32(offset, true);
    const high = view.getUint32(offset + 4, true);
    const value = (BigInt(high) << 32n) | BigInt(low);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("ZIP64 value exceeds the safe integer range");
    return Number(value);
  }

  function decoder(label, fatal) {
    try { return new TextDecoder(label, { fatal: !!fatal }); }
    catch (_) { return null; }
  }

  function parseExtra(view, bytes, start, length) {
    const fields = new Map();
    let p = start, end = start + length;
    while (p < end) {
      if (end - p < 4) throw new Error("truncated ZIP extra-field header");
      const id = view.getUint16(p, true), size = view.getUint16(p + 2, true);
      p += 4;
      if (p + size > end) throw new Error("ZIP extra-field exceeds its declared boundary");
      if (!fields.has(id)) fields.set(id, bytes.subarray(p, p + size));
      p += size;
    }
    return fields;
  }

  function decodeName(bytes, flags, extras) {
    if (flags & UTF8_FLAG) {
      const utf8 = decoder("utf-8", true);
      if (!utf8) throw new Error("UTF-8 decoder is unavailable");
      return utf8.decode(bytes);
    }
    const unicode = extras && extras.get(0x7075);
    if (unicode && unicode.length >= 5 && unicode[0] === 1) {
      const expected = (unicode[1] | (unicode[2] << 8) | (unicode[3] << 16) | (unicode[4] << 24)) >>> 0;
      if (crc32(bytes) === expected) {
        const utf8 = decoder("utf-8", true);
        if (utf8) return utf8.decode(unicode.subarray(5));
      }
    }
    const cp437 = decoder("ibm437", false);
    if (cp437) return cp437.decode(bytes);
    return decoder("windows-1252", false).decode(bytes);
  }

  function zip64Values(extras, needs) {
    const requested = needs.filter(Boolean).length;
    if (!requested) return {};
    const field = extras.get(0x0001);
    if (!field) throw new Error("ZIP64 sentinel value has no ZIP64 extra field");
    const view = new DataView(field.buffer, field.byteOffset, field.byteLength);
    let p = 0;
    const result = {};
    function read64(key) {
      if (p + 8 > view.byteLength) throw new Error("truncated ZIP64 extra field (" + key + ")");
      result[key] = u64(view, p); p += 8;
    }
    function read32(key) {
      if (p + 4 > view.byteLength) throw new Error("truncated ZIP64 extra field (" + key + ")");
      result[key] = view.getUint32(p, true); p += 4;
    }
    if (needs[0]) read64("uncompressedSize");
    if (needs[1]) read64("compressedSize");
    if (needs[2]) read64("localOffset");
    if (needs[3]) read32("diskStart");
    return result;
  }

  function canonicalPath(path) {
    if (typeof path !== "string" || !path || path.includes("\0") || path.includes("\\") ||
        path.startsWith("/") || /^[A-Za-z]:/.test(path) || path.startsWith("//")) return null;
    const directory = path.endsWith("/");
    const parts = path.split("/");
    if (directory) parts.pop();
    if (!parts.length || parts.some(part => !part || part === "." || part === "..")) return null;
    const normalized = parts.join("/");
    return typeof normalized.normalize === "function" ? normalized.normalize("NFC") : normalized;
  }

  function inspect(input, overrides) {
    const limits = Object.assign({}, DEFAULT_LIMITS, overrides || {});
    const errors = [], warnings = [], entries = [], seen = new Map(), caseSeen = new Map();
    const result = {
      schema: "jar2zeus.archive-preflight.v1",
      valid: false,
      fatal: true,
      archive: { bytes: 0, entries: 0, files: 0, directories: 0, centralDirectoryBytes: 0, zip64: false },
      totals: { compressedBytes: 0, uncompressedBytes: 0, classFiles: 0, classBytes: 0, assetFiles: 0, dataFiles: 0, nestedJars: 0 },
      limits,
      entries,
      errors,
      warnings
    };
    function fail(message) { if (!errors.includes(message)) errors.push(message); }
    try {
      let bytes;
      if (input instanceof ArrayBuffer) bytes = new Uint8Array(input);
      else if (ArrayBuffer.isView(input)) bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
      else throw new Error("input must be an ArrayBuffer or typed-array view");
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const size = view.byteLength;
      result.archive.bytes = size;
      if (size < 22) throw new Error("file is too small to contain a ZIP end record");
      if (size > limits.maxArchiveBytes) throw new Error("archive exceeds the compressed input limit (" + limits.maxArchiveBytes + " bytes)");

      const floor = Math.max(0, size - 22 - 65535);
      let eocd = -1;
      for (let p = size - 22; p >= floor; p--) {
        if (view.getUint32(p, true) === EOCD) {
          const commentLength = view.getUint16(p + 20, true);
          if (p + 22 + commentLength === size) { eocd = p; break; }
        }
      }
      if (eocd < 0) throw new Error("ZIP end-of-central-directory record was not found or trailing bytes are present");

      const diskNumber = view.getUint16(eocd + 4, true);
      const centralDisk = view.getUint16(eocd + 6, true);
      let diskEntries = view.getUint16(eocd + 8, true);
      let totalEntries = view.getUint16(eocd + 10, true);
      let centralSize = view.getUint32(eocd + 12, true);
      let centralOffset = view.getUint32(eocd + 16, true);
      if (diskNumber !== 0 || centralDisk !== 0) throw new Error("multi-disk ZIP archives are not supported");
      let zip64Offset = eocd;
      const hasZip64Sentinel = diskEntries === 0xffff || totalEntries === 0xffff ||
        centralSize === 0xffffffff || centralOffset === 0xffffffff;
      if (hasZip64Sentinel) {
        if (eocd < 20 || view.getUint32(eocd - 20, true) !== ZIP64_LOCATOR)
          throw new Error("ZIP64 archive is missing its locator");
        const locator = eocd - 20;
        const locatorDisk = view.getUint32(locator + 4, true);
        const zip64Position = u64(view, locator + 8);
        const totalDisks = view.getUint32(locator + 16, true);
        if (locatorDisk !== 0 || totalDisks !== 1) throw new Error("multi-disk ZIP64 archives are not supported");
        if (zip64Position + 56 > size || view.getUint32(zip64Position, true) !== ZIP64_EOCD)
          throw new Error("invalid ZIP64 end-of-central-directory record");
        const recordSize = u64(view, zip64Position + 4);
        if (recordSize < 44 || zip64Position + 12 + recordSize > locator)
          throw new Error("invalid ZIP64 end-record size or boundary");
        const zipDisk = view.getUint32(zip64Position + 16, true);
        const zipCentralDisk = view.getUint32(zip64Position + 20, true);
        if (zipDisk !== 0 || zipCentralDisk !== 0) throw new Error("multi-disk ZIP64 archives are not supported");
        diskEntries = u64(view, zip64Position + 24);
        totalEntries = u64(view, zip64Position + 32);
        centralSize = u64(view, zip64Position + 40);
        centralOffset = u64(view, zip64Position + 48);
        if (diskEntries !== totalEntries) throw new Error("ZIP64 entry counts disagree");
        zip64Offset = zip64Position;
        result.archive.zip64 = true;
      } else if (diskEntries !== totalEntries) {
        throw new Error("central-directory entry counts disagree");
      }

      if (totalEntries > limits.maxEntries) throw new Error("archive contains more entries than the configured limit (" + limits.maxEntries + ")");
      if (centralOffset + centralSize > zip64Offset || centralOffset < 0 || centralSize < 0)
        throw new Error("central directory lies outside the ZIP data area");
      result.archive.centralDirectoryBytes = centralSize;
      result.archive.entries = totalEntries;

      let p = centralOffset;
      const centralEnd = centralOffset + centralSize;
      const ranges = [];
      for (let i = 0; i < totalEntries; i++) {
        if (p + 46 > centralEnd || view.getUint32(p, true) !== CENTRAL_FILE)
          throw new Error("invalid or truncated central-directory entry at index " + i);
        const madeBy = view.getUint16(p + 4, true);
        const flags = view.getUint16(p + 8, true);
        const method = view.getUint16(p + 10, true);
        const crc = view.getUint32(p + 16, true);
        let compressedSize = view.getUint32(p + 20, true);
        let uncompressedSize = view.getUint32(p + 24, true);
        const nameLength = view.getUint16(p + 28, true);
        const extraLength = view.getUint16(p + 30, true);
        const commentLength = view.getUint16(p + 32, true);
        let diskStart = view.getUint16(p + 34, true);
        const externalAttributes = view.getUint32(p + 38, true);
        let localOffset = view.getUint32(p + 42, true);
        const end = p + 46 + nameLength + extraLength + commentLength;
        if (end > centralEnd) throw new Error("central-directory entry exceeds its declared boundary");
        const nameBytes = bytes.subarray(p + 46, p + 46 + nameLength);
        const extraStart = p + 46 + nameLength;
        const extras = parseExtra(view, bytes, extraStart, extraLength);
        const needUncompressed = uncompressedSize === 0xffffffff;
        const needCompressed = compressedSize === 0xffffffff;
        const needOffset = localOffset === 0xffffffff;
        const needDisk = diskStart === 0xffff;
        const z64 = zip64Values(extras, [needUncompressed, needCompressed, needOffset, needDisk]);
        if (needUncompressed) uncompressedSize = z64.uncompressedSize;
        if (needCompressed) compressedSize = z64.compressedSize;
        if (needOffset) localOffset = z64.localOffset;
        if (needDisk) diskStart = z64.diskStart;
        if (diskStart !== 0) throw new Error("entry uses a non-zero disk number");
        if (flags & ENCRYPTION_FLAGS) throw new Error("encrypted ZIP entries are not supported: entry " + i);
        if (flags & 0x0020) throw new Error("patched-data ZIP entries are not supported: entry " + i);
        if (method !== 0 && method !== 8) throw new Error("unsupported ZIP compression method " + method + " at entry " + i);
        if (method === 0 && compressedSize !== uncompressedSize)
          throw new Error("stored ZIP entry has inconsistent compressed/uncompressed sizes at entry " + i);
        const path = decodeName(nameBytes, flags, extras);
        const canonical = canonicalPath(path);
        if (!canonical) throw new Error("unsafe or non-canonical archive path: " + JSON.stringify(path));
        const directory = path.endsWith("/");
        if (directory && (uncompressedSize !== 0 || compressedSize !== 0))
          warnings.push("directory entry contains data: " + path);
        const existing = seen.get(canonical);
        if (existing) throw new Error("duplicate or normalized-collision archive path: " + path + " conflicts with " + existing);
        seen.set(canonical, path);
        const folded = canonical.toLowerCase();
        if (caseSeen.has(folded) && caseSeen.get(folded) !== canonical)
          warnings.push("case-insensitive path collision: " + path + " conflicts with " + caseSeen.get(folded));
        else caseSeen.set(folded, canonical);

        if (uncompressedSize > limits.maxEntryUncompressedBytes)
          throw new Error("entry exceeds the per-file uncompressed limit: " + path);
        result.totals.compressedBytes += compressedSize;
        result.totals.uncompressedBytes += uncompressedSize;
        if (result.totals.uncompressedBytes > limits.maxTotalUncompressedBytes)
          throw new Error("archive exceeds the total uncompressed-size limit");
        const ratio = compressedSize === 0 ? (uncompressedSize === 0 ? 1 : Infinity) : uncompressedSize / compressedSize;
        if (ratio > limits.maxCompressionRatio)
          throw new Error("suspicious compression ratio at entry " + path + " (" + (Number.isFinite(ratio) ? ratio.toFixed(1) : "infinite") + ":1)");
        const unixHost = (madeBy >>> 8) === 3;
        const unixMode = unixHost ? (externalAttributes >>> 16) & 0xffff : 0;
        if ((unixMode & 0xf000) === 0xa000) throw new Error("symbolic-link ZIP entries are not accepted: " + path);

        const isClass = /\.class$/i.test(path);
        if (!directory && isClass) { result.totals.classFiles++; result.totals.classBytes += uncompressedSize; }
        if (!directory && path.startsWith("assets/")) result.totals.assetFiles++;
        if (!directory && path.startsWith("data/")) result.totals.dataFiles++;
        if (!directory && /\.jar$/i.test(path)) result.totals.nestedJars++;

        if (localOffset + 30 > centralOffset || view.getUint32(localOffset, true) !== LOCAL_FILE)
          throw new Error("invalid local-file header for " + path);
        const localFlags = view.getUint16(localOffset + 6, true);
        const localMethod = view.getUint16(localOffset + 8, true);
        const localCrc = view.getUint32(localOffset + 14, true);
        const localCompressed = view.getUint32(localOffset + 18, true);
        const localUncompressed = view.getUint32(localOffset + 22, true);
        const localNameLength = view.getUint16(localOffset + 26, true);
        const localExtraLength = view.getUint16(localOffset + 28, true);
        const dataStart = localOffset + 30 + localNameLength + localExtraLength;
        if (dataStart > centralOffset || dataStart + compressedSize > centralOffset)
          throw new Error("compressed data range is outside the file-data area: " + path);
        if (localFlags !== flags || localMethod !== method)
          throw new Error("local and central ZIP flags/method disagree: " + path);
        if (localNameLength !== nameLength) throw new Error("local and central filenames differ in length: " + path);
        for (let j = 0; j < nameLength; j++) {
          if (bytes[localOffset + 30 + j] !== nameBytes[j])
            throw new Error("local and central filenames disagree: " + path);
        }
        const localExtraStart = localOffset + 30 + localNameLength;
        const localExtras = parseExtra(view, bytes, localExtraStart, localExtraLength);
        const usesDescriptor = (flags & 0x0008) !== 0;
        if (!usesDescriptor) {
          let lc = localCompressed, lu = localUncompressed;
          if (localCompressed === 0xffffffff || localUncompressed === 0xffffffff) {
            const lz = zip64Values(localExtras, [localUncompressed === 0xffffffff, localCompressed === 0xffffffff, false, false]);
            if (localUncompressed === 0xffffffff) lu = lz.uncompressedSize;
            if (localCompressed === 0xffffffff) lc = lz.compressedSize;
          }
          if (localCrc !== crc || lc !== compressedSize || lu !== uncompressedSize)
            throw new Error("local and central size/CRC fields disagree: " + path);
        } else if ((localCrc && localCrc !== crc) ||
          (localCompressed && localCompressed !== 0xffffffff && localCompressed !== compressedSize) ||
          (localUncompressed && localUncompressed !== 0xffffffff && localUncompressed !== uncompressedSize)) {
          throw new Error("local descriptor placeholder fields conflict with central values: " + path);
        }
        let recordEnd = dataStart + compressedSize;
        if (usesDescriptor) {
          let d = recordEnd;
          if (d + 4 <= centralOffset && view.getUint32(d, true) === DATA_DESCRIPTOR) d += 4;
          const wide = needCompressed || needUncompressed;
          const descriptorBytes = 4 + (wide ? 16 : 8);
          if (d + descriptorBytes > centralOffset) throw new Error("truncated ZIP data descriptor: " + path);
          const descriptorCrc = view.getUint32(d, true); d += 4;
          const descriptorCompressed = wide ? u64(view, d) : view.getUint32(d, true); d += wide ? 8 : 4;
          const descriptorUncompressed = wide ? u64(view, d) : view.getUint32(d, true); d += wide ? 8 : 4;
          if (descriptorCrc !== crc || descriptorCompressed !== compressedSize || descriptorUncompressed !== uncompressedSize)
            throw new Error("ZIP data descriptor disagrees with central directory: " + path);
          recordEnd = d;
        }
        ranges.push({ start: localOffset, end: recordEnd, path });
        const entryRecord = {
          path, canonicalPath: canonical, directory, flags, method, crc32: crc,
          compressedSize, uncompressedSize, compressionRatio: Number.isFinite(ratio) ? ratio : null,
          localOffset, dataOffset: dataStart, platform: unixHost ? "unix" : "other",
          executable: unixHost && (unixMode & 0x49) !== 0
        };
        // Keep raw filename bytes out of JSON reports while allowing JSZip to decode
        // the exact same names that were already validated here.
        Object.defineProperty(entryRecord, "_rawName", { value: new Uint8Array(nameBytes), enumerable: false });
        entries.push(entryRecord);
        p = end;
      }
      if (p > centralEnd) throw new Error("central directory parser overran its boundary");
      if (p < centralEnd) {
        // Optional central-directory digital signature (0x05054b50).
        if (centralEnd - p < 6 || view.getUint32(p, true) !== 0x05054b50 ||
            p + 6 + view.getUint16(p + 4, true) !== centralEnd)
          throw new Error("unexpected trailing data inside the central directory");
      }
      ranges.sort((a, b) => a.start - b.start);
      for (let i = 1; i < ranges.length; i++) {
        if (ranges[i].start < ranges[i - 1].end)
          throw new Error("overlapping local ZIP records: " + ranges[i - 1].path + " and " + ranges[i].path);
      }
      result.archive.files = entries.filter(e => !e.directory).length;
      result.archive.directories = entries.filter(e => e.directory).length;
      result.valid = errors.length === 0;
      result.fatal = !result.valid;
    } catch (error) {
      fail(String(error && error.message || error));
      result.valid = false;
      result.fatal = true;
    }
    return result;
  }

  function bytesKey(bytes) {
    let key = "";
    for (let i = 0; i < bytes.length; i++) key += bytes[i].toString(16).padStart(2, "0");
    return key;
  }

  function createDecoder(entries) {
    const names = new Map();
    for (const entry of entries || []) {
      if (entry && entry._rawName instanceof Uint8Array) names.set(bytesKey(entry._rawName), entry.path);
    }
    return function (input) {
      const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
      const known = names.get(bytesKey(bytes));
      if (known !== undefined) return known;
      const utf8 = decoder("utf-8", false);
      return utf8 ? utf8.decode(bytes) : decoder("ibm437", false).decode(bytes);
    };
  }

  root.Jar2ZeusArchive = {
    inspect,
    decodeName,
    createDecoder,
    canonicalPath,
    crc32,
    defaults: DEFAULT_LIMITS
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
