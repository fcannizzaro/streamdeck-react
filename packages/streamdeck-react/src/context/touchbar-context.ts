import { createContext } from "react";
import type { TouchBarInfo } from "@/types";

// ── Touch Bar Context ───────────────────────────────────────────────

export const TouchBarContext = createContext<TouchBarInfo>(null!);
