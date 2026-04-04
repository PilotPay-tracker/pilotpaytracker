/**
 * OOOI Camera Capture Component
 * Capture ACARS photos and parse OOOI times via OCR
 */

import { View, Text, Pressable, Modal, Alert, ActivityIndicator, Image } from 'react-native';
import { X, Camera, Image as ImageIcon, Scan, RefreshCw, Check } from 'lucide-react-native';
import Animated, { FadeIn, SlideInDown, FadeInUp } from 'react-native-reanimated';
import { useState, useRef, useCallback } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { cn } from '@/lib/cn';
import { parseOOOIFromImage, type ExtendedParseResult } from '@/lib/oooi/visionParser';
import type { BackendLeg } from '@/lib/useTripsData';

interface OOOICaptureProps {
  leg: BackendLeg | null;
  visible: boolean;
  onClose: () => void;
  onParsed: (result: {
    outTime?: string;
    offTime?: string;
    onTime?: string;
    inTime?: string;
    blockTime?: string;
    flightTime?: string;
    imageUri?: string;
    confidence: number;
  }) => void;
}

export function OOOICapture({ leg, visible, onClose, onParsed }: OOOICaptureProps) {
  const insets = useSafeAreaInsets();
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();

  const [mode, setMode] = useState<'camera' | 'preview' | 'parsing'>('camera');
  const [capturedUri, setCapturedUri] = useState<string | null>(null);
  const [parseResult, setParseResult] = useState<ExtendedParseResult | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);

  // All hooks must be called before any early returns
  const handleCameraReady = useCallback(() => {
    console.log('[OOOICapture] Camera is ready');
    setIsCameraReady(true);
  }, []);

  const handleTakePhoto = useCallback(async () => {
    if (!cameraRef.current) {
      console.error('[OOOICapture] Camera ref is null');
      Alert.alert('Error', 'Camera not initialized. Please try again.');
      return;
    }

    if (!isCameraReady) {
      console.error('[OOOICapture] Camera not ready yet');
      Alert.alert('Please Wait', 'Camera is still initializing. Please wait a moment and try again.');
      return;
    }

    if (isCapturing) {
      console.log('[OOOICapture] Already capturing, ignoring...');
      return;
    }

    try {
      setIsCapturing(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      console.log('[OOOICapture] Taking photo...');

      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.85,
        base64: true, // Include base64 for parsing
      });

      console.log('[OOOICapture] Photo taken:', photo?.uri ? 'success' : 'no uri');

      if (photo?.uri) {
        setCapturedUri(photo.uri);
        setMode('preview');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        throw new Error('No photo URI returned from camera');
      }
    } catch (error) {
      console.error('[OOOICapture] Failed to take photo:', error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(
        'Capture Failed',
        error instanceof Error ? error.message : 'Failed to capture photo. Please try again.',
        [{ text: 'OK' }]
      );
    } finally {
      setIsCapturing(false);
    }
  }, [isCameraReady, isCapturing]);

  const handleReset = useCallback(() => {
    setCapturedUri(null);
    setParseResult(null);
    setMode('camera');
    setIsCameraReady(false);
  }, []);

  const handleClose = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    handleReset();
    onClose();
  }, [handleReset, onClose]);

  // Log when component receives props
  console.log('[OOOICapture] Rendered - visible:', visible, 'leg:', leg?.id);

  // Early return AFTER all hooks
  if (!leg) return null;

  const handleRequestPermission = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await requestPermission();
  };

  const handlePickImage = async () => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 0.9,
      });

      if (!result.canceled && result.assets[0]?.uri) {
        setCapturedUri(result.assets[0].uri);
        setMode('preview');
      }
    } catch (error) {
      console.error('Failed to pick image:', error);
      Alert.alert('Error', 'Failed to select image');
    }
  };

  const handleParse = async () => {
    if (!capturedUri) return;

    setIsParsing(true);
    setMode('parsing');

    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const result = await parseOOOIFromImage(capturedUri);
      setParseResult(result);

      if (result.success) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      }
    } catch (error) {
      console.error('Failed to parse:', error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setParseResult({
        success: false,
        method: 'manual',
        confidence: 0,
        error: 'Failed to parse image',
      });
    } finally {
      setIsParsing(false);
    }
  };

  const handleUseResult = () => {
    if (!parseResult) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // Call onParsed with the result - the parent component will handle closing
    // and saving. We reset our local state but don't call onClose() here
    // to avoid race conditions with async save operations.
    onParsed({
      outTime: parseResult.outTime,
      offTime: parseResult.offTime,
      onTime: parseResult.onTime,
      inTime: parseResult.inTime,
      blockTime: parseResult.blockTime,
      flightTime: parseResult.flightTime,
      imageUri: capturedUri ?? undefined,
      confidence: parseResult.confidence,
    });

    // Reset local component state
    handleReset();
    // Note: Don't call onClose() here - parent's handleOOOIParsed will handle closing
  };

  // No permission state
  if (!permission?.granted) {
    return (
      <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
        <View className="flex-1 bg-black/90 justify-center items-center px-8">
          <Animated.View entering={FadeIn.duration(300)} className="items-center">
            <View className="w-20 h-20 rounded-full bg-slate-800 items-center justify-center mb-6">
              <Camera size={40} color="#64748b" />
            </View>
            <Text className="text-white text-xl font-bold text-center mb-2">
              Camera Access Required
            </Text>
            <Text className="text-slate-400 text-center mb-6">
              To scan ACARS photos, we need access to your camera
            </Text>
            <Pressable
              onPress={handleRequestPermission}
              className="bg-amber-500 px-8 py-4 rounded-xl active:opacity-90"
            >
              <Text className="text-black font-bold text-base">Enable Camera</Text>
            </Pressable>
            <Pressable onPress={handleClose} className="mt-4 p-3">
              <Text className="text-slate-400">Cancel</Text>
            </Pressable>
          </Animated.View>
        </View>
      </Modal>
    );
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 bg-black">
        {/* Header */}
        <View
          className="absolute top-0 left-0 right-0 z-10 flex-row items-center justify-between px-5 bg-black/50"
          style={{ paddingTop: insets.top + 8, paddingBottom: 12 }}
        >
          <View className="flex-1">
            <Text className="text-white font-bold text-lg">Scan OOOI</Text>
            <Text className="text-slate-400 text-sm">
              {leg.flightNumber || '----'} · {leg.origin} → {leg.destination}
            </Text>
          </View>
          <Pressable
            onPress={handleClose}
            className="w-10 h-10 rounded-full bg-slate-800/80 items-center justify-center"
          >
            <X size={20} color="#fff" />
          </Pressable>
        </View>

        {/* Camera Mode */}
        {mode === 'camera' && (
          <View className="flex-1">
            <CameraView
              ref={cameraRef}
              style={{ flex: 1 }}
              facing="back"
              onCameraReady={handleCameraReady}
            />

            {/* Guide Overlay - positioned absolutely over the camera */}
            <View
              className="absolute top-0 left-0 right-0 bottom-0 items-center justify-center px-8"
              pointerEvents="none"
            >
              <View className="w-full aspect-[4/3] border-2 border-white/30 rounded-2xl items-center justify-center p-4">
                <Text className="text-white/80 text-center text-base font-medium mb-2">
                  Position ACARS display here
                </Text>
                <Text className="text-white/50 text-center text-xs">
                  Get close so text fills the frame{'\n'}
                  Reduce glare if possible
                </Text>
              </View>
            </View>

            {/* Bottom Controls */}
            <View
              className="absolute bottom-0 left-0 right-0 bg-black/50"
              style={{ paddingBottom: insets.bottom + 16 }}
            >
              <View className="flex-row items-center justify-around py-4">
                {/* Gallery Button */}
                <Pressable
                  onPress={handlePickImage}
                  className="w-14 h-14 rounded-full bg-slate-800 items-center justify-center active:opacity-80"
                >
                  <ImageIcon size={24} color="#fff" />
                </Pressable>

                {/* Capture Button */}
                <Pressable
                  onPress={handleTakePhoto}
                  disabled={isCapturing || !isCameraReady}
                  className={cn(
                    "w-20 h-20 rounded-full items-center justify-center",
                    isCameraReady ? "bg-white active:opacity-80" : "bg-white/50"
                  )}
                >
                  {isCapturing ? (
                    <ActivityIndicator size="large" color="#000" />
                  ) : (
                    <View className={cn(
                      "w-16 h-16 rounded-full border-4",
                      isCameraReady ? "border-black" : "border-gray-400"
                    )} />
                  )}
                </Pressable>

                {/* Spacer */}
                <View className="w-14 h-14" />
              </View>

              {/* Camera Status */}
              {!isCameraReady && (
                <Text className="text-white/60 text-center text-xs pb-2">
                  Initializing camera...
                </Text>
              )}
            </View>
          </View>
        )}

        {/* Preview Mode */}
        {mode === 'preview' && capturedUri && (
          <View className="flex-1">
            <Image source={{ uri: capturedUri }} className="flex-1" resizeMode="contain" />

            {/* Bottom Controls */}
            <View
              className="absolute bottom-0 left-0 right-0 bg-black/80 p-5"
              style={{ paddingBottom: insets.bottom + 16 }}
            >
              <Text className="text-white text-center font-medium mb-4">
                Ready to parse OOOI times?
              </Text>

              <View className="flex-row items-center justify-between">
                <Pressable
                  onPress={handleReset}
                  className="flex-1 bg-slate-800 py-4 rounded-xl items-center mr-2 active:opacity-80"
                >
                  <RefreshCw size={20} color="#fff" />
                  <Text className="text-white font-medium mt-1">Retake</Text>
                </Pressable>

                <Pressable
                  onPress={handleParse}
                  className="flex-2 bg-amber-500 py-4 px-8 rounded-xl flex-row items-center justify-center ml-2 active:opacity-90"
                >
                  <Scan size={20} color="#000" />
                  <Text className="text-black font-bold ml-2">Parse Times</Text>
                </Pressable>
              </View>
            </View>
          </View>
        )}

        {/* Parsing Mode */}
        {mode === 'parsing' && (
          <View className="flex-1 items-center justify-center px-8">
            {isParsing ? (
              <Animated.View entering={FadeIn.duration(300)} className="items-center">
                <ActivityIndicator size="large" color="#f59e0b" />
                <Text className="text-white text-lg font-medium mt-4">Parsing OOOI times...</Text>
                <Text className="text-slate-400 text-sm mt-2">This may take a few seconds</Text>
              </Animated.View>
            ) : parseResult ? (
              <Animated.View entering={FadeInUp.duration(400)} className="w-full">
                {/* Result Card */}
                <View className="bg-slate-800/80 rounded-2xl p-5 mb-6">
                  <View className="flex-row items-center justify-between mb-4">
                    <Text className="text-white font-bold text-lg">Parsed Results</Text>
                    <View
                      className={cn(
                        'px-2 py-1 rounded-full',
                        parseResult.success ? 'bg-green-500/20' : 'bg-amber-500/20'
                      )}
                    >
                      <Text
                        className={cn(
                          'text-xs font-bold',
                          parseResult.success ? 'text-green-400' : 'text-amber-400'
                        )}
                      >
                        {parseResult.success ? 'SUCCESS' : 'LOW CONFIDENCE'}
                      </Text>
                    </View>
                  </View>

                  {/* Always show times grid - even on failure to show what was detected */}
                  <View className="flex-row justify-between mb-4">
                    <View className="items-center flex-1">
                      <Text className="text-slate-500 text-xs">OUT</Text>
                      <Text className="text-emerald-400 font-mono text-xl">
                        {parseResult.outTime || '--:--'}
                      </Text>
                    </View>
                    <View className="items-center flex-1">
                      <Text className="text-slate-500 text-xs">OFF</Text>
                      <Text className="text-blue-400 font-mono text-xl">
                        {parseResult.offTime || '--:--'}
                      </Text>
                    </View>
                    <View className="items-center flex-1">
                      <Text className="text-slate-500 text-xs">ON</Text>
                      <Text className="text-blue-400 font-mono text-xl">
                        {parseResult.onTime || '--:--'}
                      </Text>
                    </View>
                    <View className="items-center flex-1">
                      <Text className="text-slate-500 text-xs">IN</Text>
                      <Text className="text-emerald-400 font-mono text-xl">
                        {parseResult.inTime || '--:--'}
                      </Text>
                    </View>
                  </View>

                  {/* Show message based on result */}
                  {!parseResult.success && (
                    <Text className="text-slate-400 text-center text-sm mb-3">
                      {parseResult.error || 'Could not fully parse times. You can try again or use what was detected.'}
                    </Text>
                  )}

                  {/* Confidence */}
                  <View className="flex-row items-center justify-between pt-3 border-t border-slate-700">
                    <Text className="text-slate-500 text-sm">Confidence</Text>
                    <Text className={cn(
                      "font-semibold",
                      parseResult.confidence >= 0.7 ? "text-green-400" :
                      parseResult.confidence >= 0.4 ? "text-amber-400" : "text-red-400"
                    )}>
                      {Math.round(parseResult.confidence * 100)}%
                    </Text>
                  </View>
                </View>

                {/* Action Buttons */}
                <View className="flex-row">
                  <Pressable
                    onPress={handleReset}
                    className="flex-1 bg-slate-800 py-4 rounded-xl items-center mr-2 active:opacity-80"
                  >
                    <RefreshCw size={18} color="#fff" />
                    <Text className="text-white font-medium text-sm mt-1">Try Again</Text>
                  </Pressable>

                  {/* Always enable "Use Times" if we have ANY times */}
                  <Pressable
                    onPress={handleUseResult}
                    disabled={!parseResult.outTime && !parseResult.offTime && !parseResult.onTime && !parseResult.inTime}
                    className={cn(
                      'flex-1 py-4 rounded-xl items-center ml-2',
                      (parseResult.outTime || parseResult.offTime || parseResult.onTime || parseResult.inTime)
                        ? 'bg-amber-500 active:opacity-90'
                        : 'bg-slate-700'
                    )}
                  >
                    <Check size={18} color={(parseResult.outTime || parseResult.offTime || parseResult.onTime || parseResult.inTime) ? '#000' : '#64748b'} />
                    <Text
                      className={cn(
                        'font-bold text-sm mt-1',
                        (parseResult.outTime || parseResult.offTime || parseResult.onTime || parseResult.inTime) ? 'text-black' : 'text-slate-500'
                      )}
                    >
                      Use Times
                    </Text>
                  </Pressable>
                </View>
              </Animated.View>
            ) : null}
          </View>
        )}
      </View>
    </Modal>
  );
}
