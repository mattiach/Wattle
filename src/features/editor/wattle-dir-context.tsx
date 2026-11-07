import { invoke } from "@tauri-apps/api/core";
import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useState } from "react";

const WattleDirContext = createContext<string | null>(null);

export const WattleDirProvider = ({ children }: { children: ReactNode }) => {
  const [wattleDir, setWattleDir] = useState<string | null>(null);

  useEffect(() => {
    invoke<string>("get_wattle_dir").then(setWattleDir);
  }, []);

  return (
    <WattleDirContext.Provider value={wattleDir}>
      {children}
    </WattleDirContext.Provider>
  );
};

export const useWattleDir = () => useContext(WattleDirContext);
