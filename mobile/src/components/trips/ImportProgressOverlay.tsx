/**
 * ImportProgressOverlay - Multi-File Import Progress Tracker
 *
 * Shows real-time progress during multi-file schedule imports:
 * - Overall progress bar
 * - Current file being processed
 * - Per-file status (pending, processing, done, error)
 * - Ability to minimize to continue using app
 *
 * Premium UX that keeps users informed and confident.
 */

import { useState, useEffect, useCallback } from 'react';
import { View, Text, Pressable, Dimensions } from 'react-native';
import {
  CheckCircle2,
  AlertTriangle,
  Loader2,
  X,
  ChevronDown,
  ChevronUp,
  FileImage,
  Scan,
} from 'lucide-react-native';
import Animated, {
  FadeIn,
  FadeOut,
  SlideInUp,
  SlideInDown,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { webSafeExit } from '@/lib/webSafeAnimation';
import { cn } from '@/lib/cn';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export interface ImportFileStatus {
  id: string;
  name: string;
  status: 'pending' | 'uploading' | 'parsing' | 'done' | 'error';
  progress: number; // 0-100
  errorMessage?: string;
  tripsFound?: number;
}

export interface ImportQueueState {
  isActive: boolean;
  totalFiles: number;
  processedFiles: number;
  currentFileIndex: number;
  files: ImportFileStatus[];
  overallProgress: number; // 0-100
}

interface ImportProgressOverlayProps {
  queue: ImportQueueState;
  onCancel?: () => void;
  onDismiss?: () => void;
}

// Spinning loader animation
function SpinningLoader({ size = 18, color = '#06b6d4' }: { size?: number; color?: string }) {
  const rotation = useSharedValue(0);

  useEffect(() => {
    rotation.value = withRepeat(
      withTiming(360, { duration: 1000, easing: Easing.linear }),
      -1,
      false
    );
  }, [rotation]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  return (
    <Animated.View style={animatedStyle}>
      <Loader2 size={size} color={color} />
    </Animated.View>
  );
}

// Pulsing scan animation
function PulsingScan() {
  const opacity = useSharedValue(0.5);

  useEffect(() => {
    opacity.value = withRepeat(
      withTiming(1, { duration: 800, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
  }, [opacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return (
    <Animated.View style={animatedStyle}>
      <Scan size={20} color="#06b6d4" />
    </Animated.View>
  );
}

// Status icon component
function StatusIcon({ status }: { status: ImportFileStatus['status'] }) {
  switch (status) {
    case 'done':
      return <CheckCircle2 size={16} color="#10b981" />;
    case 'error':
      return <AlertTriangle size={16} color="#ef4444" />;
    case 'uploading':
    case 'parsing':
      return <SpinningLoader size={16} />;
    default:
      return <FileImage size={16} color="#64748b" />;
  }
}

export function ImportProgressOverlay({
  queue,
  onCancel,
  onDismiss,
}: ImportProgressOverlayProps) {
  const insets = useSafeAreaInsets();
  const [isMinimized, setIsMinimized] = useState(false);

  const currentFile = queue.files[queue.currentFileIndex];
  const isComplete = queue.processedFiles === queue.totalFiles;
  const hasErrors = queue.files.some(f => f.status === 'error');

  // Auto-dismiss after completion
  useEffect(() => {
    if (isComplete && !hasErrors) {
      const timer = setTimeout(() => {
        onDismiss?.();
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [isComplete, hasErrors, onDismiss]);

  const handleToggleMinimize = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIsMinimized(prev => !prev);
  }, []);

  if (!queue.isActive) return null;

  // Minimized view - just a small progress indicator
  if (isMinimized) {
    return (
      <Animated.View
        entering={SlideInDown.springify()}
        exiting={webSafeExit(FadeOut)}
        style={{ position: 'absolute', top: insets.top + 60, right: 16 }}
      >
        <Pressable
          onPress={handleToggleMinimize}
          className="flex-row items-center bg-slate-800/95 rounded-full px-4 py-2 border border-cyan-500/30"
        >
          <PulsingScan />
          <Text className="text-white text-sm font-medium ml-2">
            {queue.processedFiles}/{queue.totalFiles}
          </Text>
          <View className="w-16 h-1.5 bg-slate-700 rounded-full ml-3 overflow-hidden">
            <View
              className="h-full bg-cyan-500 rounded-full"
              style={{ width: `${queue.overallProgress}%` }}
            />
          </View>
          <ChevronUp size={16} color="#94a3b8" className="ml-2" />
        </Pressable>
      </Animated.View>
    );
  }

  // Full overlay view
  return (
    <Animated.View
      entering={SlideInUp.springify().damping(20)}
      exiting={FadeOut}
      className="absolute inset-x-0 top-0 bottom-0 bg-black/60"
      style={{ paddingTop: insets.top }}
    >
      <View className="flex-1 justify-center items-center px-6">
        <View className="w-full max-w-sm bg-slate-900 rounded-3xl overflow-hidden border border-slate-700/50">
          {/* Header */}
          <LinearGradient
            colors={['#1e293b', '#0f172a']}
            style={{ padding: 20 }}
          >
            <View className="flex-row items-center justify-between mb-4">
              <View className="flex-row items-center">
                <View className="w-10 h-10 rounded-xl bg-cyan-500/20 items-center justify-center">
                  <PulsingScan />
                </View>
                <View className="ml-3">
                  <Text className="text-white text-lg font-semibold">
                    {isComplete ? 'Import Complete' : 'Importing Schedule'}
                  </Text>
                  <Text className="text-slate-400 text-xs">
                    {isComplete
                      ? `${queue.totalFiles} file${queue.totalFiles !== 1 ? 's' : ''} processed`
                      : `Processing file ${queue.currentFileIndex + 1} of ${queue.totalFiles}`}
                  </Text>
                </View>
              </View>

              <Pressable
                onPress={handleToggleMinimize}
                className="w-8 h-8 rounded-full bg-slate-800 items-center justify-center"
              >
                <ChevronDown size={18} color="#94a3b8" />
              </Pressable>
            </View>

            {/* Overall Progress Bar */}
            <View className="h-2 bg-slate-800 rounded-full overflow-hidden">
              <Animated.View
                style={{
                  width: `${queue.overallProgress}%`,
                  height: '100%',
                }}
              >
                <LinearGradient
                  colors={isComplete && !hasErrors ? ['#10b981', '#059669'] : ['#06b6d4', '#0891b2']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={{ flex: 1, borderRadius: 999 }}
                />
              </Animated.View>
            </View>
            <Text className="text-slate-500 text-xs text-right mt-1">
              {queue.overallProgress}%
            </Text>
          </LinearGradient>

          {/* File List */}
          <View className="px-4 py-3 max-h-48">
            {queue.files.map((file, index) => (
              <Animated.View
                key={file.id}
                entering={FadeIn.delay(index * 50)}
                className={cn(
                  'flex-row items-center py-2.5',
                  index < queue.files.length - 1 && 'border-b border-slate-800/50'
                )}
              >
                <StatusIcon status={file.status} />
                <View className="flex-1 ml-3">
                  <Text
                    className={cn(
                      'text-sm',
                      file.status === 'done'
                        ? 'text-emerald-400'
                        : file.status === 'error'
                        ? 'text-red-400'
                        : file.status === 'uploading' || file.status === 'parsing'
                        ? 'text-cyan-400'
                        : 'text-slate-400'
                    )}
                    numberOfLines={1}
                  >
                    {file.name}
                  </Text>
                  {file.status === 'done' && file.tripsFound !== undefined && (
                    <Text className="text-slate-500 text-xs">
                      {file.tripsFound} trip{file.tripsFound !== 1 ? 's' : ''} found
                    </Text>
                  )}
                  {file.status === 'error' && file.errorMessage && (
                    <Text className="text-red-400/70 text-xs" numberOfLines={1}>
                      {file.errorMessage}
                    </Text>
                  )}
                  {(file.status === 'uploading' || file.status === 'parsing') && (
                    <View className="h-1 bg-slate-800 rounded-full mt-1 overflow-hidden">
                      <View
                        className="h-full bg-cyan-500 rounded-full"
                        style={{ width: `${file.progress}%` }}
                      />
                    </View>
                  )}
                </View>
              </Animated.View>
            ))}
          </View>

          {/* Actions */}
          <View className="px-4 py-4 border-t border-slate-800/50">
            {isComplete ? (
              <Pressable
                onPress={onDismiss}
                className="bg-white rounded-xl py-3.5 items-center active:opacity-80"
              >
                <Text className="text-slate-900 font-semibold text-base">Done</Text>
              </Pressable>
            ) : (
              <View className="flex-row gap-3">
                <Pressable
                  onPress={handleToggleMinimize}
                  className="flex-1 bg-slate-800 rounded-xl py-3.5 items-center active:opacity-80"
                >
                  <Text className="text-slate-300 font-semibold">Minimize</Text>
                </Pressable>
                {onCancel && (
                  <Pressable
                    onPress={onCancel}
                    className="flex-1 bg-red-500/20 border border-red-500/30 rounded-xl py-3.5 items-center active:opacity-80"
                  >
                    <Text className="text-red-400 font-semibold">Cancel</Text>
                  </Pressable>
                )}
              </View>
            )}
          </View>
        </View>
      </View>
    </Animated.View>
  );
}

export default ImportProgressOverlay;
