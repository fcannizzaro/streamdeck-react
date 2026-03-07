/// <reference lib="dom" />

import { describe, expect, test } from "bun:test";
import { act, useEffect, useState } from "react";
import {
  useAnimationFrame,
  useInterval,
  usePrevious,
  useTick,
  useTimeout,
} from "@/hooks/utility.ts";
import { createDomRoot, sleep } from "@/test-utils/react.tsx";

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

async function renderHook<TResult>(
  useHook: () => TResult,
): Promise<HookHarnessApi<TResult>> {
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

describe("utility hooks", () => {
  test("useInterval fires until paused with null", async () => {
    let calls = 0;

    const hook = await renderStatefulHook<{ delayMs: number | null }, void>(
      ({ delayMs }) =>
        useInterval(() => {
          calls += 1;
        }, delayMs),
      { delayMs: 10 },
    );

    await act(async () => {
      await sleep(35);
    });

    expect(calls).toBeGreaterThanOrEqual(2);

    await hook.rerender({ delayMs: null });
    const pausedCalls = calls;

    await act(async () => {
      await sleep(30);
    });

    expect(calls).toBe(pausedCalls);
    await hook.unmount();
  });

  test("useInterval reset restarts the cadence", async () => {
    const calls: number[] = [];
    const startedAt = Date.now();
    const hook = await renderHook(() =>
      useInterval(() => {
        calls.push(Date.now() - startedAt);
      }, 25),
    );

    await act(async () => {
      await sleep(10);
    });

    hook.current.reset();

    await act(async () => {
      await sleep(20);
    });

    expect(calls.length).toBe(0);

    await act(async () => {
      await sleep(15);
    });

    expect(calls.length).toBe(1);
    expect(calls[0]).toBeGreaterThanOrEqual(25);
    await hook.unmount();
  });

  test("useTimeout cancel and reset control execution", async () => {
    let calls = 0;

    const hook = await renderHook(() =>
      useTimeout(() => {
        calls += 1;
      }, 20),
    );

    await act(async () => {
      await sleep(10);
    });

    hook.current.cancel();

    await act(async () => {
      await sleep(20);
    });

    expect(calls).toBe(0);

    hook.current.reset();

    await act(async () => {
      await sleep(10);
    });

    expect(calls).toBe(0);

    await act(async () => {
      await sleep(15);
    });

    expect(calls).toBe(1);
    await hook.unmount();
  });

  test("usePrevious returns the prior render value", async () => {
    const seen: Array<number | undefined> = [];

    const hook = await renderStatefulHook(
      ({ value }: { value: number }) => {
        const previous = usePrevious(value);
        seen.push(previous);
        return previous;
      },
      { value: 1 },
    );

    await hook.rerender({ value: 2 });
    await hook.rerender({ value: 3 });

    expect(seen).toEqual([undefined, 1, 2]);
    await hook.unmount();
  });

  test("useTick uses fps-based timing and can pause", async () => {
    const deltas: number[] = [];

    const hook = await renderStatefulHook<
      { fpsOrActive: number | boolean },
      void
    >(
      ({ fpsOrActive }) =>
        useTick((deltaMs) => {
          deltas.push(deltaMs);
        }, fpsOrActive),
      { fpsOrActive: 20 },
    );

    await act(async () => {
      await sleep(120);
    });

    expect(deltas.length).toBeGreaterThanOrEqual(2);
    expect(deltas.every((delta) => delta >= 35)).toBe(true);

    await hook.rerender({ fpsOrActive: false });
    const pausedCount = deltas.length;

    await act(async () => {
      await sleep(70);
    });

    expect(deltas.length).toBe(pausedCount);
    await hook.unmount();
  });

  test("useAnimationFrame remains compatible through useTick", async () => {
    const deltas: number[] = [];

    const hook = await renderStatefulHook(
      ({ active }: { active: boolean }) =>
        useAnimationFrame((deltaMs) => {
          deltas.push(deltaMs);
        }, active),
      { active: true },
    );

    await act(async () => {
      await sleep(40);
    });

    expect(deltas.length).toBeGreaterThanOrEqual(2);

    await hook.rerender({ active: false });
    const pausedCount = deltas.length;

    await act(async () => {
      await sleep(30);
    });

    expect(deltas.length).toBe(pausedCount);
    await hook.unmount();
  });

  test("timer hooks keep the latest callback without restarting consumers", async () => {
    const values: number[] = [];

    function TestHarness() {
      const [value, setValue] = useState(1);

      useInterval(() => {
        values.push(value);
      }, 15);

      useEffect(() => {
        setValue(2);
      }, []);

      return null;
    }

    const root = createDomRoot();
    await root.render(<TestHarness />);

    await act(async () => {
      await sleep(40);
    });

    expect(values.length).toBeGreaterThanOrEqual(2);
    expect(values.every((value) => value === 2)).toBe(true);

    await root.unmount();
  });
});
