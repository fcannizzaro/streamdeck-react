import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTick } from "./utility";
import { usePrevious } from "./utility";

// ── Animation System ────────────────────────────────────────────────
//
// Two animation primitives for Stream Deck key/dial rendering:
//
//   useSpring — Physics-based (damped harmonic oscillator)
//     Natural-feeling motion with overshoot and settling.
//     Good for: press feedback, bouncy transitions, organic movement.
//
//     Physics model (semi-implicit Euler integration):
//
//       ┌─── target position
//       │  ┌─── current position
//       │  │
//       F_spring  = -tension × (position - target)
//       F_damping = -friction × velocity
//       acceleration = (F_spring + F_damping) / mass
//
//       velocity' = velocity + acceleration × dt    ← update velocity first
//       position' = position + velocity' × dt       ← then position
//
//     Semi-implicit Euler (velocity first, then position) is more
//     stable at low/variable frame rates than explicit Euler (position
//     first) which can explode with large dt values.
//
//   useTween — Duration + easing-based
//     Predictable timing with easing curves.
//     Good for: fades, progress bars, timed transitions.
//
// Both hooks support:
//   - Single numbers: useSpring(pressed ? 0.85 : 1)
//   - Object of numbers: useSpring({ x: 10, opacity: 0.5 })
//   - Mid-animation retarget (no discontinuity)
//   - Conditional tick loop (only runs while animating)
//   - Imperative set() and jump() API
//
// Channel system:
//   Internally, both scalar and object targets are normalized to a
//   Map<string, number>.  Scalars use a sentinel key "_" (SCALAR_KEY).
//   This allows the same stepping/interpolation code to handle both.

// ── Types ───────────────────────────────────────────────────────────

/** A single number or a flat object of named numbers. */
export type AnimationTarget = number | Record<string, number>;

/** Maps an AnimationTarget shape to its animated output shape. */
export type AnimatedValue<T extends AnimationTarget> = T extends number
  ? number
  : { [K in keyof T]: number };

// ── Spring Types ────────────────────────────────────────────────────

export interface SpringConfig {
  /** Stiffness coefficient (force per unit displacement). @default 170 */
  tension: number;
  /** Damping coefficient (force per unit velocity). @default 26 */
  friction: number;
  /** Mass of the simulated object. @default 1 */
  mass: number;
  /** Absolute velocity threshold below which the spring settles. @default 0.01 */
  velocityThreshold: number;
  /** Absolute displacement threshold below which the spring settles. @default 0.005 */
  displacementThreshold: number;
  /** Clamp output to target (no overshoot). @default false */
  clamp: boolean;
}

export interface SpringResult<T extends AnimationTarget> {
  /** Current interpolated value(s). */
  value: AnimatedValue<T>;
  /** Whether the spring is still in motion. */
  isAnimating: boolean;
  /** Imperatively update the target. */
  set: (target: T) => void;
  /** Jump immediately to a value (no animation). */
  jump: (target: T) => void;
}

// ── Tween Types ─────────────────────────────────────────────────────

export type EasingName =
  | "linear"
  | "easeIn"
  | "easeOut"
  | "easeInOut"
  | "easeInCubic"
  | "easeOutCubic"
  | "easeInOutCubic"
  | "easeInBack"
  | "easeOutBack"
  | "easeOutBounce";

export type EasingFn = (t: number) => number;

export interface TweenConfig {
  /** Duration in milliseconds. @default 300 */
  duration: number;
  /** Easing function name or custom (t: number) => number. @default "easeOut" */
  easing: EasingName | EasingFn;
  /** Target FPS for the animation tick loop. @default 60 */
  fps: number;
}

export interface TweenResult<T extends AnimationTarget> {
  /** Current interpolated value(s). */
  value: AnimatedValue<T>;
  /** 0..1 normalized progress of the current transition. */
  progress: number;
  /** Whether the tween is still running. */
  isAnimating: boolean;
  /** Imperatively update the target (starts a new tween from current value). */
  set: (target: T) => void;
  /** Jump immediately to a value (no animation). */
  jump: (target: T) => void;
}

// ── Spring Physics ──────────────────────────────────────────────────

interface SpringState {
  position: number;
  velocity: number;
}

const SPRING_DEFAULTS: SpringConfig = {
  tension: 170,
  friction: 26,
  mass: 1,
  velocityThreshold: 0.01,
  displacementThreshold: 0.005,
  clamp: false,
};

const TWEEN_DEFAULTS: TweenConfig = {
  duration: 300,
  easing: "easeOut",
  fps: 60,
};

/** Max dt cap to prevent spring explosion after long pauses.
 *  If the process is suspended (debugger, GC pause), dt could be
 *  seconds-long, causing the spring to overshoot wildly.  Capping
 *  at ~64ms (roughly one frame at 15fps) keeps the simulation stable. */
const MAX_DT_SEC = 0.064;

/**
 * Semi-implicit Euler step for a damped harmonic oscillator.
 * Updates velocity first, then position — stable at low frame rates.
 */
export function stepSpring(
  state: SpringState,
  target: number,
  config: SpringConfig,
  dtSeconds: number,
): SpringState {
  const { tension, friction, mass } = config;
  const displacement = state.position - target;
  const springForce = -tension * displacement;
  const dampingForce = -friction * state.velocity;
  const acceleration = (springForce + dampingForce) / mass;

  let velocity = state.velocity + acceleration * dtSeconds;
  let position = state.position + velocity * dtSeconds;

  if (config.clamp) {
    if ((displacement > 0 && position < target) || (displacement < 0 && position > target)) {
      position = target;
      velocity = 0;
    }
  }

  return { position, velocity };
}

/** Check if a spring channel has come to rest. */
export function isSettled(state: SpringState, target: number, config: SpringConfig): boolean {
  return (
    Math.abs(state.velocity) < config.velocityThreshold &&
    Math.abs(state.position - target) < config.displacementThreshold
  );
}

// ── Spring Presets ──────────────────────────────────────────────────

export const SpringPresets = {
  /** Default balanced spring. */
  default: { tension: 170, friction: 26, mass: 1 },
  /** Quick and responsive with slight overshoot. Good for press feedback. */
  stiff: { tension: 400, friction: 28, mass: 1 },
  /** Bouncy with visible oscillation. Good for playful UIs. */
  wobbly: { tension: 180, friction: 12, mass: 1 },
  /** Slow and smooth. Good for background transitions. */
  gentle: { tension: 120, friction: 14, mass: 1 },
  /** Very slow, molasses-like. Good for ambient drift. */
  molasses: { tension: 80, friction: 30, mass: 1 },
  /** Snappy with no overshoot. Good for precise UI elements. */
  snap: { tension: 300, friction: 36, mass: 1, clamp: true },
  /** Heavy object feel. */
  heavy: { tension: 200, friction: 20, mass: 3 },
} as const satisfies Record<string, Partial<SpringConfig>>;

// ── Easing Functions ────────────────────────────────────────────────

export const Easings: Record<EasingName, EasingFn> = {
  linear: (t) => t,
  easeIn: (t) => t * t,
  easeOut: (t) => t * (2 - t),
  easeInOut: (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  easeInCubic: (t) => t * t * t,
  easeOutCubic: (t) => 1 - (1 - t) ** 3,
  easeInOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  easeInBack: (t) => {
    const c = 1.70158;
    return (c + 1) * t * t * t - c * t * t;
  },
  easeOutBack: (t) => {
    const c = 1.70158;
    return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
  },
  easeOutBounce: (t) => {
    const n1 = 7.5625;
    const d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
};

function resolveEasing(easing: EasingName | EasingFn): EasingFn {
  return typeof easing === "function" ? easing : Easings[easing];
}

// ── Internal Helpers ────────────────────────────────────────────────

const SCALAR_KEY = "_";

function toChannelMap(target: AnimationTarget): Map<string, number> {
  if (typeof target === "number") {
    return new Map([[SCALAR_KEY, target]]);
  }
  return new Map(Object.entries(target));
}

function snapshotValue<T extends AnimationTarget>(target: T): AnimatedValue<T> {
  if (typeof target === "number") return target as unknown as AnimatedValue<T>;
  const result: Record<string, number> = {};
  for (const [key, val] of Object.entries(target)) {
    result[key] = val;
  }
  return result as AnimatedValue<T>;
}

function snapshotFromSpringState(
  state: Map<string, SpringState>,
  isObject: boolean,
): number | Record<string, number> {
  if (!isObject) return state.get(SCALAR_KEY)!.position;
  const result: Record<string, number> = {};
  for (const [key, s] of state) {
    result[key] = s.position;
  }
  return result;
}

function snapshotFromMap(
  map: Map<string, number>,
  isObject: boolean,
): number | Record<string, number> {
  if (!isObject) return map.get(SCALAR_KEY)!;
  const result: Record<string, number> = {};
  for (const [key, val] of map) {
    result[key] = val;
  }
  return result;
}

function forEachChannel(target: AnimationTarget, fn: (key: string, value: number) => void): void {
  if (typeof target === "number") {
    fn(SCALAR_KEY, target);
  } else {
    for (const [key, val] of Object.entries(target)) {
      fn(key, val);
    }
  }
}

function shallowEqual(a: AnimationTarget, b: AnimationTarget): boolean {
  if (typeof a === "number" && typeof b === "number") return a === b;
  if (typeof a !== typeof b) return false;
  const aObj = a as Record<string, number>;
  const bObj = b as Record<string, number>;
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) => aObj[k] === bObj[k]);
}

function initializeSpringState(target: AnimationTarget): Map<string, SpringState> {
  const map = new Map<string, SpringState>();
  forEachChannel(target, (key, value) => {
    map.set(key, { position: value, velocity: 0 });
  });
  return map;
}

function snapSpringToTarget(state: Map<string, SpringState>, target: AnimationTarget): void {
  forEachChannel(target, (key, value) => {
    state.set(key, { position: value, velocity: 0 });
  });
}

// ── useSpring ───────────────────────────────────────────────────────

/**
 * Spring physics-based animation hook.
 *
 * Returns animated value(s) that follow the target with natural spring dynamics
 * (damped harmonic oscillator). Supports single numbers and objects of numbers.
 *
 * Automatically starts/stops the tick loop when the spring is in motion or settled.
 *
 * @example
 * ```tsx
 * const { value: scale } = useSpring(pressed ? 0.85 : 1, SpringPresets.wobbly);
 * ```
 *
 * @example
 * ```tsx
 * const { value } = useSpring({ x: targetX, opacity: show ? 1 : 0 }, SpringPresets.gentle);
 * // value.x and value.opacity are plain numbers
 * ```
 */
export function useSpring<T extends AnimationTarget>(
  target: T,
  config?: Partial<SpringConfig> & { fps?: number },
): SpringResult<T> {
  const resolvedConfig = useMemo(
    () => ({ ...SPRING_DEFAULTS, ...config }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      config?.tension,
      config?.friction,
      config?.mass,
      config?.velocityThreshold,
      config?.displacementThreshold,
      config?.clamp,
    ],
  );

  const fps = config?.fps ?? 60;
  const isObject = typeof target === "object" && target !== null;

  // Mutable spring state (position + velocity per channel)
  const stateRef = useRef<Map<string, SpringState> | null>(null);
  if (stateRef.current === null) {
    stateRef.current = initializeSpringState(target);
  }

  // Track the latest target in a ref for the tick callback
  const targetRef = useRef(target);
  targetRef.current = target;

  const configRef = useRef(resolvedConfig);
  configRef.current = resolvedConfig;

  // Animated output — this is what triggers re-renders
  const [value, setValue] = useState<AnimatedValue<T>>(
    () => snapshotValue(target) as AnimatedValue<T>,
  );
  const [isAnimating, setIsAnimating] = useState(false);

  // Detect target changes → start animating
  const prevTarget = usePrevious(target);
  useEffect(() => {
    if (prevTarget !== undefined && !shallowEqual(prevTarget, target)) {
      // Sync state map with any new keys from the target
      const state = stateRef.current!;
      forEachChannel(target, (key, val) => {
        if (!state.has(key)) {
          state.set(key, { position: val, velocity: 0 });
        }
      });
      setIsAnimating(true);
    }
  }, [prevTarget, target]);

  // Frame tick — only runs when isAnimating
  useTick(
    (deltaMs) => {
      const dt = Math.min(deltaMs / 1000, MAX_DT_SEC);
      const state = stateRef.current!;
      const currentTarget = targetRef.current;
      const cfg = configRef.current;
      let allSettled = true;

      forEachChannel(currentTarget, (key, targetVal) => {
        const channelState = state.get(key);
        if (!channelState) return;

        const next = stepSpring(channelState, targetVal, cfg, dt);
        state.set(key, next);

        if (!isSettled(next, targetVal, cfg)) {
          allSettled = false;
        }
      });

      if (allSettled) {
        snapSpringToTarget(state, currentTarget);
        setValue(snapshotValue(currentTarget) as AnimatedValue<T>);
        setIsAnimating(false);
      } else {
        setValue(snapshotFromSpringState(state, isObject) as AnimatedValue<T>);
      }
    },
    isAnimating ? fps : false,
  );

  // Imperative API
  const set = useCallback((newTarget: T) => {
    targetRef.current = newTarget;
    // Sync any new keys
    const state = stateRef.current!;
    forEachChannel(newTarget, (key, val) => {
      if (!state.has(key)) {
        state.set(key, { position: val, velocity: 0 });
      }
    });
    setIsAnimating(true);
  }, []);

  const jump = useCallback((newTarget: T) => {
    targetRef.current = newTarget;
    snapSpringToTarget(stateRef.current!, newTarget);
    setValue(snapshotValue(newTarget) as AnimatedValue<T>);
    setIsAnimating(false);
  }, []);

  return useMemo(() => ({ value, isAnimating, set, jump }), [value, isAnimating, set, jump]);
}

// ── useTween ────────────────────────────────────────────────────────

interface TweenState {
  from: Map<string, number>;
  to: Map<string, number>;
  elapsed: number;
  duration: number;
}

function interpolateTween(tween: TweenState, easingFn: EasingFn): Map<string, number> {
  const t = tween.duration > 0 ? Math.min(tween.elapsed / tween.duration, 1) : 1;
  const easedT = easingFn(t);
  const result = new Map<string, number>();
  for (const [key, fromVal] of tween.from) {
    const toVal = tween.to.get(key) ?? fromVal;
    result.set(key, fromVal + (toVal - fromVal) * easedT);
  }
  return result;
}

/**
 * Duration + easing-based animation hook.
 *
 * Returns animated value(s) that smoothly transition to the target over the
 * specified duration using an easing curve. Supports single numbers and objects
 * of numbers.
 *
 * When the target changes mid-tween, a new tween starts from the current
 * interpolated position (no discontinuity).
 *
 * @example
 * ```tsx
 * const { value: opacity } = useTween(visible ? 1 : 0, { duration: 500, easing: "easeInOut" });
 * ```
 *
 * @example
 * ```tsx
 * const { value } = useTween({ y: expanded ? 0 : -50, opacity: expanded ? 1 : 0 });
 * // value.y and value.opacity are plain numbers
 * ```
 */
export function useTween<T extends AnimationTarget>(
  target: T,
  config?: Partial<TweenConfig>,
): TweenResult<T> {
  const duration = config?.duration ?? TWEEN_DEFAULTS.duration;
  const easingFn = resolveEasing(config?.easing ?? TWEEN_DEFAULTS.easing);
  const fps = config?.fps ?? TWEEN_DEFAULTS.fps;
  const isObject = typeof target === "object" && target !== null;

  // Mutable tween state
  const tweenRef = useRef<TweenState | null>(null);
  if (tweenRef.current === null) {
    const initial = toChannelMap(target);
    tweenRef.current = {
      from: new Map(initial),
      to: new Map(initial),
      elapsed: duration,
      duration,
    };
  }

  const targetRef = useRef(target);
  const easingRef = useRef(easingFn);
  easingRef.current = easingFn;

  const [value, setValue] = useState<AnimatedValue<T>>(
    () => snapshotValue(target) as AnimatedValue<T>,
  );
  const [progress, setProgress] = useState(1);
  const [isAnimating, setIsAnimating] = useState(false);

  // Detect target changes → start a new tween from the current position
  const prevTarget = usePrevious(target);
  useEffect(() => {
    if (prevTarget !== undefined && !shallowEqual(prevTarget, target)) {
      const tween = tweenRef.current!;
      // Current interpolated position becomes the new start
      tween.from = interpolateTween(tween, easingRef.current);
      tween.to = toChannelMap(target);
      tween.elapsed = 0;
      tween.duration = duration;
      targetRef.current = target;
      setIsAnimating(true);
    }
  }, [prevTarget, target, duration]);

  // Frame tick
  useTick(
    (deltaMs) => {
      const tween = tweenRef.current!;
      tween.elapsed = Math.min(tween.elapsed + deltaMs, tween.duration);
      const t = tween.duration > 0 ? tween.elapsed / tween.duration : 1;
      const result = interpolateTween(tween, easingRef.current);

      setProgress(t);
      setValue(snapshotFromMap(result, isObject) as AnimatedValue<T>);

      if (t >= 1) {
        setIsAnimating(false);
      }
    },
    isAnimating ? fps : false,
  );

  // Imperative API
  const set = useCallback(
    (newTarget: T) => {
      const tween = tweenRef.current!;
      tween.from = interpolateTween(tween, easingRef.current);
      tween.to = toChannelMap(newTarget);
      tween.elapsed = 0;
      tween.duration = duration;
      targetRef.current = newTarget;
      setIsAnimating(true);
    },
    [duration],
  );

  const jump = useCallback((newTarget: T) => {
    const tween = tweenRef.current!;
    const map = toChannelMap(newTarget);
    tween.from = new Map(map);
    tween.to = new Map(map);
    tween.elapsed = tween.duration;
    targetRef.current = newTarget;
    setValue(snapshotValue(newTarget) as AnimatedValue<T>);
    setProgress(1);
    setIsAnimating(false);
  }, []);

  return useMemo(
    () => ({ value, progress, isAnimating, set, jump }),
    [value, progress, isAnimating, set, jump],
  );
}
