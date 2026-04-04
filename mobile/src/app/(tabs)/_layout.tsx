import React from "react";
import { Tabs } from "expo-router";
import { View, Text, Pressable } from "react-native";
import {
  LayoutDashboard,
  Briefcase,
  TrendingUp,
  Wrench,
} from "lucide-react-native";
import { useUnacknowledgedChangesCount } from "@/lib/useSnapshotData";
import { SubscriptionGate } from "@/components/SubscriptionGate";
import { useResponsive } from "@/lib/responsive";
import { AddEntryBottomSheet } from "@/components/AddEntryBottomSheet";
import { useAddSheetStore } from "@/lib/state/add-sheet-store";

function TabBarIcon({
  Icon,
  color,
  focused,
  badge,
  iconSize,
}: {
  Icon: React.ComponentType<{ size: number; color: string }>;
  color: string;
  focused: boolean;
  badge?: number;
  iconSize: number;
}) {
  const badgeSize = Math.round(iconSize * 0.67);
  return (
    <View
      className={`items-center justify-center ${focused ? "opacity-100" : "opacity-60"}`}
    >
      <Icon size={iconSize} color={color} />
      {badge !== undefined && badge > 0 && (
        <View
          className="absolute -top-1 -right-2 bg-amber-500 rounded-full items-center justify-center px-1"
          style={{ minWidth: badgeSize, height: badgeSize }}
        >
          <Text
            className="text-slate-900 font-bold"
            style={{ fontSize: badgeSize * 0.6 }}
          >
            {badge > 9 ? "9+" : badge}
          </Text>
        </View>
      )}
    </View>
  );
}

function AddTabButton({ iconSize }: { iconSize: number }) {
  return (
    <View
      style={{
        width: iconSize + 16,
        height: iconSize + 16,
        borderRadius: (iconSize + 16) / 2,
        backgroundColor: "#f59e0b",
        alignItems: "center",
        justifyContent: "center",
        shadowColor: "#f59e0b",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.5,
        shadowRadius: 8,
        elevation: 6,
        marginBottom: 2,
      }}
    >
      <Text
        style={{
          color: "#0f172a",
          fontSize: iconSize,
          fontWeight: "700",
          lineHeight: iconSize + 2,
          marginTop: -1,
        }}
      >
        +
      </Text>
    </View>
  );
}

export default function TabLayout() {
  const unacknowledgedChangesCount = useUnacknowledgedChangesCount();
  const { tabBarHeight, tabBarFontSize, tabIconSize } = useResponsive();
  const addSheetVisible = useAddSheetStore((s) => s.visible);
  const openAddSheet = useAddSheetStore((s) => s.open);
  const closeAddSheet = useAddSheetStore((s) => s.close);

  return (
    <SubscriptionGate>
      <Tabs
        screenOptions={{
          tabBarActiveTintColor: "#f59e0b",
          tabBarInactiveTintColor: "#475569",
          tabBarStyle: {
            backgroundColor: "#070e1a",
            borderTopColor: "rgba(255,255,255,0.06)",
            borderTopWidth: 1,
            paddingTop: 8,
            paddingBottom: 8,
            height: tabBarHeight,
          },
          tabBarLabelStyle: {
            fontSize: tabBarFontSize,
            fontWeight: "600",
            marginTop: 4,
          },
          headerShown: false,
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: "Dashboard",
            tabBarIcon: ({ color, focused }) => (
              <TabBarIcon Icon={LayoutDashboard} color={color} focused={focused} iconSize={tabIconSize} />
            ),
          }}
        />
        <Tabs.Screen
          name="trips"
          options={{
            title: "Trips",
            tabBarIcon: ({ color, focused }) => (
              <TabBarIcon
                Icon={Briefcase}
                color={color}
                focused={focused}
                badge={unacknowledgedChangesCount}
                iconSize={tabIconSize}
              />
            ),
          }}
        />
        {/* + Add Tab — intercepts tap to open bottom sheet */}
        <Tabs.Screen
          name="add"
          options={{
            title: "Add",
            tabBarButton: () => (
              <Pressable
                onPress={() => {
                  openAddSheet();
                }}
                style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 8, paddingBottom: 8 }}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <AddTabButton iconSize={tabIconSize} />
                <Text
                  style={{
                    color: "#64748b",
                    fontSize: tabBarFontSize,
                    fontWeight: "600",
                    marginTop: 4,
                  }}
                >
                  Log
                </Text>
              </Pressable>
            ),
          }}
        />
        {/* History tab hidden from nav bar but still accessible */}
        <Tabs.Screen
          name="history"
          options={{
            title: "Records",
            href: null,
          }}
        />
        <Tabs.Screen
          name="career"
          options={{
            title: "Career",
            tabBarIcon: ({ color, focused }) => (
              <TabBarIcon Icon={TrendingUp} color={color} focused={focused} iconSize={tabIconSize} />
            ),
          }}
        />
        <Tabs.Screen
          name="tools"
          options={{
            title: "Tools",
            tabBarIcon: ({ color, focused }) => (
              <TabBarIcon Icon={Wrench} color={color} focused={focused} iconSize={tabIconSize} />
            ),
          }}
        />
      </Tabs>

      {/* Global Add Entry Bottom Sheet */}
      <AddEntryBottomSheet
        visible={addSheetVisible}
        onClose={closeAddSheet}
      />
    </SubscriptionGate>
  );
}
