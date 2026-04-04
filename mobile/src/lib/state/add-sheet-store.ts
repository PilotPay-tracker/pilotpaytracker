import { create } from "zustand";

interface AddSheetState {
  visible: boolean;
  open: () => void;
  close: () => void;
}

export const useAddSheetStore = create<AddSheetState>((set) => ({
  visible: false,
  open: () => set({ visible: true }),
  close: () => set({ visible: false }),
}));
