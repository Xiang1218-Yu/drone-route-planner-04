import type { NoFlyZone, Point, RoutePlan } from './types.js';

export type RouteIssue = {
  type: 'out-of-bounds' | 'no-fly-zone';
  message: string;
  segmentIndex?: number;
  zoneId?: string;
};

export type RouteValidation = {
  valid: boolean;
  distance: number;
  issues: RouteIssue[];
};

const EPSILON = 1e-8;

export function routePoints(plan: Pick<RoutePlan, 'start' | 'end' | 'waypoints'>): Point[] {
  return [plan.start, ...plan.waypoints, plan.end];
}

export function distanceBetween(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function routeDistance(points: Point[]): number {
  return points.slice(1).reduce((total, point, index) => total + distanceBetween(points[index], point), 0);
}

export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    const intersects = ((a.y > point.y) !== (b.y > point.y)) &&
      (point.x < ((b.x - a.x) * (point.y - a.y)) / ((b.y - a.y) || EPSILON) + a.x);
    if (intersects) inside = !inside;
  }
  return inside;
}

function orientation(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function onSegment(a: Point, b: Point, p: Point): boolean {
  return p.x >= Math.min(a.x, b.x) - EPSILON && p.x <= Math.max(a.x, b.x) + EPSILON &&
    p.y >= Math.min(a.y, b.y) - EPSILON && p.y <= Math.max(a.y, b.y) + EPSILON &&
    Math.abs(orientation(a, b, p)) < EPSILON;
}

export function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);

  if (((o1 > EPSILON && o2 < -EPSILON) || (o1 < -EPSILON && o2 > EPSILON)) &&
      ((o3 > EPSILON && o4 < -EPSILON) || (o3 < -EPSILON && o4 > EPSILON))) return true;
  return (Math.abs(o1) < EPSILON && onSegment(a, b, c)) ||
    (Math.abs(o2) < EPSILON && onSegment(a, b, d)) ||
    (Math.abs(o3) < EPSILON && onSegment(c, d, a)) ||
    (Math.abs(o4) < EPSILON && onSegment(c, d, b));
}

export function zoneContainsPoint(zone: NoFlyZone, point: Point): boolean {
  return pointInPolygon(point, zone.points);
}

export function segmentIntersectsZone(start: Point, end: Point, zone: NoFlyZone): boolean {
  if (zoneContainsPoint(zone, start) || zoneContainsPoint(zone, end)) return true;
  return zone.points.some((point, index) => segmentsIntersect(start, end, point, zone.points[(index + 1) % zone.points.length]));
}

export function validateRoute(plan: RoutePlan): RouteValidation {
  const points = routePoints(plan);
  const issues: RouteIssue[] = [];
  const { width, height } = plan.canvas;

  points.forEach((point, index) => {
    if (point.x < 0 || point.x > width || point.y < 0 || point.y > height) {
      issues.push({ type: 'out-of-bounds', message: `节点 ${index + 1} (${point.x}, ${point.y}) 超出画布范围` });
    }
  });

  points.slice(1).forEach((point, index) => {
    const start = points[index];
    plan.noFlyZones.forEach((zone) => {
      if (segmentIntersectsZone(start, point, zone)) {
        issues.push({
          type: 'no-fly-zone',
          message: `航段 ${index + 1} 穿越禁飞区「${zone.name}」`,
          segmentIndex: index,
          zoneId: zone.id
        });
      }
    });
  });

  return { valid: issues.length === 0, distance: routeDistance(points), issues };
}
