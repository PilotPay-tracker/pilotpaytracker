/**
 * SmartImportModal - Intelligent Schedule Import
 * Premium glass aesthetic with smart detection
 */

import { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  Pressable,
  Image,
  Modal,
  ScrollView,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import {
  X,
  Camera,
  Image as ImageIcon,
  Upload,
  Plus,
  CheckCircle2,
  AlertTriangle,
  Scan,
  Trash2,
  Sparkles,
  FileText,
  Plane,
  Clock,
} from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { webSafeExit } from '@/lib/webSafeAnimation';
import Animated, {
  FadeIn,
  FadeOut,
  SlideInUp,
  SlideInRight,
  Layout,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withRepeat,
  withTiming,
  withSequence,
  Easing,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { cn } from '@/lib/cn';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export interface SelectedImage {
  uri: string;
  base64: string;
  mimeType: string;
}

export type ScheduleSourceType = 'crew_access' | 'trip_board' | 'bid_award' | 'auto';

interface SmartImportModalProps {
  visible: boolean;
  onClose: () => void;
  onImport: (
    images: SelectedImage[],
    sourceType: ScheduleSourceType,
    onProgress?: (progress: number, step: string) => void
  ) => Promise<void>;
}

const SOURCE_CONFIGS = [
  {
    value: 'auto' as const,
    label: 'Auto Detect',
    description: 'AI identifies format',
    icon: Sparkles,
    gradient: ['#06b6d4', '#3b82f6'] as const,
  },
  {
    value: 'crew_access' as const,
    label: 'Crew Access (Primary)',
    description: 'Official published schedule',
    icon: FileText,
    gradient: ['#10b981', '#059669'] as const,
  },
  {
    value: 'trip_board' as const,
    label: 'Trip Board (Secondary)',
    description: 'Leg-by-leg detail',
    icon: Plane,
    gradient: ['#f59e0b', '#d97706'] as const,
  },
  {
    value: 'bid_award' as const,
    label: 'Bid Award Technique',
    description: 'Trip Board Browser (early)',
    icon: Clock,
    gradient: ['#8b5cf6', '#7c3aed'] as const,
  },
];

function PulsingDot() {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(0.8);

  // Start animation
  scale.value = withRepeat(
    withSequence(
      withTiming(1.5, { duration: 800, easing: Easing.inOut(Easing.ease) }),
      withTiming(1, { duration: 800, easing: Easing.inOut(Easing.ease) })
    ),
    -1,
    false
  );
  opacity.value = withRepeat(
    withSequence(
      withTiming(0.4, { duration: 800, easing: Easing.inOut(Easing.ease) }),
      withTiming(0.8, { duration: 800, easing: Easing.inOut(Easing.ease) })
    ),
    -1,
    false
  );

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      style={[animatedStyle, { width: 8, height: 8, borderRadius: 4, backgroundColor: '#06b6d4' }]}
    />
  );
}

// Full-width scanning line that sweeps across the progress bar
function ProgressScanLine({ progress }: { progress: number }) {
  const translateX = useSharedValue(0);
  const opacity = useSharedValue(1);

  useEffect(() => {
    // Calculate the sweep width based on progress (0-100%)
    // The line should only sweep within the completed portion
    const sweepWidth = Math.max(20, progress * 3); // At least 20px, scales with progress

    translateX.value = withRepeat(
      withSequence(
        withTiming(-20, { duration: 0 }),
        withTiming(sweepWidth, { duration: 1500, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      false
    );

    // Pulse opacity
    opacity.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 750, easing: Easing.inOut(Easing.ease) }),
        withTiming(0.5, { duration: 750, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      false
    );
  }, [progress, translateX, opacity]);

  const lineStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      style={[
        lineStyle,
        {
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 40,
          borderRadius: 999,
        },
      ]}
    >
      <LinearGradient
        colors={['transparent', '#06b6d4', '#3b82f6', 'transparent']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={{ flex: 1, borderRadius: 999 }}
      />
    </Animated.View>
  );
}

function ScanningAnimation() {
  const translateY = useSharedValue(0);

  translateY.value = withRepeat(
    withTiming(200, { duration: 2000, easing: Easing.inOut(Easing.ease) }),
    -1,
    true
  );

  const lineStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View
      style={[
        lineStyle,
        {
          position: 'absolute',
          left: 0,
          right: 0,
          height: 2,
          backgroundColor: '#06b6d4',
          shadowColor: '#06b6d4',
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.8,
          shadowRadius: 10,
        },
      ]}
    />
  );
}

export function SmartImportModal({ visible, onClose, onImport }: SmartImportModalProps) {
  const insets = useSafeAreaInsets();
  const [selectedImages, setSelectedImages] = useState<SelectedImage[]>([]);
  const [sourceType, setSourceType] = useState<ScheduleSourceType>('auto');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  // Track if user minimized during upload
  const [isMinimized, setIsMinimized] = useState(false);

  const handlePickImages = useCallback(async () => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setError(null);

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: 6 - selectedImages.length,
        quality: 0.9,
        base64: true,
      });

      if (result.canceled || result.assets.length === 0) return;

      const newImages: SelectedImage[] = result.assets
        .filter(asset => asset.base64)
        .map(asset => ({
          uri: asset.uri,
          base64: asset.base64!,
          mimeType: asset.mimeType || 'image/jpeg',
        }));

      setSelectedImages(prev => [...prev, ...newImages].slice(0, 6));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      console.log('Image picker error:', err);
      setError('Failed to select images');
    }
  }, [selectedImages.length]);

  const handleTakePhoto = useCallback(async () => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setError(null);

      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        setError('Camera permission required');
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        quality: 0.9,
        base64: true,
      });

      if (result.canceled || !result.assets[0]?.base64) return;

      const newImage: SelectedImage = {
        uri: result.assets[0].uri,
        base64: result.assets[0].base64,
        mimeType: result.assets[0].mimeType || 'image/jpeg',
      };

      setSelectedImages(prev => [...prev, newImage].slice(0, 6));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      console.log('Camera error:', err);
      setError('Failed to capture photo');
    }
  }, []);

  const handleRemoveImage = useCallback((index: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedImages(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleImport = useCallback(async () => {
    if (selectedImages.length === 0) return;

    setIsUploading(true);
    setError(null);
    setUploadProgress(0);
    setCurrentStep('Preparing upload...');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // Capture current images and source type to prevent state issues
    const imagesToImport = [...selectedImages];
    const sourceToUse = sourceType;

    try {
      // Track whether we've already closed the modal (to hand off to background overlay)
      let modalClosed = false;

      // Progress callback for real-time updates
      const handleProgress = (progress: number, step: string) => {
        if (modalClosed) return; // Don't update state after modal is closed
        setUploadProgress(progress);
        setCurrentStep(step);

        // Once upload is done and parsing begins (~30%), close the modal early.
        // The ImportProgressOverlay on the trips screen takes over from here.
        // This prevents the modal from blocking the screen during the long OCR/parse phase.
        if (progress >= 30 && !modalClosed) {
          modalClosed = true;
          setSelectedImages([]);
          setSourceType('auto');
          setUploadProgress(0);
          setCurrentStep('');
          setIsUploading(false);
          setError(null);
          setIsMinimized(false);
          onClose();
        }
      };

      await onImport(imagesToImport, sourceToUse, handleProgress);

      // If modal wasn't already closed during progress (e.g. very fast import), close it now
      if (!modalClosed) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setSelectedImages([]);
        setSourceType('auto');
        setUploadProgress(0);
        setCurrentStep('');
        setIsUploading(false);
        setError(null);
        setIsMinimized(false);
        onClose();
      }
    } catch (err) {
      console.error('Import error:', err);
      setError(err instanceof Error ? err.message : 'Import failed');
      setIsUploading(false);
      setUploadProgress(0);
      setCurrentStep('');
      setIsMinimized(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }, [selectedImages, sourceType, onImport, onClose]);

  const handleClose = () => {
    // Allow closing during upload - it continues in background
    if (isUploading) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setIsMinimized(true);
      onClose();
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedImages([]);
    setSourceType('auto');
    setError(null);
    setIsMinimized(false);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <View className="flex-1 bg-black/80">
        <Animated.View
          entering={SlideInUp.duration(400).springify()}
          className="flex-1 mt-12 rounded-t-3xl overflow-hidden"
        >
          {/* Background with subtle gradient */}
          <LinearGradient
            colors={['#0f172a', '#020617']}
            style={{ flex: 1 }}
          >
            {/* Header */}
            <View
              className="flex-row items-center justify-between px-5 py-4 border-b border-slate-800/50"
              style={{ paddingTop: insets.top > 12 ? 12 : insets.top }}
            >
              <View className="flex-row items-center">
                <View className="w-11 h-11 rounded-xl bg-cyan-500/20 items-center justify-center">
                  <Scan size={22} color="#06b6d4" />
                </View>
                <View className="ml-3">
                  <Text
                    className="text-white text-lg font-bold"
                    style={{ fontFamily: 'DMSans_700Bold' }}
                  >
                    {isUploading ? 'Importing...' : 'Import Schedule'}
                  </Text>
                  <Text className="text-slate-500 text-xs">
                    {isUploading ? 'Tap X to continue browsing' : 'Upload screenshots to extract trips'}
                  </Text>
                </View>
              </View>
              <Pressable
                onPress={handleClose}
                className="w-10 h-10 rounded-full bg-slate-800/80 items-center justify-center active:opacity-70"
              >
                <X size={20} color="#64748b" />
              </Pressable>
            </View>

            <ScrollView
              className="flex-1"
              contentContainerStyle={{ padding: 20, paddingBottom: 120 }}
              showsVerticalScrollIndicator={false}
            >
              {/* Source Type Selector */}
              <Text className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-3">
                Detection Mode
              </Text>
              <View className="flex-row mb-6">
                {SOURCE_CONFIGS.map((source, idx) => {
                  const Icon = source.icon;
                  const isSelected = sourceType === source.value;

                  return (
                    <Pressable
                      key={source.value}
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setSourceType(source.value);
                      }}
                      className={cn(
                        'flex-1 p-3 rounded-xl border overflow-hidden',
                        idx < 2 ? 'mr-2' : '',
                        isSelected ? 'border-cyan-500/50' : 'border-slate-700/50'
                      )}
                      style={{
                        backgroundColor: isSelected ? 'rgba(6, 182, 212, 0.1)' : 'rgba(30, 41, 59, 0.5)',
                      }}
                    >
                      <View className="flex-row items-center mb-1">
                        <Icon size={16} color={isSelected ? '#06b6d4' : '#64748b'} />
                        {isSelected && (
                          <Animated.View entering={FadeIn.duration(200)} className="ml-auto">
                            <CheckCircle2 size={14} color="#06b6d4" />
                          </Animated.View>
                        )}
                      </View>
                      <Text
                        className={cn(
                          'text-sm font-semibold',
                          isSelected ? 'text-cyan-400' : 'text-slate-300'
                        )}
                      >
                        {source.label}
                      </Text>
                      <Text className="text-slate-500 text-[10px] mt-0.5">{source.description}</Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* Image Selection Area */}
              <Text className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-3">
                Screenshots ({selectedImages.length}/6)
              </Text>

              {selectedImages.length > 0 ? (
                <View className="flex-row flex-wrap mb-4">
                  {selectedImages.map((img, index) => (
                    <Animated.View
                      key={img.uri}
                      entering={FadeIn.duration(200)}
                      exiting={webSafeExit(FadeOut.duration(200))}
                      layout={Layout.springify()}
                      className="w-1/3 p-1"
                    >
                      <View className="relative aspect-[3/4] rounded-xl overflow-hidden bg-slate-800">
                        <Image
                          source={{ uri: img.uri }}
                          className="w-full h-full"
                          resizeMode="cover"
                        />

                        {/* Scanning overlay when uploading */}
                        {isUploading && (
                          <View className="absolute inset-0 bg-slate-900/60 overflow-hidden">
                            <ScanningAnimation />
                          </View>
                        )}

                        {/* Remove button */}
                        {!isUploading && (
                          <Pressable
                            onPress={() => handleRemoveImage(index)}
                            className="absolute top-2 right-2 w-7 h-7 rounded-full bg-red-500/90 items-center justify-center"
                          >
                            <Trash2 size={14} color="white" />
                          </Pressable>
                        )}

                        {/* Index badge */}
                        <View className="absolute bottom-2 left-2 bg-black/70 px-2 py-1 rounded">
                          <Text
                            className="text-white text-[10px] font-mono"
                            style={{ fontFamily: 'JetBrainsMono_400Regular' }}
                          >
                            {index + 1}
                          </Text>
                        </View>
                      </View>
                    </Animated.View>
                  ))}

                  {selectedImages.length < 6 && !isUploading && (
                    <Animated.View entering={FadeIn.duration(200)} className="w-1/3 p-1">
                      <Pressable
                        onPress={handlePickImages}
                        className="aspect-[3/4] rounded-xl border-2 border-dashed border-slate-700 items-center justify-center bg-slate-800/30"
                      >
                        <Plus size={28} color="#475569" />
                        <Text className="text-slate-500 text-xs mt-2">Add More</Text>
                      </Pressable>
                    </Animated.View>
                  )}
                </View>
              ) : (
                <Pressable
                  onPress={handlePickImages}
                  className="bg-slate-800/40 rounded-2xl p-10 items-center mb-4 border border-slate-700/30 border-dashed"
                >
                  <View className="w-20 h-20 rounded-2xl bg-cyan-500/10 items-center justify-center mb-4">
                    <Scan size={40} color="#06b6d4" />
                  </View>
                  <Text
                    className="text-white font-semibold text-lg text-center"
                    style={{ fontFamily: 'DMSans_600SemiBold' }}
                  >
                    Tap to Select Screenshots
                  </Text>
                  <Text className="text-slate-500 text-center text-sm mt-2">
                    Crew Access, Trip Board, or any schedule view
                  </Text>
                </Pressable>
              )}

              {/* Quick Actions */}
              {!isUploading && selectedImages.length < 6 && (
                <View className="flex-row gap-3 mb-6">
                  <Pressable
                    onPress={handlePickImages}
                    className="flex-1 flex-row items-center justify-center py-4 rounded-xl bg-slate-800/60 active:opacity-70"
                  >
                    <ImageIcon size={20} color="#94a3b8" />
                    <Text className="text-slate-300 font-semibold ml-2">Gallery</Text>
                  </Pressable>
                  <Pressable
                    onPress={handleTakePhoto}
                    className="flex-1 flex-row items-center justify-center py-4 rounded-xl bg-slate-800/60 active:opacity-70"
                  >
                    <Camera size={20} color="#94a3b8" />
                    <Text className="text-slate-300 font-semibold ml-2">Camera</Text>
                  </Pressable>
                </View>
              )}

              {/* Error Display */}
              {error && (
                <Animated.View
                  entering={FadeIn.duration(200)}
                  className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-4"
                >
                  <View className="flex-row items-center">
                    <AlertTriangle size={18} color="#ef4444" />
                    <Text className="text-red-400 font-medium ml-2 flex-1">{error}</Text>
                  </View>
                </Animated.View>
              )}

              {/* What Gets Extracted */}
              <View className="bg-slate-800/30 rounded-2xl p-5 border border-slate-700/30">
                <View className="flex-row items-center mb-4">
                  <Sparkles size={16} color="#06b6d4" />
                  <Text className="text-white font-semibold ml-2">AI Extracts</Text>
                </View>

                <View className="flex-row flex-wrap">
                  {[
                    'Flight Numbers',
                    'Origin/Destination',
                    'Block Time',
                    'Credit Hours',
                    'Duty Days',
                    'Layovers',
                    'Hotels',
                    'Equipment',
                  ].map((item, idx) => (
                    <View
                      key={item}
                      className="bg-slate-700/40 px-3 py-1.5 rounded-full mr-2 mb-2"
                    >
                      <Text className="text-slate-300 text-xs">{item}</Text>
                    </View>
                  ))}
                </View>
              </View>
            </ScrollView>

            {/* Bottom Action Bar */}
            <View
              className="absolute bottom-0 left-0 right-0 px-5 pt-4 border-t border-slate-800/50"
              style={{
                paddingBottom: insets.bottom + 16,
                backgroundColor: 'rgba(15, 23, 42, 0.95)',
              }}
            >
              {isUploading ? (
                <View>
                  {/* Progress Bar with scanning animation */}
                  <View className="flex-row items-center mb-3">
                    <PulsingDot />
                    <Text className="text-cyan-400 text-sm font-medium ml-2 flex-1" numberOfLines={1}>
                      {currentStep || 'Processing...'}
                    </Text>
                    <Text className="text-slate-500 text-sm ml-2">{uploadProgress}%</Text>
                  </View>
                  <View className="h-3 bg-slate-800 rounded-full overflow-hidden relative">
                    {/* Progress fill */}
                    <Animated.View
                      style={{
                        width: `${uploadProgress}%`,
                        height: '100%',
                        borderRadius: 999,
                      }}
                    >
                      <LinearGradient
                        colors={['#06b6d4', '#3b82f6']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                        style={{ flex: 1 }}
                      />
                    </Animated.View>
                    {/* Scanning line animation */}
                    <ProgressScanLine progress={uploadProgress} />
                  </View>
                  {/* Minimize button - let user browse app while importing */}
                  <Pressable
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setIsMinimized(true);
                      onClose();
                    }}
                    className="mt-4 py-3 rounded-xl bg-slate-800/80 items-center active:opacity-70"
                  >
                    <Text className="text-slate-300 font-medium">Continue Browsing</Text>
                    <Text className="text-slate-500 text-xs mt-0.5">Import continues in background</Text>
                  </Pressable>
                </View>
              ) : (
                <Pressable
                  onPress={handleImport}
                  disabled={selectedImages.length === 0}
                  className={cn(
                    'flex-row items-center justify-center py-4 rounded-xl overflow-hidden',
                    selectedImages.length === 0 ? 'bg-slate-800/60' : ''
                  )}
                >
                  {selectedImages.length > 0 ? (
                    <LinearGradient
                      colors={['#06b6d4', '#0891b2']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={{
                        position: 'absolute',
                        left: 0,
                        right: 0,
                        top: 0,
                        bottom: 0,
                      }}
                    />
                  ) : null}
                  <Upload size={20} color={selectedImages.length === 0 ? '#64748b' : '#ffffff'} />
                  <Text
                    className={cn(
                      'font-bold text-base ml-2',
                      selectedImages.length === 0 ? 'text-slate-500' : 'text-white'
                    )}
                    style={{ fontFamily: 'DMSans_700Bold' }}
                  >
                    {selectedImages.length === 0
                      ? 'Select Images to Import'
                      : `Import ${selectedImages.length} Screenshot${selectedImages.length !== 1 ? 's' : ''}`}
                  </Text>
                </Pressable>
              )}
            </View>
          </LinearGradient>
        </Animated.View>
      </View>
    </Modal>
  );
}
