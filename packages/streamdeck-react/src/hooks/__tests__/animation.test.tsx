/// <reference lib="dom" />

import { describe, expect, test } from "bun:test";
import { act, useState } from "react";
import {
  stepSpring,
  isSettled,
  Easings,
  SpringPresets,
  useSpring,
  useTween,
} from "@/hooks/animation";
import type { SpringConfig, EasingName } from "@/hooks/animation";
import { createDomRoot, sleep } from "@/test-utils/react";

// ── Test Helpers ────────────────────────────────────────────────────

type HookHarnessApi<TResult> = {
  current: TResult;
  rerender: () => Promise<void>;
  unmount: () => Promise<void>;
};

type StatefulHookHarnessApi<TProps, TResult> = {
  current: TResult;
  rerender: (nextProps?: Partial<TProps>) => Promise<void>;
  unmount: () => Promise<void>;
};

async function renderHook<TResult>(useHook: () => TResult): Promise<HookHarnessApi<TResult>> {
  let current!: TResult;

  function HookHarness() {
    current = useHook();
    return null;
  }

  const root = createDomRoot();
  await root.render(<HookHarness />);

  return {
    get current() {
      return current;
    },
    async rerender() {
      await root.render(<HookHarness />);
    },
    async unmount() {
      await root.unmount();
    },
  };
}

async function renderStatefulHook<TProps extends object, TResult>(
  useHook: (props: TProps) => TResult,
  initialProps: TProps,
): Promise<StatefulHookHarnessApi<TProps, TResult>> {
  let current!: TResult;
  let props = initialProps;

  function HookHarness(nextProps: TProps) {
    current = useHook(nextProps);
    return null;
  }

  const root = createDomRoot();
  await root.render(<HookHarness {...props} />);

  return {
    get current() {
      return current;
    },
    async rerender(nextProps = {}) {
      props = { ...props, ...nextProps };
      await root.render(<HookHarness {...props} />);
    },
    async unmount() {
      await root.unmount();
    },
  };
}

// ── stepSpring (pure function) ──────────────────────────────────────

describe("stepSpring", () => {
  const defaultConfig: SpringConfig = {
    tension: 170,
    friction: 26,
    mass: 1,
    velocityThreshold: 0.01,
    displacementThreshold: 0.005,
    clamp: false,
  };

  test("spring converges to target from below", () => {
    let state = { position: 0, velocity: 0 };
    const target = 100;
    const dt = 1 / 60;

    for (let i = 0; i < 600; i++) {
      state = stepSpring(state, target, defaultConfig, dt);
    }

    expect(Math.abs(state.position - target)).toBeLessThan(0.01);
    expect(Math.abs(state.velocity)).toBeLessThan(0.01);
  });

  test("spring converges to target from above", () => {
    let state = { position: 200, velocity: 0 };
    const target = 100;
    const dt = 1 / 60;

    for (let i = 0; i < 600; i++) {
      state = stepSpring(state, target, defaultConfig, dt);
    }

    expect(Math.abs(state.position - target)).toBeLessThan(0.01);
    expect(Math.abs(state.velocity)).toBeLessThan(0.01);
  });

  test("low friction causes overshoot", () => {
    const lowFrictionConfig: SpringConfig = {
      ...defaultConfig,
      friction: 5,
    };
    let state = { position: 0, velocity: 0 };
    const target = 100;
    const dt = 1 / 60;
    let maxPosition = 0;

    for (let i = 0; i < 300; i++) {
      state = stepSpring(state, target, lowFrictionConfig, dt);
      maxPosition = Math.max(maxPosition, state.position);
    }

    expect(maxPosition).toBeGreaterThan(target);
  });

  test("clamp mode prevents overshoot", () => {
    const clampConfig: SpringConfig = {
      ...defaultConfig,
      friction: 5,
      clamp: true,
    };
    let state = { position: 0, velocity: 0 };
    const target = 100;
    const dt = 1 / 60;

    for (let i = 0; i < 300; i++) {
      state = stepSpring(state, target, clampConfig, dt);
      expect(state.position).toBeLessThanOrEqual(target + 0.001);
    }
  });

  test("heavy mass slows convergence", () => {
    const heavyConfig: SpringConfig = { ...defaultConfig, mass: 10 };
    let stateHeavy = { position: 0, velocity: 0 };
    let stateLight = { position: 0, velocity: 0 };
    const target = 100;
    const dt = 1 / 60;
    const steps = 60; // 1 second

    for (let i = 0; i < steps; i++) {
      stateHeavy = stepSpring(stateHeavy, target, heavyConfig, dt);
      stateLight = stepSpring(stateLight, target, defaultConfig, dt);
    }

    // Light mass should be closer to target after 1 second
    const heavyDist = Math.abs(stateHeavy.position - target);
    const lightDist = Math.abs(stateLight.position - target);
    expect(heavyDist).toBeGreaterThan(lightDist);
  });
});

// ── isSettled ────────────────────────────────────────────────────────

describe("isSettled", () => {
  const config: SpringConfig = {
    tension: 170,
    friction: 26,
    mass: 1,
    velocityThreshold: 0.01,
    displacementThreshold: 0.005,
    clamp: false,
  };

  test("returns true when at rest at target", () => {
    expect(isSettled({ position: 100, velocity: 0 }, 100, config)).toBe(true);
  });

  test("returns false when velocity is above threshold", () => {
    expect(isSettled({ position: 100, velocity: 0.1 }, 100, config)).toBe(false);
  });

  test("returns false when displacement is above threshold", () => {
    expect(isSettled({ position: 99, velocity: 0 }, 100, config)).toBe(false);
  });

  test("returns true when both are below threshold", () => {
    expect(isSettled({ position: 100.004, velocity: 0.009 }, 100, config)).toBe(true);
  });
});

// ── Easing functions ────────────────────────────────────────────────

describe("Easings", () => {
  const names = Object.keys(Easings) as EasingName[];

  for (const name of names) {
    test(`${name}: f(0) === 0 and f(1) === 1`, () => {
      const fn = Easings[name];
      expect(fn(0)).toBeCloseTo(0, 10);
      expect(fn(1)).toBeCloseTo(1, 10);
    });
  }

  test("easeIn is slower at start than linear", () => {
    expect(Easings.easeIn(0.25)).toBeLessThan(Easings.linear(0.25));
  });

  test("easeOut is faster at start than linear", () => {
    expect(Easings.easeOut(0.25)).toBeGreaterThan(Easings.linear(0.25));
  });
});

// ── useSpring hook ──────────────────────────────────────────────────

describe("useSpring", () => {
  test("initial value equals target (scalar)", async () => {
    const hook = await renderHook(() => useSpring(42));

    expect(hook.current.value).toBe(42);
    expect(hook.current.isAnimating).toBe(false);

    await hook.unmount();
  });

  test("initial value equals target (object)", async () => {
    const hook = await renderHook(() => useSpring({ x: 10, y: 20 }));

    expect(hook.current.value).toEqual({ x: 10, y: 20 });
    expect(hook.current.isAnimating).toBe(false);

    await hook.unmount();
  });

  test("changing target starts animation and eventually settles", async () => {
    const hook = await renderStatefulHook(
      ({ target }: { target: number }) => useSpring(target, { tension: 400, friction: 28 }),
      { target: 0 },
    );

    expect(hook.current.value).toBe(0);
    expect(hook.current.isAnimating).toBe(false);

    // Change target
    await hook.rerender({ target: 100 });

    // Should start animating
    await act(async () => {
      await sleep(50);
    });
    expect(hook.current.isAnimating).toBe(true);
    expect(hook.current.value).not.toBe(0);
    expect(hook.current.value).not.toBe(100);

    // Wait for settling (stiff spring should settle quickly)
    await act(async () => {
      await sleep(1500);
    });

    expect(hook.current.isAnimating).toBe(false);
    expect(hook.current.value).toBe(100);

    await hook.unmount();
  });

  test("jump() immediately sets value with no animation", async () => {
    const hook = await renderStatefulHook(
      ({ target }: { target: number }) => useSpring(target, SpringPresets.wobbly),
      { target: 0 },
    );

    await act(async () => {
      hook.current.jump(100);
    });

    expect(hook.current.value).toBe(100);
    expect(hook.current.isAnimating).toBe(false);

    await hook.unmount();
  });

  test("object target animates and settles", async () => {
    const hook = await renderStatefulHook(
      ({ target }: { target: Record<string, number> }) =>
        useSpring(target, { tension: 400, friction: 28 }),
      { target: { x: 0, y: 0 } },
    );

    await hook.rerender({ target: { x: 100, y: 50 } });

    await act(async () => {
      await sleep(1500);
    });

    expect(hook.current.isAnimating).toBe(false);
    expect(hook.current.value).toEqual({ x: 100, y: 50 });

    await hook.unmount();
  });
});

// ── useTween hook ───────────────────────────────────────────────────

describe("useTween", () => {
  test("initial value equals target, progress is 1", async () => {
    const hook = await renderHook(() => useTween(50));

    expect(hook.current.value).toBe(50);
    expect(hook.current.progress).toBe(1);
    expect(hook.current.isAnimating).toBe(false);

    await hook.unmount();
  });

  test("changing target starts tween and completes after duration", async () => {
    const hook = await renderStatefulHook(
      ({ target }: { target: number }) => useTween(target, { duration: 200, easing: "linear" }),
      { target: 0 },
    );

    expect(hook.current.value).toBe(0);

    await hook.rerender({ target: 100 });

    // Mid-tween
    await act(async () => {
      await sleep(100);
    });
    expect(hook.current.isAnimating).toBe(true);
    expect(hook.current.value).toBeGreaterThan(0);
    expect(hook.current.value).toBeLessThan(100);

    // After duration
    await act(async () => {
      await sleep(200);
    });

    expect(hook.current.isAnimating).toBe(false);
    expect(hook.current.progress).toBe(1);
    // Value should be at or very near 100
    expect(Math.abs(hook.current.value - 100)).toBeLessThan(1);

    await hook.unmount();
  });

  test("jump() immediately sets value", async () => {
    const hook = await renderStatefulHook(
      ({ target }: { target: number }) => useTween(target, { duration: 500 }),
      { target: 0 },
    );

    await act(async () => {
      hook.current.jump(100);
    });

    expect(hook.current.value).toBe(100);
    expect(hook.current.progress).toBe(1);
    expect(hook.current.isAnimating).toBe(false);

    await hook.unmount();
  });

  test("mid-tween target change restarts from current position", async () => {
    const hook = await renderStatefulHook(
      ({ target }: { target: number }) => useTween(target, { duration: 300, easing: "linear" }),
      { target: 0 },
    );

    // Start tween to 100
    await hook.rerender({ target: 100 });

    await act(async () => {
      await sleep(150);
    });

    // Should be roughly halfway
    const midValue = hook.current.value;
    expect(midValue).toBeGreaterThan(20);
    expect(midValue).toBeLessThan(80);

    // Change direction — tween should restart from midValue toward 0
    await hook.rerender({ target: 0 });

    await act(async () => {
      await sleep(50);
    });

    // Should be moving back toward 0 from the midpoint
    expect(hook.current.value).toBeLessThan(midValue);

    await act(async () => {
      await sleep(500);
    });

    expect(hook.current.isAnimating).toBe(false);

    await hook.unmount();
  });

  test("object target tweens correctly", async () => {
    const hook = await renderStatefulHook(
      ({ target }: { target: Record<string, number> }) =>
        useTween(target, { duration: 200, easing: "linear" }),
      { target: { x: 0, y: 0 } },
    );

    await hook.rerender({ target: { x: 100, y: 50 } });

    await act(async () => {
      await sleep(300);
    });

    expect(hook.current.isAnimating).toBe(false);
    expect(Math.abs((hook.current.value as { x: number; y: number }).x - 100)).toBeLessThan(1);
    expect(Math.abs((hook.current.value as { x: number; y: number }).y - 50)).toBeLessThan(1);

    await hook.unmount();
  });

  test("custom easing function is applied", async () => {
    // Use an easing that stays at 0 until t >= 0.9, then jumps to 1
    const customEasing = (t: number) => (t >= 0.9 ? 1 : 0);

    const hook = await renderStatefulHook(
      ({ target }: { target: number }) => useTween(target, { duration: 200, easing: customEasing }),
      { target: 0 },
    );

    await hook.rerender({ target: 100 });

    // At ~50% through, value should still be near 0 because of the custom easing
    await act(async () => {
      await sleep(100);
    });
    expect(hook.current.value).toBeLessThan(10);

    // After completion, should be at target
    await act(async () => {
      await sleep(200);
    });
    expect(hook.current.isAnimating).toBe(false);

    await hook.unmount();
  });
});
