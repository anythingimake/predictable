import { create } from "zustand";
import { persist } from "zustand/middleware";

interface UIState {
  adminToken: string;
  setAdminToken: (t: string) => void;
  clearAdminToken: () => void;
  callsFilter: {
    // Multi-select arrays. Undefined = no filter on that dimension.
    conviction?: string[];
    status?: string[];
    market_source?: string[];
    side?: string[];
    // Tag multi-select (broad + specific tags mixed together — match-any).
    tags?: string[];
    // Single-value, range-style.
    category?: string;
    date_from?: string;
    date_to?: string;
  };
  setCallsFilter: (f: UIState["callsFilter"]) => void;
}

export const useStore = create<UIState>()(
  persist(
    (set) => ({
      adminToken: "",
      setAdminToken: (t) => set({ adminToken: t }),
      clearAdminToken: () => set({ adminToken: "" }),
      callsFilter: {},
      setCallsFilter: (callsFilter) => set({ callsFilter }),
    }),
    { name: "predictable-ui" }
  )
);
