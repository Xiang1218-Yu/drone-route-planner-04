import type { NoFlyZone, Point, RoutePlan, ValidationResult } from './types';

const epsilon = 1e-8;

export const routePoints = (plan: Pick<RoutePlan, 'start' | 'end' | 'waypoints'>): Point[] => [plan.start, ...plan.waypoints, plan.end];

export const distanceBetween = (a: Point, b: Point): number => Math.hypot(b.x - a.x, b.y - a.y);

export const routeDistance = (points: Point[]): number => points.slice(1).reduce((total, point, index) => total + distanceBetween(points[index], point), 0);

const orientation = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

const onSegment = (a: Point, b: Point, p: Point) => p.x >= Math.min(a.x, b.x) - epsilon && p.x <= Math.max(a.x, b.x) + epsilon && p.y >= Math.min(a.y, b.y) - epsilon && p.y <= Math.max(a.y, b.y) + epsilon && Math.abs(orientation(a, b, p)) < epsilon;

const segmentsIntersect = (a: Point, b: Point, c: Point, d: Point) => {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  if (((o1 > epsilon && o2 < -epsilon) || (o1 < -epsilon && o2 > epsilon)) && ((o3 > epsilon && o4 < -epsilon) || (o3 < -epsilon && o4 > epsilon))) return true;
  return (Math.abs(o1) < epsilon && onSegment(a, b, c)) || (Math.abs(o2) < epsilon && onSegment(a, b, d)) || (Math.abs(o3) < epsilon && onSegment(c, d, a)) || (Math.abs(o4) < epsilon && onSegment(c, d, b));
};

const pointInPolygon = (point: Point, polygon: Point[]) => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    const intersects = ((a.y > point.y) !== (b.y > point.y)) && point.x < ((b.x - a.x) * (point.y - a.y)) / ((b.y - a.y) || epsilon) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
};

const segmentIntersectsZone = (start: Point, end: Point, zone: NoFlyZone) => {
  if (pointInPolygon(start, zone.points) || pointInPolygon(end, zone.points)) return true;
  return zone.points.some((point, index) => segmentsIntersect(start, end, point, zone.points[(index + 1) % zone.points.length]));
};

export function validateRoute(plan: RoutePlan): ValidationResult {
  const points = routePoints(plan);
  const issues: ValidationResult['issues'] = [];
  points.forEach((point, index) => {
    if (point.x < 0 || point.x > plan.canvas.width || point.y < 0 || point.y > plan.canvas.height) {
      issues.push({ type: 'out-of-bounds', message: `节点 ${index + 1} 超出画布范围` });
    }
  });
  points.slice(1).forEach((point, segmentIndex) => {
    plan.noFlyZones.forEach((zone) => {
      if (segmentIntersectsZone(points[segmentIndex], point, zone)) {
        issues.push({ type: 'no-fly-zone', message: `航段 ${segmentIndex + 1} 穿越禁飞区「${zone.name}」`, segmentIndex, zoneId: zone.id });
      }
    });
  });
  return { valid: issues.length === 0, distance: routeDistance(points), issues };
}
