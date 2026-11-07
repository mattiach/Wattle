import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";
import { invoke } from "@tauri-apps/api/core";

import { defaultProfile } from "./profile.data";

import type { Profile } from "./profile.types";
import type { RootState } from "@/redux/store";

export const saveProfileThunk = createAsyncThunk<
  void,
  void,
  { state: RootState }
>("profile/saveProfileThunk", async (_, { getState }) => {
  const { profile } = getState();
  await invoke("save_profile", { profile });
});

const profileSlice = createSlice({
  initialState: defaultProfile,
  name: "profile",
  reducers: {
    clearProfile: () => defaultProfile,
    hydrateProfile: (_state, action: PayloadAction<Profile>) => action.payload,
    setName: (state, action: PayloadAction<string>) => {
      state.name = action.payload;
    },
  },
});

export const { clearProfile, hydrateProfile, setName } = profileSlice.actions;

export default profileSlice.reducer;
