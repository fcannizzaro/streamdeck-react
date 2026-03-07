import { atom, createStore } from "jotai";

export const store = createStore();

export const countAtom = atom(0);

export const incrementAtom = atom(null, (get, set) => {
  set(countAtom, get(countAtom) + 1);
});

export const resetAtom = atom(null, (_get, set) => {
  set(countAtom, 0);
});
