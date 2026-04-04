/**
 * Action Needed Modal
 * Shows action items and allows user to approve/resolve them
 * Supports swipe-to-delete gesture
 */

import { useState, useRef } from "react";
import {
  View,
  Text,
  Modal,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  FadeIn,
  FadeInDown,
  FadeOut,
  Layout,
} from "react-native-reanimated";
import {
  GestureHandlerRootView,
  Swipeable,
  ScrollView,
} from "react-native-gesture-handler";
import {
  X,
  AlertTriangle,
  CheckCircle2,
  Zap,
  FileText,
  Clock,
  ShieldCheck,
  ChevronRight,
  Trash2,
} from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { useUpdatePayEvent, useDeletePayEvent, formatEventType } from "@/lib/usePayEvents";
import { webSafeExit } from "@/lib/webSafeAnimation";
import type { PayEventType } from "@/lib/contracts";

interface ActionItem {
  id: string;
  type: "open" | "disputed" | "review" | "changes";
  title: string;
  description?: string;
  eventType?: PayEventType;
}

interface SwipeableActionItemProps {
  item: ActionItem;
  index: number;
  isResolving: boolean;
  isResolved: boolean;
  onResolve: () => void;
  onDelete: () => void;
  getItemIcon: (type: ActionItem["type"]) => React.ReactNode;
  getItemActionLabel: (type: ActionItem["type"]) => string;
}

function SwipeableActionItem({
  item,
  index,
  isResolving,
  isResolved,
  onResolve,
  onDelete,
  getItemIcon,
  getItemActionLabel,
}: SwipeableActionItemProps) {
  const swipeableRef = useRef<Swipeable>(null);
  const canSwipeDelete = item.type === "open" || item.type === "disputed";

  const handleDelete = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    swipeableRef.current?.close();
    onDelete();
  };

  const renderRightActions = () => {
    if (!canSwipeDelete) return null;

    return (
      <Pressable
        onPress={handleDelete}
        className="bg-red-500 rounded-xl justify-center items-center px-6 ml-3"
      >
        <Trash2 size={22} color="#ffffff" />
        <Text className="text-white text-xs mt-1 font-medium">Delete</Text>
      </Pressable>
    );
  };

  const content = (
    <View
      className={`rounded-xl border overflow-hidden ${
        isResolved
          ? "bg-green-500/10 border-green-500/30"
          : "bg-slate-800/60 border-slate-700/50"
      }`}
    >
      <View className="p-4">
        <View className="flex-row items-start">
          <View className="mt-0.5">{getItemIcon(item.type)}</View>
          <View className="flex-1 ml-3">
            <Text className="text-white font-medium">{item.title}</Text>
            {item.description && (
              <Text className="text-slate-400 text-sm mt-1">
                {item.description}
              </Text>
            )}
            {item.eventType && (
              <Text className="text-slate-500 text-xs mt-1">
                {formatEventType(item.eventType)}
              </Text>
            )}
          </View>
          {canSwipeDelete && (
            <View className="ml-2">
              <Text className="text-slate-600 text-xs">← swipe</Text>
            </View>
          )}
        </View>

        {/* Action Button */}
        <Pressable
          onPress={onResolve}
          disabled={isResolving || isResolved}
          className={`mt-3 rounded-lg py-2.5 flex-row items-center justify-center active:opacity-80 ${
            isResolved
              ? "bg-green-500/20"
              : item.type === "open" || item.type === "disputed"
                ? "bg-amber-500/20"
                : "bg-slate-700/50"
          }`}
        >
          {isResolving ? (
            <ActivityIndicator size="small" color="#f59e0b" />
          ) : isResolved ? (
            <>
              <CheckCircle2 size={16} color="#22c55e" />
              <Text className="text-green-400 font-medium ml-2">
                Resolved
              </Text>
            </>
          ) : (
            <>
              <Text
                className={`font-medium ${
                  item.type === "open" || item.type === "disputed"
                    ? "text-amber-400"
                    : "text-slate-300"
                }`}
              >
                {getItemActionLabel(item.type)}
              </Text>
              {(item.type === "review" || item.type === "changes") && (
                <ChevronRight size={16} color="#94a3b8" />
              )}
            </>
          )}
        </Pressable>
      </View>
    </View>
  );

  if (canSwipeDelete) {
    return (
      <Animated.View
        entering={FadeInDown.delay(index * 50)}
        exiting={webSafeExit(FadeOut)}
        layout={Layout.springify()}
        className="mb-3"
      >
        <Swipeable
          ref={swipeableRef}
          renderRightActions={renderRightActions}
          rightThreshold={40}
          friction={2}
          overshootRight={false}
          onSwipeableOpen={(direction) => {
            if (direction === "right") {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            }
          }}
        >
          {content}
        </Swipeable>
      </Animated.View>
    );
  }

  return (
    <Animated.View
      entering={FadeInDown.delay(index * 50)}
      exiting={webSafeExit(FadeOut)}
      layout={Layout.springify()}
      className="mb-3"
    >
      {content}
    </Animated.View>
  );
}

interface ActionNeededModalProps {
  visible: boolean;
  onClose: () => void;
  actionItems: ActionItem[];
  onViewAll: () => void;
  onResolveSuccess?: () => void;
  onReviewTrip?: (tripId: string) => void;
  onViewChanges?: () => void;
}

export function ActionNeededModal({
  visible,
  onClose,
  actionItems,
  onViewAll,
  onResolveSuccess,
  onReviewTrip,
  onViewChanges,
}: ActionNeededModalProps) {
  const insets = useSafeAreaInsets();
  const updatePayEvent = useUpdatePayEvent();
  const deletePayEvent = useDeletePayEvent();
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [resolvedIds, setResolvedIds] = useState<Set<string>>(new Set());
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());

  const handleResolve = async (item: ActionItem) => {
    if (item.type === "review") {
      // Navigate directly to the specific trip for review
      if (onReviewTrip) {
        onReviewTrip(item.id);
      } else {
        onViewAll();
      }
      return;
    }
    if (item.type === "changes") {
      if (onViewChanges) {
        onViewChanges();
      } else {
        onViewAll();
      }
      return;
    }

    setResolvingId(item.id);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      await updatePayEvent.mutateAsync({
        eventId: item.id,
        data: { status: "resolved" },
      });

      setResolvedIds((prev) => new Set(prev).add(item.id));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onResolveSuccess?.();
    } catch (error) {
      console.error("Failed to resolve item:", error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setResolvingId(null);
    }
  };

  const handleDelete = async (item: ActionItem) => {
    if (item.type !== "open" && item.type !== "disputed") {
      return;
    }

    // Optimistically mark as deleted
    setDeletedIds((prev) => new Set(prev).add(item.id));

    try {
      await deletePayEvent.mutateAsync(item.id);
      onResolveSuccess?.();
    } catch (error) {
      console.error("Failed to delete item:", error);
      // Revert on error
      setDeletedIds((prev) => {
        const newSet = new Set(prev);
        newSet.delete(item.id);
        return newSet;
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const handleApproveAll = async () => {
    const resolvableItems = actionItems.filter(
      (item) =>
        (item.type === "open" || item.type === "disputed") &&
        !deletedIds.has(item.id)
    );

    if (resolvableItems.length === 0) {
      onViewAll();
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

    for (const item of resolvableItems) {
      if (!resolvedIds.has(item.id)) {
        setResolvingId(item.id);
        try {
          await updatePayEvent.mutateAsync({
            eventId: item.id,
            data: { status: "resolved" },
          });
          setResolvedIds((prev) => new Set(prev).add(item.id));
        } catch (error) {
          console.error("Failed to resolve item:", item.id, error);
        }
      }
    }

    setResolvingId(null);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onResolveSuccess?.();

    setTimeout(() => {
      onClose();
    }, 500);
  };

  const getItemIcon = (type: ActionItem["type"]) => {
    switch (type) {
      case "open":
        return <Clock size={18} color="#f59e0b" />;
      case "disputed":
        return <AlertTriangle size={18} color="#ef4444" />;
      case "review":
        return <FileText size={18} color="#3b82f6" />;
      case "changes":
        return <ShieldCheck size={18} color="#a78bfa" />;
      default:
        return <Zap size={18} color="#f59e0b" />;
    }
  };

  const getItemActionLabel = (type: ActionItem["type"]) => {
    switch (type) {
      case "open":
      case "disputed":
        return "Resolve";
      case "review":
        return "Review Trip";
      case "changes":
        return "View Changes";
      default:
        return "Action";
    }
  };

  const remainingItems = actionItems.filter(
    (item) => !resolvedIds.has(item.id) && !deletedIds.has(item.id)
  );
  const hasResolvableItems = remainingItems.some(
    (item) => item.type === "open" || item.type === "disputed"
  );

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View className="flex-1 bg-black/60">
          <Pressable className="flex-1" onPress={onClose} />
          <Animated.View
            entering={FadeIn}
            className="bg-slate-900 rounded-t-3xl"
            style={{ paddingBottom: insets.bottom + 16, maxHeight: "70%" }}
          >
            {/* Header */}
            <View className="px-5 py-4 border-b border-slate-700/50">
              <View className="flex-row items-center justify-between">
                <View className="flex-row items-center">
                  <Zap size={20} color="#f59e0b" />
                  <Text className="text-white text-lg font-semibold ml-2">
                    Action Needed
                  </Text>
                  {remainingItems.length > 0 && (
                    <View className="bg-amber-500/20 rounded-full px-2 py-0.5 ml-2">
                      <Text className="text-amber-400 text-xs font-medium">
                        {remainingItems.length}
                      </Text>
                    </View>
                  )}
                </View>
                <Pressable onPress={onClose} className="active:opacity-70">
                  <X size={20} color="#64748b" />
                </Pressable>
              </View>
              {/* Swipe hint */}
              {hasResolvableItems && remainingItems.length > 0 && (
                <Text className="text-slate-500 text-xs mt-2">
                  Swipe left on items to delete
                </Text>
              )}
            </View>

            {/* Content */}
            <ScrollView
              className="px-5 py-4"
              showsVerticalScrollIndicator={false}
            >
              {remainingItems.length === 0 ? (
                <Animated.View
                  entering={FadeInDown}
                  className="items-center py-8"
                >
                  <CheckCircle2 size={48} color="#22c55e" />
                  <Text className="text-white text-lg font-semibold mt-4">
                    All Clear!
                  </Text>
                  <Text className="text-slate-400 text-center mt-2">
                    No action items remaining
                  </Text>
                </Animated.View>
              ) : (
                <View>
                  {remainingItems.map((item, index) => (
                    <SwipeableActionItem
                      key={item.id}
                      item={item}
                      index={index}
                      isResolving={resolvingId === item.id}
                      isResolved={resolvedIds.has(item.id)}
                      onResolve={() => handleResolve(item)}
                      onDelete={() => handleDelete(item)}
                      getItemIcon={getItemIcon}
                      getItemActionLabel={getItemActionLabel}
                    />
                  ))}
                </View>
              )}
            </ScrollView>

            {/* Footer Actions */}
            {remainingItems.length > 0 && (
              <View className="px-5 pt-3 border-t border-slate-700/50">
                <View className="flex-row gap-3">
                  <Pressable
                    onPress={onViewAll}
                    className="flex-1 bg-slate-800/60 rounded-xl py-3 items-center active:opacity-80"
                  >
                    <Text className="text-slate-300 font-medium">
                      View Details
                    </Text>
                  </Pressable>

                  {hasResolvableItems && (
                    <Pressable
                      onPress={handleApproveAll}
                      disabled={resolvingId !== null}
                      className="flex-1 bg-green-500/20 border border-green-500/30 rounded-xl py-3 items-center active:opacity-80"
                    >
                      {resolvingId !== null ? (
                        <ActivityIndicator size="small" color="#22c55e" />
                      ) : (
                        <Text className="text-green-400 font-medium">
                          Approve All
                        </Text>
                      )}
                    </Pressable>
                  )}
                </View>
              </View>
            )}
          </Animated.View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}
