/// <reference lib="dom" />

import type { ReactElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";

export { sleep } from "./sleep";

export type DomRootApi = {
  render: (element: ReactElement) => Promise<void>;
  unmount: () => Promise<void>;
};

export function createDomRoot(): DomRootApi {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  return {
    async render(element) {
      await act(async () => {
        root.render(element);
      });
    },
    async unmount() {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}
