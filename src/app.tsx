import { useEffect } from "react";
import { MotionConfig } from "motion/react";
import { Provider } from "react-redux";
import { RouterProvider } from "react-router";

import { TooltipProvider } from "./components/ui/tooltip";

import { WattleDirProvider } from "./features/editor/wattle-dir-context";
import { LanguageProvider } from "./languages/language-provider";
import { store } from "./redux/store";
import { router } from "./routing/router";
import { AppearanceProvider } from "./theme/appearance-provider";
import { ThemeProvider } from "./theme/theme-provider";
import { ZoomProvider } from "./theme/zoom-provider";

import "./styles/globals.css";

function App() {
  useEffect(() => {
    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };

    window.addEventListener("contextmenu", handleContextMenu);

    return () => {
      window.removeEventListener("contextmenu", handleContextMenu);
    };
  }, []);

  return (
    <Provider store={store}>
      {/* At the root, not around one component: every animation added from
          here on inherits the operating system's reduced-motion setting
          without having to remember to ask for it. */}
      <MotionConfig reducedMotion="user">
        <ThemeProvider>
          <AppearanceProvider>
            <ZoomProvider>
              <LanguageProvider>
                <WattleDirProvider>
                  {/* A short delay rather than none: a tooltip that fires the
                  instant the pointer crosses a control is noise. */}
                  <TooltipProvider delay={350}>
                    <RouterProvider router={router} />
                  </TooltipProvider>
                </WattleDirProvider>
              </LanguageProvider>
            </ZoomProvider>
          </AppearanceProvider>
        </ThemeProvider>
      </MotionConfig>
    </Provider>
  );
}

export default App;
