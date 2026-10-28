// All distances in meters, based on regulation (USBC) lane dimensions.
// The lane runs along -Z: the foul line is at z = 0 and the pins are at z ≈ -18.3.

export const LANE = {
  width: 1.0541,
  halfWidth: 1.0541 / 2,
  boards: 39,
  gutterWidth: 0.235,
  gutterDepth: 0.115,
  /** Foul line to the back edge of the pin deck. */
  length: 19.25,
  approachLength: 4.8,
  headPinZ: -18.288,
  pinSpacing: 0.3048,
  rowSpacing: 0.26397,
  pitLength: 1.9,
  pitDepth: 0.55,
  /** Oil pattern length (40 ft); the dry back end is where the ball hooks. */
  oilLength: 12.2,
  arrowsZ: -4.57,
};

/** Spacing between neighbouring lanes in the hall. */
export const LANE_SPACING = 1.83;
export const DECOR_LANES = [-2, -1, 1, 2];

export const BALL_RADIUS = 0.1085;
export const PIN_HEIGHT = 0.381;
/** Height of a pin's centre of mass above its base. */
export const PIN_COM = 0.145;
export const PIN_MASS = 1.53;

export const HALL = {
  minX: -5.0,
  maxX: 5.0,
  backZ: 12,
  ceiling: 4.2,
};

/** Where the player may walk. */
export const WALK = {
  minX: -4.6,
  maxX: 4.6,
  minZ: 0.25,
  maxZ: 11.5,
};

/** Area of the playable approach from which a shot can be set up. */
export const APPROACH = {
  minX: -0.5,
  maxX: 0.5,
  minZ: 0.35,
  maxZ: 4.5,
};

export const THROW = {
  /** How far the player travels during the approach animation. */
  slideDistance: 1.15,
  minSpeed: 5.5,
  maxSpeed: 11.0,
  maxAimAngle: 0.07,
  /** Max lateral acceleration (m/s²) from spin on a dry lane. */
  hookAccel: 1.9,
};

export const MPS_TO_MPH = 2.23694;

/** Pin spots, numbered 1–10 (index 0 = headpin) as seen from the bowler. */
export const PIN_SPOTS: { x: number; z: number }[] = (() => {
  const spots: { x: number; z: number }[] = [];
  for (let row = 0; row < 4; row++) {
    for (let i = 0; i <= row; i++) {
      spots.push({
        x: (i - row / 2) * LANE.pinSpacing,
        z: LANE.headPinZ - row * LANE.rowSpacing,
      });
    }
  }
  return spots;
})();
