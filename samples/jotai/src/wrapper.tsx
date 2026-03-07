import type { ReactNode } from "react";
import { Provider } from "jotai";
import { store } from "./store.ts";

type JotaiWrapperProps = {
  children?: ReactNode;
};

export function JotaiWrapper({ children }: JotaiWrapperProps) {
  return <Provider store={store}>{children}</Provider>;
}
