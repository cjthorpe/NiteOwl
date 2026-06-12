import { create } from 'zustand';

export interface FilterState {
  hours: number | null;
  provider: string | null;
  repo: string | null;
}

interface FilterActions {
  setHours: (hours: number | null) => void;
  setProvider: (provider: string | null) => void;
  setRepo: (repo: string | null) => void;
  resetFilters: () => void;
}

const initialState: FilterState = {
  hours: null,
  provider: null,
  repo: null,
};

export const useFilterStore = create<FilterState & FilterActions>((set) => ({
  ...initialState,

  setHours: (hours) => set({ hours }),
  setProvider: (provider) => set({ provider }),
  setRepo: (repo) => set({ repo }),
  resetFilters: () => set(initialState),
}));
