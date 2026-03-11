import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { LayoutItem } from "react-grid-layout";

// ── Panel Types ─────────────────────────────────────────────────────

export type TabId = "console" | "network" | "elements" | "preview" | "events" | "performance";

const VALID_TAB_IDS = new Set<TabId>(["console", "network", "elements", "preview", "events", "performance"]);

const DEFAULT_LAYOUT: LayoutItem[] = [{ i: "preview", x: 0, y: 0, w: 12, h: 12 }];

// ── Store Interface ─────────────────────────────────────────────────

export interface LayoutState {
  layout: LayoutItem[];

  /** Add a panel to the grid. */
  addPanel: (id: TabId) => void;

  /** Remove a panel from the grid by TabId. */
  removePanel: (id: TabId) => void;

  /** Toggle a panel on/off. */
  togglePanel: (id: TabId) => void;

  /** Called by RGL's onLayoutChange — syncs positions/sizes. */
  updateLayout: (layout: LayoutItem[]) => void;
}

const GRID_COLS = 12;
const GRID_ROWS = 12;

// ── Helpers ─────────────────────────────────────────────────────────

function getActivePanelIds(layout: LayoutItem[]): Set<TabId> {
  return new Set(layout.map((item) => item.i as TabId));
}

function hasPanel(layout: LayoutItem[], id: TabId): boolean {
  return layout.some((item) => item.i === id);
}

function validateLayout(layout: LayoutItem[]): LayoutItem[] {
  return layout.filter((item) => VALID_TAB_IDS.has(item.i as TabId));
}

/**
 * Build an occupancy grid from existing layout items.
 * Returns a 2D boolean array [row][col] where true = occupied.
 */
function buildOccupancyGrid(layout: LayoutItem[]): boolean[][] {
  const grid: boolean[][] = Array.from({ length: GRID_ROWS }, () => Array(GRID_COLS).fill(false));
  for (const item of layout) {
    for (let r = item.y; r < Math.min(item.y + item.h, GRID_ROWS); r++) {
      for (let c = item.x; c < Math.min(item.x + item.w, GRID_COLS); c++) {
        grid[r][c] = true;
      }
    }
  }
  return grid;
}

/**
 * Find the largest free rectangle in the occupancy grid.
 * Returns { x, y, w, h } or null if no free space.
 * Uses a simple scan: for each cell, expand right then down.
 */
function findFreeSpace(
  grid: boolean[][],
  minW = 3,
  minH = 3,
): { x: number; y: number; w: number; h: number } | null {
  let best: { x: number; y: number; w: number; h: number; area: number } | null = null;

  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLS; c++) {
      if (grid[r][c]) continue;

      // Find max width from this cell
      let maxW = 0;
      while (c + maxW < GRID_COLS && !grid[r][c + maxW]) maxW++;

      // For each possible width, find max height
      for (let w = maxW; w >= minW; w--) {
        let h = 0;
        outer: while (r + h < GRID_ROWS) {
          for (let cc = c; cc < c + w; cc++) {
            if (grid[r + h][cc]) break outer;
          }
          h++;
        }
        if (h >= minH) {
          const area = w * h;
          if (!best || area > best.area) {
            best = { x: c, y: r, w, h, area };
          }
        }
      }
    }
  }

  return best ? { x: best.x, y: best.y, w: best.w, h: best.h } : null;
}

/**
 * Try to place a new panel in existing free space.
 * Returns the new LayoutItem or null if no space found.
 */
function placeInFreeSpace(layout: LayoutItem[], id: TabId): LayoutItem | null {
  const grid = buildOccupancyGrid(layout);
  const slot = findFreeSpace(grid);
  if (!slot) return null;
  return { i: id, x: slot.x, y: slot.y, w: slot.w, h: slot.h };
}

/**
 * Compute a layout that fits all panels within the 12x12 grid.
 * Arranges panels in columns, splitting width evenly and using full height.
 */
function redistributeLayout(panels: TabId[]): LayoutItem[] {
  const count = panels.length;
  if (count === 0) return [];
  if (count === 1) return [{ i: panels[0], x: 0, y: 0, w: GRID_COLS, h: GRID_ROWS }];

  // For 2-4 panels: side by side, full height
  if (count <= 4) {
    const colWidth = Math.floor(GRID_COLS / count);
    return panels.map((id, idx) => ({
      i: id,
      x: idx * colWidth,
      y: 0,
      w: idx === count - 1 ? GRID_COLS - idx * colWidth : colWidth,
      h: GRID_ROWS,
    }));
  }

  // For 5 panels: 3 on top row, 2 on bottom row
  const topW = Math.floor(GRID_COLS / 3);
  const botW = Math.floor(GRID_COLS / 2);
  const halfH = Math.floor(GRID_ROWS / 2);
  return panels.map((id, idx) => {
    if (idx < 3) {
      return {
        i: id,
        x: idx * topW,
        y: 0,
        w: idx === 2 ? GRID_COLS - 2 * topW : topW,
        h: halfH,
      };
    }
    const bIdx = idx - 3;
    return {
      i: id,
      x: bIdx * botW,
      y: halfH,
      w: bIdx === 1 ? GRID_COLS - botW : botW,
      h: GRID_ROWS - halfH,
    };
  });
}

// ── Store ───────────────────────────────────────────────────────────

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set, get) => ({
      layout: DEFAULT_LAYOUT,

      addPanel: (id) => {
        const { layout } = get();
        if (hasPanel(layout, id)) return;
        // Try to fit in existing free space
        const placed = placeInFreeSpace(layout, id);
        if (placed) {
          set({ layout: [...layout, placed] });
        } else {
          // No free space — redistribute all panels
          const allIds = [...layout.map((item) => item.i as TabId), id];
          set({ layout: redistributeLayout(allIds) });
        }
      },

      removePanel: (id) => {
        const { layout } = get();
        if (layout.length <= 1) return;
        set({ layout: layout.filter((item) => item.i !== id) });
      },

      togglePanel: (id) => {
        const { layout } = get();
        if (hasPanel(layout, id)) {
          if (layout.length <= 1) return;
          set({ layout: layout.filter((item) => item.i !== id) });
        } else {
          const placed = placeInFreeSpace(layout, id);
          if (placed) {
            set({ layout: [...layout, placed] });
          } else {
            const allIds = [...layout.map((item) => item.i as TabId), id];
            set({ layout: redistributeLayout(allIds) });
          }
        }
      },

      updateLayout: (newLayout) => {
        set({ layout: newLayout });
      },
    }),
    {
      name: "sdreact:layout",
      partialize: (state) => ({ layout: state.layout }),
      onRehydrateStorage: () => (state) => {
        if (state?.layout) {
          const validated = validateLayout(state.layout);
          state.layout = validated.length > 0 ? validated : DEFAULT_LAYOUT;
        }
      },
    },
  ),
);

// ── Exported helper ─────────────────────────────────────────────────

export { getActivePanelIds };
