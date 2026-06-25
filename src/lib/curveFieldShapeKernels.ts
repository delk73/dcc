import { clamp01 } from './curveSpaceIr';

const TWO_PI_OVER_THREE = (Math.PI * 2) / 3;
const HALF_PI_OVER_THREE = Math.PI / 3;

export function circleDistanceToT(localX: number, localY: number, radius: number): number {
  return clamp01(Math.hypot(localX, localY) / Math.max(0.001, radius));
}

export function triangleDistanceToT(
  localX: number,
  localY: number,
  radius: number,
  cornerRoundness: number
): number {
  const distance = Math.hypot(localX, localY);
  if (distance <= 0.000001) return 0;

  const angle = Math.atan2(localY, localX) + Math.PI / 2;
  const sectorAngle = angle - Math.floor((angle + HALF_PI_OVER_THREE) / TWO_PI_OVER_THREE) * TWO_PI_OVER_THREE;
  const triangleBoundary = Math.max(0.001, Math.cos(HALF_PI_OVER_THREE) / Math.max(0.35, Math.cos(sectorAngle)));
  const triangleT = distance / (Math.max(0.001, radius) * triangleBoundary);
  const roundedT = circleDistanceToT(localX, localY, radius);

  return clamp01(triangleT * (1 - cornerRoundness) + roundedT * cornerRoundness);
}