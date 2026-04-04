/**
 * Error Boundary Component
 * Catches JavaScript errors in child components and displays fallback UI
 */

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { View, Text, Pressable } from 'react-native';
import { AlertTriangle, RefreshCw } from 'lucide-react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log error to console in development
    console.error('ErrorBoundary caught error:', error, errorInfo);

    // Call optional error handler (for Sentry, etc.)
    this.props.onError?.(error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <Animated.View
          entering={FadeIn.duration(300)}
          className="flex-1 bg-slate-900 items-center justify-center px-6"
        >
          <View className="bg-slate-800/80 rounded-2xl p-6 items-center max-w-sm w-full">
            <View className="w-16 h-16 rounded-full bg-red-500/20 items-center justify-center mb-4">
              <AlertTriangle size={32} color="#ef4444" />
            </View>

            <Text className="text-white text-xl font-bold text-center mb-2">
              Something went wrong
            </Text>

            <Text className="text-slate-400 text-center mb-6">
              An unexpected error occurred. Please try again.
            </Text>

            <Pressable
              onPress={this.handleRetry}
              className="bg-blue-500 px-6 py-3 rounded-xl flex-row items-center active:opacity-80"
            >
              <RefreshCw size={18} color="#ffffff" />
              <Text className="text-white font-semibold ml-2">Try Again</Text>
            </Pressable>

            {__DEV__ && this.state.error && (
              <View className="mt-4 p-3 bg-slate-700/50 rounded-lg w-full">
                <Text className="text-red-400 text-xs font-mono">
                  {this.state.error.message}
                </Text>
              </View>
            )}
          </View>
        </Animated.View>
      );
    }

    return this.props.children;
  }
}

/**
 * Screen-level Error Boundary with minimal UI
 */
export class ScreenErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Screen error:', error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <View className="flex-1 bg-slate-900 items-center justify-center p-6">
          <AlertTriangle size={24} color="#f59e0b" />
          <Text className="text-slate-400 text-center mt-3 mb-4">
            Failed to load this screen
          </Text>
          <Pressable
            onPress={this.handleRetry}
            className="px-4 py-2 bg-slate-800 rounded-lg"
          >
            <Text className="text-white">Retry</Text>
          </Pressable>
        </View>
      );
    }

    return this.props.children;
  }
}
