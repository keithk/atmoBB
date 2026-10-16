import { describe, expect, it } from 'vitest';
import { fitImageZoom, photoRect } from './crop';

describe('avatar cropping', () => {
  it.each([
    [800, 1200],
    [1200, 800],
    [1000, 1000],
    [100, 10000],
    [10000, 100],
  ])('can fit the entire %i × %i photo without clipping', (width, height) => {
    const zoom = fitImageZoom(width, height);
    expect(zoom).toBeGreaterThan(0);
    expect(zoom).toBeLessThanOrEqual(1);
    // Borders change the drawable square, not the zoom needed to fit.
    for (const size of [100, 98, 94, 88]) {
      const rect = photoRect(width, height, size, zoom, 0, 0);
      expect(rect.x).toBeGreaterThanOrEqual(-1e-10);
      expect(rect.y).toBeGreaterThanOrEqual(-1e-10);
      expect(rect.x + rect.width).toBeLessThanOrEqual(size + 1e-10);
      expect(rect.y + rect.height).toBeLessThanOrEqual(size + 1e-10);
      expect(Math.max(rect.width, rect.height)).toBeCloseTo(size);
      expect(rect.width / rect.height).toBeCloseTo(width / height);
    }
  });

  it('keeps the existing centered fill crop at 100% zoom', () => {
    expect(photoRect(800, 1200, 98, 1, 0, 0)).toEqual({
      x: 0, y: -24.5, width: 98, height: 147,
    });
  });

  it('allows a filled portrait to be aligned to its top or bottom edge', () => {
    expect(photoRect(800, 1200, 98, 1, 0, 100).y).toBe(0);
    const bottom = photoRect(800, 1200, 98, 1, 0, -100);
    expect(bottom.y + bottom.height).toBe(98);
  });

  it('keeps the fitted photo centered on axes smaller than the square', () => {
    const zoom = fitImageZoom(800, 1200);
    expect(photoRect(800, 1200, 98, zoom, 100, -100))
      .toEqual(photoRect(800, 1200, 98, zoom, 0, 0));
  });
});
