/** Zoom is relative to filling the square, so 1 preserves the default crop. */
export function fitImageZoom(width: number, height: number): number {
  return Math.min(width, height) / Math.max(width, height);
}

export function photoRect(
  sourceWidth: number,
  sourceHeight: number,
  size: number,
  zoom: number,
  positionX: number,
  positionY: number,
): { x: number; y: number; width: number; height: number } {
  const scale = Math.max(size / sourceWidth, size / sourceHeight) * zoom;
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  const horizontalRoom = Math.max(0, (width - size) / 2);
  const verticalRoom = Math.max(0, (height - size) / 2);
  return {
    x: (size - width) / 2 + (positionX / 100) * horizontalRoom,
    y: (size - height) / 2 + (positionY / 100) * verticalRoom,
    width,
    height,
  };
}
