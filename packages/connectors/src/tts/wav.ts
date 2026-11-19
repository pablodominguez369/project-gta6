/**
 * Minimal PCM WAV writer (mono, 16-bit). Used by the fake TTS so development and tests produce
 * real, playable audio of a known duration without any provider or binary.
 */
export function encodeWav(samples: Int16Array, sampleRate: number): Uint8Array {
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(36, "data");
  view.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i += 1) view.setInt16(44 + i * 2, samples[i] ?? 0, true);
  return new Uint8Array(buffer);
}

/** A quiet tone (one "beep" per word) so the fake voice is audible but obviously not speech. */
export function fakeSpeechSamples(
  words: number,
  durationMs: number,
  sampleRate: number,
): Int16Array {
  const total = Math.round((durationMs / 1000) * sampleRate);
  const samples = new Int16Array(total);
  const perWord = words > 0 ? total / words : total;
  for (let i = 0; i < total; i += 1) {
    const inWord = (i % perWord) / perWord;
    // Sound for the first 60 % of each word slot, silence after.
    if (words > 0 && inWord < 0.6) {
      samples[i] = Math.round(Math.sin((2 * Math.PI * 220 * i) / sampleRate) * 3000);
    }
  }
  return samples;
}

/**
 * Duration of a PCM WAV file from its header, walking the RIFF chunks (providers may add chunks
 * such as LIST before "data"). Returns null when the bytes are not a readable WAV file.
 */
export function readWavDurationMs(bytes: Uint8Array): number | null {
  if (bytes.length < 12) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (offset: number) =>
    String.fromCharCode(
      bytes[offset] ?? 0,
      bytes[offset + 1] ?? 0,
      bytes[offset + 2] ?? 0,
      bytes[offset + 3] ?? 0,
    );
  if (ascii(0) !== "RIFF" || ascii(8) !== "WAVE") return null;
  let byteRate: number | null = null;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = ascii(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt " && body + 12 <= bytes.length) {
      byteRate = view.getUint32(body + 8, true);
    } else if (id === "data") {
      if (!byteRate) return null;
      // Some encoders write 0 or 0xFFFFFFFF when streaming: use what is actually there.
      const available = bytes.length - body;
      const dataBytes = size === 0 || size > available ? available : size;
      return Math.round((dataBytes / byteRate) * 1000);
    }
    offset = body + size + (size % 2);
  }
  return null;
}
