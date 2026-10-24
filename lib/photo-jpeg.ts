// Remove metadata segments from the native encoder's JPEG output. UIImage can
// generate an EXIF block even after re-encoding; never rely on that step alone.
// Keep JFIF, colour profiles and all image/scan bytes unchanged.
export function stripJpegMetadata(bytes: Uint8Array): Uint8Array {
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error("Photo is not a JPEG.");
    const parts: Uint8Array[] = [bytes.subarray(0, 2)];
    let offset = 2;
    while (offset < bytes.length) {
        const start = offset;
        if (bytes[offset++] !== 0xff) throw new Error("Photo could not be read.");
        while (bytes[offset] === 0xff) offset++;
        const marker = bytes[offset++];
        if (marker === 0xda || marker === 0xd9) { parts.push(bytes.subarray(start)); break; }
        const length = bytes[offset] * 256 + bytes[offset + 1];
        if (!Number.isInteger(length) || length < 2 || offset + length > bytes.length) throw new Error("Photo could not be read.");
        offset += length;
        if (![0xe1, 0xed, 0xfe].includes(marker)) parts.push(bytes.subarray(start, offset));
    }
    const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let position = 0;
    for (const part of parts) { output.set(part, position); position += part.length; }
    return output;
}
