export type Point = { x: number; y: number };

export type NoFlyZone = {
  id: string;
  name: string;
  kind: 'rectangle' | 'polygon';
  points: Point[];
  color: string;
};

export type RoutePlan = {
  id?: string;
  name: string;
  createdAt?: string;
  updatedAt?: string;
  canvas: { width: number; height: number };
  start: Point;
  end: Point;
  waypoints: Point[];
  noFlyZones: NoFlyZone[];
};

export type ValidationIssue = {
  type: 'out-of-bounds' | 'no-fly-zone';
  message: string;
  segmentIndex?: number;
  zoneId?: string;
};

export type ValidationResult = {
  valid: boolean;
  distance: number;
  issues: ValidationIssue[];
};
