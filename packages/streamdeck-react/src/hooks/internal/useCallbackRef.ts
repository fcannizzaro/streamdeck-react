import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";

export function useCallbackRef<T>(callback: T): MutableRefObject<T> {
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  });

  return callbackRef;
}
