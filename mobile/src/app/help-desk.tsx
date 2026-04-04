/**
 * AI Help Desk Screen
 *
 * Chat interface for users to get help with the app.
 * Includes tutorials for importing schedules and can escalate to support tickets.
 * Airline-aware: shows relevant instructions based on user's airline.
 */

import { useState, useRef, useCallback, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Animated, { FadeInDown, FadeInUp } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import {
  ChevronLeft,
  Send,
  Bot,
  User,
  HelpCircle,
  Calendar,
  Upload,
  DollarSign,
  AlertCircle,
  MessageSquare,
} from "lucide-react-native";
import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useProfileStore } from "@/lib/state/profile-store";
import type { HelpDeskMessage, HelpDeskChatResponse } from "@/lib/contracts";

// UPS display name - this is a UPS-only app
const AIRLINE_NAME = "UPS Airlines";

// Quick action type
interface QuickAction {
  id: string;
  label: string;
  icon: typeof Upload;
  message: string;
}

// Get quick actions based on airline
function getQuickActions(_airline: string | null): QuickAction[] {
  // Default actions that work for all airlines
  return [
    {
      id: "import-schedule",
      label: "How to import schedule",
      icon: Upload,
      message: "How do I import my schedule?",
    },
    {
      id: "schedule-details",
      label: "Schedule import tips",
      icon: Calendar,
      message: "What's the best way to take screenshots for importing?",
    },
    {
      id: "pay-tracking",
      label: "Pay tracking help",
      icon: DollarSign,
      message: "How does pay tracking work in this app?",
    },
    {
      id: "general-help",
      label: "General help",
      icon: HelpCircle,
      message: "What can this app do?",
    },
  ];
}

// Get welcome message - always UPS
function getWelcomeMessage(_airline: string | null): string {
  return `Hi! I'm your AI assistant for UPS Pilot Pay Tracker. I can help you with:

• Importing schedules from Crew Access
• Understanding pay tracking features
• Troubleshooting issues

What can I help you with today?`;
}

interface ChatMessage extends HelpDeskMessage {
  id: string;
  isLoading?: boolean;
}

export default function HelpDeskScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const scrollViewRef = useRef<ScrollView>(null);

  // Get user's airline from profile
  const airline = useProfileStore((s) => s.profile?.airline ?? null);
  const quickActions = getQuickActions(airline);

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content: getWelcomeMessage(airline),
    },
  ]);
  const [inputText, setInputText] = useState("");
  const [showQuickActions, setShowQuickActions] = useState(true);
  const [suggestTicket, setSuggestTicket] = useState(false);
  const [ticketCategory, setTicketCategory] = useState<string>("other");

  // Update welcome message if airline changes
  useEffect(() => {
    setMessages((prev) => {
      const newMessages = [...prev];
      const welcomeIndex = newMessages.findIndex((m) => m.id === "welcome");
      if (welcomeIndex !== -1) {
        newMessages[welcomeIndex] = {
          ...newMessages[welcomeIndex],
          content: getWelcomeMessage(airline),
        };
      }
      return newMessages;
    });
  }, [airline]);

  // Chat mutation
  const { mutate, isPending } = useMutation({
    mutationFn: async (message: string) => {
      const conversationHistory = messages
        .filter((m) => m.id !== "welcome" && !m.isLoading)
        .map((m) => ({ role: m.role, content: m.content }));

      const response = await api.post<HelpDeskChatResponse>("/api/support/help-desk", {
        message,
        conversationHistory,
      });
      return response;
    },
    onSuccess: (data) => {
      // Remove loading message and add real response
      setMessages((prev) => {
        const withoutLoading = prev.filter((m) => !m.isLoading);
        return [
          ...withoutLoading,
          {
            id: `assistant-${Date.now()}`,
            role: "assistant",
            content: data.response,
          },
        ];
      });

      if (data.suggestTicket) {
        setSuggestTicket(true);
        setTicketCategory(data.ticketCategory ?? "other");
      }
    },
    onError: (error) => {
      // Remove loading message and add error
      setMessages((prev) => {
        const withoutLoading = prev.filter((m) => !m.isLoading);
        return [
          ...withoutLoading,
          {
            id: `error-${Date.now()}`,
            role: "assistant",
            content:
              "I'm sorry, I had trouble processing that. Please try again or submit a support ticket if the issue persists.",
          },
        ];
      });
      setSuggestTicket(true);
    },
  });

  const handleSend = useCallback(
    (messageText?: string) => {
      const text = messageText ?? inputText.trim();
      if (!text || isPending) return;

      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setShowQuickActions(false);
      setSuggestTicket(false);

      // Add user message
      const userMessage: ChatMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        content: text,
      };

      // Add loading message
      const loadingMessage: ChatMessage = {
        id: `loading-${Date.now()}`,
        role: "assistant",
        content: "",
        isLoading: true,
      };

      setMessages((prev) => [...prev, userMessage, loadingMessage]);
      setInputText("");

      // Send to API
      mutate(text);
    },
    [inputText, isPending, mutate]
  );

  const handleQuickAction = useCallback(
    (action: QuickAction) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      handleSend(action.message);
    },
    [handleSend]
  );

  const handleSubmitTicket = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // Navigate back to settings where the ticket modal is
    router.push({
      pathname: "/settings",
      params: { openTicket: "true", category: ticketCategory },
    });
  }, [router, ticketCategory]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }, 100);
  }, [messages]);

  return (
    <View className="flex-1 bg-slate-950">
      <LinearGradient
        colors={["#0f172a", "#1e3a5a", "#0f172a"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ flex: 1 }}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={{ flex: 1 }}
          keyboardVerticalOffset={0}
        >
          {/* Header */}
          <Animated.View
            entering={FadeInDown.duration(400)}
            style={{ paddingTop: insets.top + 8 }}
            className="px-4 pb-3 border-b border-slate-800/50"
          >
            <View className="flex-row items-center">
              <Pressable
                onPress={() => router.back()}
                className="w-10 h-10 rounded-full bg-slate-800/60 items-center justify-center active:opacity-70"
              >
                <ChevronLeft size={24} color="#f59e0b" />
              </Pressable>
              <View className="flex-1 items-center">
                <View className="flex-row items-center">
                  <Bot size={20} color="#f59e0b" />
                  <Text className="text-white text-lg font-semibold ml-2">
                    Help Desk
                  </Text>
                </View>
                <Text className="text-slate-400 text-xs">AI Assistant</Text>
              </View>
              <View className="w-10" />
            </View>
          </Animated.View>

          {/* Messages */}
          <ScrollView
            ref={scrollViewRef}
            className="flex-1 px-4"
            contentContainerStyle={{ paddingTop: 16, paddingBottom: 16 }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {messages.map((message, index) => (
              <Animated.View
                key={message.id}
                entering={FadeInUp.duration(300).delay(index * 50)}
                className={`mb-4 ${message.role === "user" ? "items-end" : "items-start"}`}
              >
                <View
                  className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                    message.role === "user"
                      ? "bg-amber-500 rounded-br-md"
                      : "bg-slate-800/80 rounded-bl-md border border-slate-700/50"
                  }`}
                >
                  {message.isLoading ? (
                    <View className="flex-row items-center py-1">
                      <ActivityIndicator size="small" color="#f59e0b" />
                      <Text className="text-slate-400 text-sm ml-2">
                        Thinking...
                      </Text>
                    </View>
                  ) : (
                    <Text
                      className={`text-base leading-relaxed ${
                        message.role === "user" ? "text-slate-900" : "text-white"
                      }`}
                    >
                      {message.content}
                    </Text>
                  )}
                </View>

                {/* Role indicator */}
                <View className="flex-row items-center mt-1 px-1">
                  {message.role === "user" ? (
                    <User size={12} color="#64748b" />
                  ) : (
                    <Bot size={12} color="#64748b" />
                  )}
                  <Text className="text-slate-500 text-xs ml-1">
                    {message.role === "user" ? "You" : "AI Assistant"}
                  </Text>
                </View>
              </Animated.View>
            ))}

            {/* Quick Actions */}
            {showQuickActions && (
              <Animated.View
                entering={FadeInUp.duration(400).delay(200)}
                className="mt-4"
              >
                <Text className="text-slate-400 text-sm font-medium mb-3">
                  Quick Help Topics
                </Text>
                <View className="flex-row flex-wrap gap-2">
                  {quickActions.map((action) => {
                    const Icon = action.icon;
                    return (
                      <Pressable
                        key={action.id}
                        onPress={() => handleQuickAction(action)}
                        className="flex-row items-center bg-slate-800/60 border border-slate-700/50 rounded-xl px-3 py-2.5 active:opacity-70"
                      >
                        <Icon size={16} color="#f59e0b" />
                        <Text className="text-slate-300 text-sm ml-2">
                          {action.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </Animated.View>
            )}

            {/* Suggest Ticket */}
            {suggestTicket && (
              <Animated.View
                entering={FadeInUp.duration(400)}
                className="mt-4 bg-amber-500/10 border border-amber-500/30 rounded-xl p-4"
              >
                <View className="flex-row items-center mb-2">
                  <AlertCircle size={18} color="#f59e0b" />
                  <Text className="text-amber-500 font-semibold ml-2">
                    Need more help?
                  </Text>
                </View>
                <Text className="text-slate-300 text-sm mb-3">
                  If I couldn't fully resolve your issue, you can submit a
                  support ticket and we'll get back to you.
                </Text>
                <Pressable
                  onPress={handleSubmitTicket}
                  className="flex-row items-center justify-center bg-amber-500 rounded-xl py-3 active:opacity-80"
                >
                  <MessageSquare size={18} color="#0f172a" />
                  <Text className="text-slate-900 font-semibold ml-2">
                    Submit Support Ticket
                  </Text>
                </Pressable>
              </Animated.View>
            )}
          </ScrollView>

          {/* Input Area */}
          <View
            className="px-4 pt-3 pb-2 border-t border-slate-800/50 bg-slate-950/90"
            style={{ paddingBottom: Math.max(insets.bottom, 8) }}
          >
            <View className="flex-row items-end">
              <View className="flex-1 bg-slate-800/60 rounded-2xl border border-slate-700/50 px-4 py-2 mr-2">
                <TextInput
                  value={inputText}
                  onChangeText={setInputText}
                  placeholder="Ask a question..."
                  placeholderTextColor="#64748b"
                  multiline
                  maxLength={500}
                  className="text-white text-base max-h-24"
                  style={{ minHeight: 24 }}
                  onSubmitEditing={() => handleSend()}
                  returnKeyType="send"
                  blurOnSubmit={false}
                />
              </View>
              <Pressable
                onPress={() => handleSend()}
                disabled={!inputText.trim() || isPending}
                className={`w-12 h-12 rounded-full items-center justify-center ${
                  inputText.trim() && !isPending
                    ? "bg-amber-500 active:opacity-80"
                    : "bg-slate-700"
                }`}
              >
                {isPending ? (
                  <ActivityIndicator size="small" color="#0f172a" />
                ) : (
                  <Send
                    size={20}
                    color={inputText.trim() ? "#0f172a" : "#64748b"}
                  />
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </LinearGradient>
    </View>
  );
}
