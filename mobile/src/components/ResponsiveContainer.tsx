/**
 * ResponsiveContainer - Centers content and applies responsive horizontal padding
 * for universal phone + tablet support. Use this to wrap ScrollView content.
 */

import React from "react";
import { View } from "react-native";
import { useResponsive } from "@/lib/responsive";

interface ResponsiveContainerProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * Wraps content with responsive horizontal padding and centers it on large screens.
 * Use as a replacement for `className="px-5"` or `className="mx-5"` containers.
 */
export function ResponsiveContainer({ children, className }: ResponsiveContainerProps) {
  const { px, contentMaxWidth } = useResponsive();

  return (
    <View
      style={{
        paddingHorizontal: px,
        maxWidth: contentMaxWidth,
        width: "100%",
        alignSelf: "center",
      }}
      className={className}
    >
      {children}
    </View>
  );
}

/**
 * Full-width centering wrapper for screens.
 * Wraps the entire screen content to center it with a max-width on tablets.
 */
export function ResponsiveScreen({ children, className }: ResponsiveContainerProps) {
  const { contentMaxWidth } = useResponsive();

  return (
    <View
      style={{
        maxWidth: contentMaxWidth,
        width: "100%",
        alignSelf: "center",
        flex: 1,
      }}
      className={className}
    >
      {children}
    </View>
  );
}
