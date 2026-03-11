import { createContext } from "react";
import type { TouchStripInfo } from "@/types";

// ── Touch Bar Context ───────────────────────────────────────────────

export const TouchStripContext = createContext<TouchStripInfo>(null!);
