import { create } from "zustand";

type CounterStore = {
  count: number;
  increment: () => void;
  reset: () => void;
};

export const useCounterStore = create<CounterStore>((set) => ({
  count: 0,
  increment: () => {
    set((state) => ({ count: state.count + 1 }));
  },
  reset: () => {
    set({ count: 0 });
  },
}));
