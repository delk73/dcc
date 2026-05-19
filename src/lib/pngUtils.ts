const crcTable = new Uint32Array(256);

for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = ((c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1));
  }
  crcTable[n] = c;
}

function crc32(buffer: Uint8Array): number {
  let crc = 0 ^ (-1);
  for (let i = 0; i < buffer.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ buffer[i]) & 0xFF];
  }
  return (crc ^ (-1)) >>> 0;
}

export function insertTextChunk(dataUrl: string, key: string, value: string): string {
  const base64 = dataUrl.split(',')[1];
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  const encoder = new TextEncoder();
  const keyBuf = encoder.encode(key);
  const valBuf = encoder.encode(value);
  const data = new Uint8Array(keyBuf.length + 1 + valBuf.length);
  data.set(keyBuf, 0);
  data[keyBuf.length] = 0; // null separator
  data.set(valBuf, keyBuf.length + 1);

  const type = encoder.encode('tEXt');
  const typeAndData = new Uint8Array(4 + data.length);
  typeAndData.set(type, 0);
  typeAndData.set(data, 4);

  const lenBuf = new DataView(new ArrayBuffer(4));
  lenBuf.setUint32(0, data.length, false);

  const crcBuf = new DataView(new ArrayBuffer(4));
  crcBuf.setUint32(0, crc32(typeAndData), false);

  const chunk = new Uint8Array(4 + 4 + data.length + 4);
  chunk.set(new Uint8Array(lenBuf.buffer), 0);
  chunk.set(type, 4);
  chunk.set(data, 8);
  chunk.set(new Uint8Array(crcBuf.buffer), 8 + data.length);

  // A standard PNG starts with an 8-byte signature.
  // The first chunk is always IHDR which is length(4) + type(4) + data(13) + crc(4) = 25 bytes.
  // 8 + 25 = 33 byte offset to insert our tEXt chunk.
  const newBytes = new Uint8Array(bytes.length + chunk.length);
  newBytes.set(bytes.subarray(0, 33), 0);
  newBytes.set(chunk, 33);
  newBytes.set(bytes.subarray(33), 33 + chunk.length);

  const blob = new Blob([newBytes], { type: 'image/png' });
  return URL.createObjectURL(blob);
}
