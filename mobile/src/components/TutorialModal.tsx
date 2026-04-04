/**
 * Tutorial Modal Component
 *
 * A reusable tutorial modal with steps navigation.
 * Shows auto-opens on first visit, can be reopened via Help button.
 */

import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  Modal,
  Pressable,
  Dimensions,
  Image,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, {
  FadeIn,
  FadeInDown,
  FadeOut,
  SlideInRight,
  SlideOutLeft,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import {
  X,
  ChevronLeft,
  ChevronRight,
  HelpCircle,
  Check,
  Globe,
  Calendar,
  Plane,
  Camera,
  List,
  Search,
  Upload,
  Clock,
  MousePointer,
  Wallet,
  DollarSign,
  BadgeDollarSign,
  Plus,
  Calculator,
  ArrowRight,
  FileSearch,
  Filter,
  Lock,
  TrendingUp,
  Wrench,
  User,
  FileText,
  Building,
  CheckCircle2,
  Shield,
  Sparkles,
  RefreshCw,
  LayoutDashboard,
  AlertCircle,
  Info,
  Star,
  Paperclip,
  History,
  Download,
  BarChart2,
  Target,
  BookOpen,
  GitBranch,
  Settings,
  Receipt,
  Navigation,
  Rocket,
  ArrowUpRight,
  Award,
  Heart,
  Lightbulb,
  PiggyBank,
  Edit3,
  Utensils,
  type LucideIcon,
} from "lucide-react-native";
import {
  type TutorialId,
  type TutorialContent,
  TUTORIALS,
  useTutorialStore,
  useHasSeenTutorial,
} from "@/lib/state/tutorial-store";
import { webSafeExit } from '@/lib/webSafeAnimation';

const { width: SCREEN_WIDTH } = Dimensions.get("window");

// Icon mapping
const ICON_MAP: Record<string, LucideIcon> = {
  Globe,
  Calendar,
  Plane,
  Camera,
  List,
  Search,
  Upload,
  Clock,
  MousePointer,
  Wallet,
  DollarSign,
  BadgeDollarSign,
  Plus,
  Calculator,
  ArrowRight,
  FileSearch,
  Filter,
  Lock,
  TrendingUp,
  Wrench,
  User,
  HelpCircle,
  FileText,
  Building,
  CheckCircle2,
  Shield,
  Sparkles,
  RefreshCw,
  LayoutDashboard,
  AlertCircle,
  Info,
  Star,
  Paperclip,
  History,
  Download,
  BarChart2,
  Target,
  BookOpen,
  GitBranch,
  Settings,
  Receipt,
  Navigation,
  Rocket,
  ChevronRight,
  ArrowUpRight,
  Award,
  Heart,
  Lightbulb,
  PiggyBank,
  Edit3,
  Utensils,
};

interface TutorialModalProps {
  tutorialId: TutorialId;
  visible: boolean;
  onClose: () => void;
  onComplete?: () => void;
}

export function TutorialModal({
  tutorialId,
  visible,
  onClose,
  onComplete,
}: TutorialModalProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const markTutorialSeen = useTutorialStore((s) => s.markTutorialSeen);

  const tutorial = TUTORIALS[tutorialId];

  // Reset step when opening
  useEffect(() => {
    if (visible) {
      setCurrentStep(0);
    }
  }, [visible]);

  const handleNext = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (currentStep < tutorial.steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      // Last step - mark as seen and close
      markTutorialSeen(tutorialId);
      onComplete?.();
      onClose();
    }
  }, [currentStep, tutorial.steps.length, tutorialId, markTutorialSeen, onComplete, onClose]);

  const handleBack = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  }, [currentStep]);

  const handleSkip = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    markTutorialSeen(tutorialId);
    onClose();
  }, [tutorialId, markTutorialSeen, onClose]);

  const handleDontShowAgain = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    markTutorialSeen(tutorialId);
    onClose();
  }, [tutorialId, markTutorialSeen, onClose]);

  if (!tutorial) return null;

  const step = tutorial.steps[currentStep];
  const isLastStep = currentStep === tutorial.steps.length - 1;
  const IconComponent = step.icon ? ICON_MAP[step.icon] ?? HelpCircle : HelpCircle;

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onClose}
    >
      <View className="flex-1 bg-black/70 justify-center items-center px-5">
        <Animated.View
          entering={FadeInDown.duration(300)}
          exiting={webSafeExit(FadeOut.duration(200))}
          className="w-full max-w-md"
        >
          <View className="bg-slate-900 rounded-3xl overflow-hidden border border-slate-700/50">
            {/* Header */}
            <LinearGradient
              colors={["#1e3a5f", "#0f172a"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ paddingVertical: 20, paddingHorizontal: 20 }}
            >
              <View className="flex-row items-center justify-between mb-2">
                <View className="flex-row items-center">
                  <HelpCircle size={20} color="#f59e0b" />
                  <Text className="text-amber-400 text-xs font-semibold ml-2 uppercase tracking-wider">
                    Tutorial
                  </Text>
                </View>
                <Pressable
                  onPress={onClose}
                  className="w-8 h-8 rounded-full bg-slate-800/60 items-center justify-center active:opacity-70"
                >
                  <X size={16} color="#94a3b8" />
                </Pressable>
              </View>
              <Text className="text-white text-xl font-bold">
                {tutorial.title}
              </Text>
            </LinearGradient>

            {/* Step Content */}
            <View className="p-5">
              {/* Step Icon or Image */}
              <View className="items-center mb-5">
                {step.image ? (
                  <View className="w-full rounded-2xl overflow-hidden mb-3 bg-slate-800">
                    <Image
                      source={{ uri: step.image }}
                      style={{ width: '100%', height: 180 }}
                      resizeMode="contain"
                    />
                  </View>
                ) : (
                  <View className="w-16 h-16 rounded-2xl bg-amber-500/20 items-center justify-center mb-3">
                    <IconComponent size={32} color="#f59e0b" />
                  </View>
                )}
                <View className="flex-row items-center">
                  {tutorial.steps.map((_, index) => (
                    <View
                      key={index}
                      className={`w-2 h-2 rounded-full mx-1 ${
                        index === currentStep
                          ? "bg-amber-500"
                          : index < currentStep
                            ? "bg-amber-500/50"
                            : "bg-slate-600"
                      }`}
                    />
                  ))}
                </View>
              </View>

              {/* Step Text */}
              <Animated.View
                key={currentStep}
                entering={SlideInRight.duration(200)}
              >
                <Text className="text-white text-lg font-semibold text-center mb-3">
                  {step.title}
                </Text>
                <Text className="text-slate-400 text-center leading-6">
                  {step.description}
                </Text>
              </Animated.View>

              {/* Step Counter */}
              <Text className="text-slate-500 text-xs text-center mt-4">
                Step {currentStep + 1} of {tutorial.steps.length}
              </Text>
            </View>

            {/* Navigation Buttons */}
            <View className="px-5 pb-5">
              <View className="flex-row gap-3">
                {currentStep > 0 && (
                  <Pressable
                    onPress={handleBack}
                    className="flex-1 py-3 rounded-xl bg-slate-800 border border-slate-700/50 flex-row items-center justify-center active:opacity-70"
                  >
                    <ChevronLeft size={18} color="#94a3b8" />
                    <Text className="text-slate-300 font-semibold ml-1">
                      Back
                    </Text>
                  </Pressable>
                )}

                <Pressable
                  onPress={handleNext}
                  className={`${currentStep > 0 ? "flex-1" : "flex-1"} py-3 rounded-xl bg-amber-500 flex-row items-center justify-center active:opacity-80`}
                >
                  <Text className="text-slate-900 font-bold">
                    {isLastStep ? "Got it!" : "Next"}
                  </Text>
                  {isLastStep ? (
                    <Check size={18} color="#0f172a" style={{ marginLeft: 4 }} />
                  ) : (
                    <ChevronRight size={18} color="#0f172a" style={{ marginLeft: 4 }} />
                  )}
                </Pressable>
              </View>

              {/* Skip / Don't Show Again */}
              <View className="flex-row justify-center mt-4">
                {!isLastStep && (
                  <Pressable onPress={handleSkip} className="px-4 py-2 active:opacity-70">
                    <Text className="text-slate-500 text-sm">Skip tutorial</Text>
                  </Pressable>
                )}
                {currentStep === 0 && (
                  <Pressable onPress={handleDontShowAgain} className="px-4 py-2 active:opacity-70">
                    <Text className="text-slate-500 text-sm">Don't show again</Text>
                  </Pressable>
                )}
              </View>
            </View>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

/**
 * Help Button Component
 *
 * Small help button that opens the tutorial modal.
 * Use at the top of screens to allow users to re-access tutorials.
 */

interface HelpButtonProps {
  tutorialId: TutorialId;
  size?: "small" | "medium";
  className?: string;
}

export function HelpButton({
  tutorialId,
  size = "small",
  className = "",
}: HelpButtonProps) {
  const [showTutorial, setShowTutorial] = useState(false);

  const handlePress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setShowTutorial(true);
  }, []);

  const iconSize = size === "small" ? 16 : 20;
  const buttonSize = size === "small" ? "w-8 h-8" : "w-10 h-10";

  return (
    <>
      <Pressable
        onPress={handlePress}
        className={`${buttonSize} rounded-full bg-slate-800/60 border border-slate-700/50 items-center justify-center active:opacity-70 ${className}`}
      >
        <HelpCircle size={iconSize} color="#f59e0b" />
      </Pressable>

      <TutorialModal
        tutorialId={tutorialId}
        visible={showTutorial}
        onClose={() => setShowTutorial(false)}
      />
    </>
  );
}

/**
 * Auto Tutorial Hook
 *
 * Opens tutorial automatically on first visit to a screen.
 */
export function useAutoTutorial(tutorialId: TutorialId) {
  const [showTutorial, setShowTutorial] = useState(false);
  const hasSeen = useHasSeenTutorial(tutorialId);
  const tutorialsEnabled = useTutorialStore((s) => s.tutorialsEnabled);

  useEffect(() => {
    // Show tutorial on first visit if enabled and not seen
    if (tutorialsEnabled && !hasSeen) {
      // Small delay to let screen render first
      const timer = setTimeout(() => {
        setShowTutorial(true);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [tutorialsEnabled, hasSeen]);

  const closeTutorial = useCallback(() => {
    setShowTutorial(false);
  }, []);

  const openTutorial = useCallback(() => {
    setShowTutorial(true);
  }, []);

  return {
    showTutorial,
    closeTutorial,
    openTutorial,
    TutorialModalComponent: (
      <TutorialModal
        tutorialId={tutorialId}
        visible={showTutorial}
        onClose={closeTutorial}
      />
    ),
  };
}
