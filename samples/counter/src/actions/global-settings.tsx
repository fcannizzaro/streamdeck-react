import { defineAction, tw, useGlobalSettings, useKeyDown } from "@fcannizzaro/streamdeck-react";

type CounterSettings = { globalCount: number };

// ── Counter Key ─────────────────────────────────────────────────────
// Single tap increments, double tap decrements, long press resets.
// The count is persisted in the action settings.

function GlobalSettingsKey() {
  const [settings, setSettings] = useGlobalSettings<CounterSettings>();
  const globalCount = settings.globalCount ?? 0;

  useKeyDown(() => {
    setSettings({
      globalCount: globalCount + 1,
    });
  });

  return (
    <div
      className={tw(
        "flex flex-col items-center justify-center w-full h-full gap-0",
        "bg-linear-to-br from-[#667eea] to-[#764ba2]",
      )}
    >
      <span className="text-white/70 text-[12px] font-medium">GLOBAL COUNT</span>
      <span className="text-white text-[64px] mt-2 font-bold font-[SplineSansMono]">
        {globalCount}
      </span>
    </div>
  );
}

export const globalSettingsKey = defineAction({
  uuid: "com.example.react-counter.global-settings",
  key: GlobalSettingsKey,
  info: {
    name: "Global Settings",
    icon: "imgs/actions/global-settings",
    tooltip: "A simple counter that allow testing global settings",
  },
});
