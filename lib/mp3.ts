// Duration from MPEG Layer III frames, including variable bitrate streams. No decoder needed.
export function mp3Duration(data: Uint8Array): number | undefined {
  let offset = 0,
    seconds = 0,
    frames = 0;
  if (data[0] === 73 && data[1] === 68 && data[2] === 51 && data.length >= 10) {
    offset =
      10 +
      (((data[6] & 127) << 21) |
        ((data[7] & 127) << 14) |
        ((data[8] & 127) << 7) |
        (data[9] & 127));
    if (data[5] & 16) offset += 10;
  }
  while (offset + 4 <= data.length) {
    const a = data[offset],
      b = data[offset + 1],
      c = data[offset + 2];
    const version = (b >> 3) & 3,
      layer = (b >> 1) & 3,
      rate = (c >> 2) & 3,
      bitrate = c >> 4;
    if (
      a !== 255 ||
      (b & 224) !== 224 ||
      version === 1 ||
      layer !== 1 ||
      rate === 3 ||
      bitrate === 0 ||
      bitrate === 15
    ) {
      offset++;
      continue;
    }
    const kbps = (
      version === 3
        ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
        : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
    )[bitrate];
    const hz =
      [44100, 48000, 32000][rate] / (version === 3 ? 1 : version === 2 ? 2 : 4);
    const bytes =
      Math.floor(((version === 3 ? 144 : 72) * kbps * 1000) / hz) +
      ((c >> 1) & 1);
    if (offset + bytes > data.length) break;
    seconds += (version === 3 ? 1152 : 576) / hz;
    frames++;
    offset += bytes;
  }
  return frames > 1 && Number.isFinite(seconds)
    ? Math.round(seconds * 1000) / 1000
    : undefined;
}
