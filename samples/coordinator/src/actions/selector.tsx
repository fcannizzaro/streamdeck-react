import { useState, useEffect } from "react";
import {
  defineAction,
  useKeyDown,
  useAction,
  useSettings,
  useCoordinator,
  useChannel,
} from "@fcannizzaro/streamdeck-react";
import { SHAPE_CONFIGS, DEFAULT_SETTINGS, DEFAULT_ROTATE } from "../params";
import type { ShapeName, EditorSettings } from "../params";
import { ShapePreview } from "../shapes";

// ── Toggle Key ──────────────────────────────────────────────────────
//
// Each key instance is an independent 3D editor with its own shape,
// dimensions, and rotation — all persisted in the key's settings.
//
// Persistence flow:
//   1. On mount: read useSettings → seed coordinator channels
//   2. Dials modify channels in real-time
//   3. Key observes channel changes → writes back to useSettings
//
// This ensures values survive plugin restarts (settings are durable)
// while channels provide real-time cross-action communication.

function ToggleKey() {
  const action = useAction();
  const id = action.id;
  const coordinator = useCoordinator();

  const [settings, setSettings] = useSettings<EditorSettings>();
  const [ready, setReady] = useState(false);

  const [activeId, setActiveId] = useChannel<string | null>("activeId", null);
  const isActive = activeId === id;

  // ── Per-instance channels (real-time state from dials) ──────────
  const [shape] = useChannel<ShapeName>(`${id}:shape`, settings.shape ?? DEFAULT_SETTINGS.shape);
  const [width] = useChannel<number>(`${id}:width`, settings.width ?? DEFAULT_SETTINGS.width);
  const [height] = useChannel<number>(`${id}:height`, settings.height ?? DEFAULT_SETTINGS.height);
  const [depth] = useChannel<number>(`${id}:depth`, settings.depth ?? DEFAULT_SETTINGS.depth);
  const [rotateX] = useChannel<number>(`${id}:rotateX`, settings.rotateX ?? DEFAULT_ROTATE);
  const [rotateY] = useChannel<number>(`${id}:rotateY`, settings.rotateY ?? DEFAULT_ROTATE);
  const [rotateZ] = useChannel<number>(`${id}:rotateZ`, settings.rotateZ ?? DEFAULT_ROTATE);

  const config = SHAPE_CONFIGS[shape];

  // ── Seed channels from persisted settings on mount ──────────────
  //
  // Without this, dials would see default values instead of the
  // persisted ones because useChannel's defaultValue is local to
  // each subscriber.  Seeding ensures all subscribers agree.
  useEffect(() => {
    const s = settings;
    coordinator.setChannelValue(`${id}:shape`, s.shape ?? DEFAULT_SETTINGS.shape);
    coordinator.setChannelValue(`${id}:width`, s.width ?? DEFAULT_SETTINGS.width);
    coordinator.setChannelValue(`${id}:height`, s.height ?? DEFAULT_SETTINGS.height);
    coordinator.setChannelValue(`${id}:depth`, s.depth ?? DEFAULT_SETTINGS.depth);
    coordinator.setChannelValue(`${id}:rotateX`, s.rotateX ?? DEFAULT_ROTATE);
    coordinator.setChannelValue(`${id}:rotateY`, s.rotateY ?? DEFAULT_ROTATE);
    coordinator.setChannelValue(`${id}:rotateZ`, s.rotateZ ?? DEFAULT_ROTATE);
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps — intentionally only on mount
  }, []);

  // ── Persist channel values back to settings ─────────────────────
  //
  // Guarded by `ready` to avoid writing stale defaults before the
  // seeding effect has run.
  useEffect(() => {
    if (!ready) return;
    setSettings({ shape, width, height, depth, rotateX, rotateY, rotateZ });
  }, [ready, shape, width, height, depth, rotateX, rotateY, rotateZ, setSettings]);

  useKeyDown(() => {
    setActiveId(isActive ? null : id);
  });

  // ── Inactive state ──────────────────────────────────────────────
  if (!isActive) {
    return (
      <div className="flex items-center justify-center w-full h-full bg-[#0d0d0d]">
        <ShapePreview
          shape={shape}
          width={width}
          height={height}
          depth={depth}
          rotateX={rotateX}
          rotateY={rotateY}
          rotateZ={rotateZ}
          color={config.color}
          size={110}
          dimmed
        />
      </div>
    );
  }

  // ── Active state ──────────────────────────────────────────────
  return (
    <div className="flex items-center justify-center w-full h-full bg-[#111119]">
      <ShapePreview
        shape={shape}
        width={width}
        height={height}
        depth={depth}
        rotateX={rotateX}
        rotateY={rotateY}
        rotateZ={rotateZ}
        color={config.color}
        size={130}
      />
    </div>
  );
}

// ── Action Definition ───────────────────────────────────────────────

export const toggleAction = defineAction({
  uuid: "com.example.react-coordinator.toggle",
  key: ToggleKey,
  defaultSettings: DEFAULT_SETTINGS,
  info: {
    name: "3D Editor",
    icon: "imgs/actions/selector",
    tooltip: "Toggle the 3D Shape Editor on or off. When enabled, dials become active.",
  },
});
