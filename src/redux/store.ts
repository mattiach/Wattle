import { configureStore } from "@reduxjs/toolkit";

import profileReducer from "./slices/profile/profile.slice";
import entriesReducer from "./slices/entries/entries.slice";
import settingsReducer from "./slices/settings/settings.slice";

const store = configureStore({
  devTools: true,
  reducer: {
    entries: entriesReducer,
    profile: profileReducer,
    settings: settingsReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export { store };
