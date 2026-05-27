import { create } from "zustand";
import { persist } from "zustand/middleware";

interface UIState {
  adminToken: string;
  setAdminToken: (t: string) => void;
  clearAdminToken: () => void;
  callsFilter: {
    conviction?: string;
    status?: string;
    category?: string;
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
