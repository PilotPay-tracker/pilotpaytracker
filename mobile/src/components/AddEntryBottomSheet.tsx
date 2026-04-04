/**
 * AddEntryBottomSheet
 * Global "Log Center" menu — shown when user taps the center Log tab.
 */

import React from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
} from "react-native";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Plane,
  ClipboardList,
  Camera,
  Heart,
  X,
  ChevronRight,
  DollarSign,
  ShieldCheck,
} from "lucide-react-native";

interface Props {
  visible: boolean;
  onClose: () => void;
}

const SECTION_HEADER_STYLE = {
  color: "#475569",
  fontSize: 11,
  fontWeight: "700" as const,
  letterSpacing: 1.2,
  marginBottom: 8,
  marginTop: 4,
  paddingHorizontal: 4,
};

export function AddEntryBottomSheet({ visible, onClose }: Props) {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const handleAction = (action: () => void) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onClose();
    setTimeout(action, 180);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      {/* Backdrop */}
      <TouchableOpacity
        activeOpacity={1}
        onPress={onClose}
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.55)",
          justifyContent: "flex-end",
        }}
      >
        {/* Sheet — TouchableOpacity inside stops backdrop close when tapping sheet */}
        <TouchableOpacity activeOpacity={1} onPress={() => {}}>
          <View
            style={{
              backgroundColor: "#0f172a",
              borderTopLeftRadius: 28,
              borderTopRightRadius: 28,
              borderTopWidth: 1,
              borderLeftWidth: 1,
              borderRightWidth: 1,
              borderColor: "#1e293b",
              paddingBottom: insets.bottom + 20,
            }}
          >
            {/* Pull handle */}
            <View style={{ alignItems: "center", paddingTop: 14, paddingBottom: 4 }}>
              <View
                style={{
                  width: 40,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: "#334155",
                }}
              />
            </View>

            {/* Header */}
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                paddingHorizontal: 24,
                paddingTop: 12,
                paddingBottom: 20,
              }}
            >
              <View>
                <Text
                  style={{
                    color: "#f8fafc",
                    fontSize: 22,
                    fontWeight: "700",
                    letterSpacing: -0.5,
                  }}
                >
                  Log Center
                </Text>
                <Text style={{ color: "#475569", fontSize: 13, marginTop: 3 }}>
                  Log events that impact your pay, schedule, and records
                </Text>
              </View>
              <TouchableOpacity
                onPress={onClose}
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 17,
                  backgroundColor: "#1e293b",
                  borderWidth: 1,
                  borderColor: "#334155",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <X size={15} color="#64748b" strokeWidth={2.5} />
              </TouchableOpacity>
            </View>

            {/* Sections */}
            <View style={{ paddingHorizontal: 16 }}>

              {/* ── AUDIT & VERIFY ── */}
              <Text style={SECTION_HEADER_STYLE}>AUDIT & VERIFY</Text>

              {/* Pay Audit — highlighted primary card */}
              <TouchableOpacity
                onPress={() => handleAction(() => router.push("/pay-audit"))}
                activeOpacity={0.7}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  backgroundColor: "rgba(245,158,11,0.09)",
                  borderRadius: 16,
                  borderWidth: 2,
                  borderColor: "#f59e0b",
                  paddingHorizontal: 16,
                  paddingVertical: 14,
                  marginBottom: 0,
                  shadowColor: "#f59e0b",
                  shadowOffset: { width: 0, height: 0 },
                  shadowOpacity: 0.18,
                  shadowRadius: 12,
                  elevation: 4,
                }}
              >
                {/* Icon badge */}
                <View
                  style={{
                    width: 46,
                    height: 46,
                    borderRadius: 13,
                    backgroundColor: "rgba(245,158,11,0.15)",
                    alignItems: "center",
                    justifyContent: "center",
                    marginRight: 14,
                  }}
                >
                  <DollarSign size={22} color="#f59e0b" strokeWidth={1.8} />
                </View>

                {/* Labels */}
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Text
                      style={{
                        color: "#f1f5f9",
                        fontSize: 16,
                        fontWeight: "600",
                        letterSpacing: -0.2,
                      }}
                    >
                      Pay Audit
                    </Text>
                    <View
                      style={{
                        backgroundColor: "rgba(245,158,11,0.2)",
                        borderRadius: 6,
                        paddingHorizontal: 6,
                        paddingVertical: 2,
                      }}
                    >
                      <Text
                        style={{
                          color: "#f59e0b",
                          fontSize: 9,
                          fontWeight: "700",
                          letterSpacing: 0.8,
                        }}
                      >
                        MOST POWERFUL TOOL
                      </Text>
                    </View>
                  </View>
                  <Text style={{ color: "#64748b", fontSize: 13, marginTop: 2 }}>
                    Find missing pay & errors instantly
                  </Text>
                </View>

                <ChevronRight size={18} color="#f59e0b" strokeWidth={2} />
              </TouchableOpacity>

              {/* ── PAY IMPACT ── */}
              <Text style={[SECTION_HEADER_STYLE, { marginTop: 20 }]}>PAY IMPACT</Text>

              {/* Log Pay Event */}
              <TouchableOpacity
                onPress={() => handleAction(() => router.push("/create-log-event"))}
                activeOpacity={0.7}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  backgroundColor: "#131f30",
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: "#1e2f45",
                  paddingHorizontal: 16,
                  paddingVertical: 14,
                  marginBottom: 10,
                }}
              >
                <View
                  style={{
                    width: 46,
                    height: 46,
                    borderRadius: 13,
                    backgroundColor: "rgba(245,158,11,0.15)",
                    alignItems: "center",
                    justifyContent: "center",
                    marginRight: 14,
                  }}
                >
                  <Plane size={22} color="#f59e0b" strokeWidth={1.8} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: "#f1f5f9", fontSize: 16, fontWeight: "600", letterSpacing: -0.2 }}>
                    Log Pay Event
                  </Text>
                  <Text style={{ color: "#64748b", fontSize: 13, marginTop: 2 }}>
                    Late arrival, JA, premium pay
                  </Text>
                </View>
                <ChevronRight size={18} color="#334155" strokeWidth={2} />
              </TouchableOpacity>

              {/* Capture OOOI */}
              <TouchableOpacity
                onPress={() => handleAction(() => router.push("/oooi-capture"))}
                activeOpacity={0.7}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  backgroundColor: "#131f30",
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: "#1e2f45",
                  paddingHorizontal: 16,
                  paddingVertical: 14,
                  marginBottom: 0,
                }}
              >
                <View
                  style={{
                    width: 46,
                    height: 46,
                    borderRadius: 13,
                    backgroundColor: "rgba(20,184,166,0.15)",
                    alignItems: "center",
                    justifyContent: "center",
                    marginRight: 14,
                  }}
                >
                  <Camera size={22} color="#14b8a6" strokeWidth={1.8} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: "#f1f5f9", fontSize: 16, fontWeight: "600", letterSpacing: -0.2 }}>
                    Capture OOOI
                  </Text>
                  <Text style={{ color: "#64748b", fontSize: 13, marginTop: 2 }}>
                    Scan ACARS or enter flight times
                  </Text>
                </View>
                <ChevronRight size={18} color="#334155" strokeWidth={2} />
              </TouchableOpacity>

              {/* ── RECORDS ── */}
              <Text style={[SECTION_HEADER_STYLE, { marginTop: 20 }]}>RECORDS</Text>

              {/* View Records */}
              <TouchableOpacity
                onPress={() => handleAction(() => router.push("/(tabs)/history"))}
                activeOpacity={0.7}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  backgroundColor: "#131f30",
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: "#1e2f45",
                  paddingHorizontal: 16,
                  paddingVertical: 14,
                  marginBottom: 10,
                }}
              >
                <View
                  style={{
                    width: 46,
                    height: 46,
                    borderRadius: 13,
                    backgroundColor: "rgba(129,140,248,0.15)",
                    alignItems: "center",
                    justifyContent: "center",
                    marginRight: 14,
                  }}
                >
                  <ClipboardList size={22} color="#818cf8" strokeWidth={1.8} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: "#f1f5f9", fontSize: 16, fontWeight: "600", letterSpacing: -0.2 }}>
                    View Records
                  </Text>
                  <Text style={{ color: "#64748b", fontSize: 13, marginTop: 2 }}>
                    Full log history & audit trail
                  </Text>
                </View>
                <ChevronRight size={18} color="#334155" strokeWidth={2} />
              </TouchableOpacity>

              {/* Log Sick Time */}
              <TouchableOpacity
                onPress={() => handleAction(() => router.push("/sick-tracker"))}
                activeOpacity={0.7}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  backgroundColor: "#131f30",
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: "#1e2f45",
                  paddingHorizontal: 16,
                  paddingVertical: 14,
                }}
              >
                <View
                  style={{
                    width: 46,
                    height: 46,
                    borderRadius: 13,
                    backgroundColor: "#ffffff",
                    borderWidth: 2,
                    borderColor: "#f43f5e",
                    alignItems: "center",
                    justifyContent: "center",
                    marginRight: 14,
                  }}
                >
                  <Heart size={22} color="#f43f5e" strokeWidth={1.8} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: "#f1f5f9", fontSize: 16, fontWeight: "600", letterSpacing: -0.2 }}>
                    Log Sick Time
                  </Text>
                  <Text style={{ color: "#64748b", fontSize: 13, marginTop: 2 }}>
                    Track sick hours & usage
                  </Text>
                </View>
                <ChevronRight size={18} color="#334155" strokeWidth={2} />
              </TouchableOpacity>

            </View>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}
