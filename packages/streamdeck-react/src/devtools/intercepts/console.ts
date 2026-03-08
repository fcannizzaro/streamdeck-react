// ── Console Interceptor ─────────────────────────────────────────────
// Monkey-patches console.log/warn/error/info/debug to capture output
// for the devtools server. Always calls the original method first.

export type ConsoleCallback = (
  level: string,
  args: unknown[],
  stack: string | undefined,
) => void;

/**
 * Patches console methods to forward output to the devtools bridge.
 * Returns a restore function that undoes the patch.
 */
export function patchConsole(cb: ConsoleCallback): () => void {
  const originals = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info,
    debug: console.debug,
  };

  let forwarding = false;

  for (const level of ["log", "warn", "error", "info", "debug"] as const) {
    const original = originals[level];
    console[level] = (...args: unknown[]) => {
      // Always call the original first
      original.apply(console, args);

      // Prevent recursion (e.g. if the devtools server itself logs)
      if (forwarding) return;
      forwarding = true;

      try {
        const stack =
          level === "error" || (args.length > 0 && args[0] instanceof Error)
            ? new Error().stack
            : undefined;
        cb(level, args, stack);
      } finally {
        forwarding = false;
      }
    };
  }

  return () => {
    console.log = originals.log;
    console.warn = originals.warn;
    console.error = originals.error;
    console.info = originals.info;
    console.debug = originals.debug;
  };
}

/**
 * Stored originals for use by the devtools server when it needs to log
 * without triggering the interceptor.
 */
export const origConsole = {
  log: console.log,
  warn: console.warn,
  error: console.error,
  info: console.info,
  debug: console.debug,
};
