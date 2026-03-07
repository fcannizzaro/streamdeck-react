import { defineAction, useKeyDown, useSettings, tw } from "@fcannizzaro/streamdeck-react";

// ── Toggle Key ──────────────────────────────────────────────────────
// Cycles through OFF → AUTO → ON states.

type ToggleSettings = {
  mode: "off" | "auto" | "on";
};

const modes = ["off", "auto", "on"] as const;
const modeColors = { off: "#b71c1c", auto: "#f57f17", on: "#1b5e20" };
const modeLabels = { off: "OFF", auto: "AUTO", on: "ON" };

function ToggleKey() {
  const [settings, setSettings] = useSettings<ToggleSettings>();
  const mode = settings.mode ?? "off";

  useKeyDown(() => {
    const currentIndex = modes.indexOf(mode);
    const nextMode = modes[(currentIndex + 1) % modes.length]!;
    setSettings({ mode: nextMode });
  });

  return (
    <div
      className={tw(
        "flex flex-col items-center justify-center w-full h-full gap-1.5",
        `bg-[${modeColors[mode]}]`,
      )}
    >
      <div className="flex flex-row gap-1.5">
        {modes.map((m) => (
          <div
            key={m}
            className={tw(
              "w-2 h-2 rounded-full",
              m === mode ? "bg-white" : "bg-white/30",
            )}
          />
        ))}
      </div>
      <span className="text-white text-[20px] font-bold">
        {modeLabels[mode]}
      </span>
    </div>
  );
}

export const toggleAction = defineAction<ToggleSettings>({
  uuid: "com.example.react-counter.toggle",
  key: ToggleKey,
  defaultSettings: { mode: "off" },
});
