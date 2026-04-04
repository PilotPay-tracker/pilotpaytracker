/**
 * Responsive utilities for universal phone + tablet support.
 * Works on all iPhones, iPads, and Android devices.
 */

import { useWindowDimensions, Platform } from "react-native";

// Breakpoints (in logical pixels)
export const BREAKPOINTS = {
  phone: 0,
  tablet: 768,
  large: 1024,
} as const;

export type DeviceSize = "phone" | "tablet" | "large";

export function useResponsive() {
  const { width, height } = useWindowDimensions();

  const isTablet = width >= BREAKPOINTS.tablet;
  const isLarge = width >= BREAKPOINTS.large;
  const isPhone = width < BREAKPOINTS.tablet;
  const isLandscape = width > height;

  const deviceSize: DeviceSize = isLarge ? "large" : isTablet ? "tablet" : "phone";

  // Responsive horizontal padding
  const px = isLarge ? 40 : isTablet ? 28 : 20;

  // Responsive content max-width (centers content on very large screens)
  const contentMaxWidth = isLarge ? 900 : isTablet ? 700 : undefined;

  // Number of columns for grid layouts
  const gridCols = isLarge ? 3 : isTablet ? 2 : 1;
  const cardCols = isTablet ? 2 : 1;

  // Tab bar sizing
  const tabBarHeight = isTablet ? 72 : 88;
  const tabBarFontSize = isTablet ? 12 : 10;
  const tabIconSize = isTablet ? 26 : 24;

  // Font scale multiplier
  const fontScale = isLarge ? 1.15 : isTablet ? 1.08 : 1;

  return {
    width,
    height,
    isTablet,
    isLarge,
    isPhone,
    isLandscape,
    deviceSize,
    px,
    contentMaxWidth,
    gridCols,
    cardCols,
    tabBarHeight,
    tabBarFontSize,
    tabIconSize,
    fontScale,
  };
}

// Convenience hook - just tablet detection
export function useIsTablet() {
  const { width } = useWindowDimensions();
  return width >= BREAKPOINTS.tablet;
}
