import { createContext } from "react";
import type { TouchStripInfo } from "@/types";

// ── Touch Bar Context ───────────────────────────────────────────────

export const TouchStripContext = /*#__PURE__*/ createContext<TouchStripInfo>(null!);
