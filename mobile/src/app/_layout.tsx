import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { useColorScheme } from '@/lib/useColorScheme';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { AliasProvider } from '@/lib/state/alias-context';
import { PayConfidenceProvider } from '@/lib/state/pay-confidence-context';
import { AuthProvider } from '@/lib/BetterAuthProvider';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { initAnalytics } from '@/lib/analytics';
import { useSyncManager } from '@/lib/syncManager';
import { clearSessionOnVersionChange } from '@/lib/clearSessionOnVersionChange';

export const unstable_settings = {
  // Start at welcome so unauthenticated users always see sign-in first
  initialRouteName: 'welcome',
};

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

function RootLayoutNav({ colorScheme }: { colorScheme: 'light' | 'dark' | null | undefined }) {
  // Start the global sync manager — drains queued offline operations when back online
  // useSyncManager();

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AliasProvider>
        <PayConfidenceProvider>
          <Stack>
            {/* Auth Screens */}
            <Stack.Screen name="welcome" options={{ headerShown: false }} />
            <Stack.Screen name="sign-in" options={{ headerShown: false }} />
            <Stack.Screen name="create-account" options={{ headerShown: false }} />
            <Stack.Screen name="profile-setup" options={{ headerShown: false, gestureEnabled: false }} />

            {/* Onboarding Flow — new multi-step */}
            <Stack.Screen name="onboarding/index" options={{ headerShown: false, gestureEnabled: false }} />
            <Stack.Screen name="onboarding/pilot-profile" options={{ headerShown: false, gestureEnabled: false }} />
            <Stack.Screen name="onboarding/career" options={{ headerShown: false, gestureEnabled: false }} />
            <Stack.Screen name="onboarding/goals" options={{ headerShown: false, gestureEnabled: false }} />
            {/* Legacy onboarding steps (contract/schedule setup) */}
            <Stack.Screen name="onboarding/airline-select" options={{ headerShown: false, gestureEnabled: false }} />
            <Stack.Screen name="onboarding/contract-upload" options={{ headerShown: false, gestureEnabled: true }} />
            <Stack.Screen name="onboarding/schedule-sync" options={{ headerShown: false, gestureEnabled: true }} />

            {/* Main App */}
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />

            {/* Settings Screen */}
            <Stack.Screen name="settings" options={{ headerShown: false }} />

            {/* Tax Settings Screen */}
            <Stack.Screen name="tax-settings" options={{ headerShown: false }} />

            {/* Projected Pay Statement Screen */}
            <Stack.Screen name="projected-pay-statement" options={{ headerShown: false }} />

            {/* Contract References Screen */}
            <Stack.Screen name="contract-references" options={{ headerShown: false }} />

            {/* Airport Database Screen */}
            <Stack.Screen name="airport-db" options={{ headerShown: false }} />

            {/* Pay Statement Mirror Screens */}
            <Stack.Screen name="pay-review" options={{ headerShown: false }} />
            <Stack.Screen name="pay-statement-upload" options={{ headerShown: false }} />

            {/* Flight Log Screen */}
            <Stack.Screen name="flight-log" options={{ headerShown: false }} />

            {/* Modals */}
            <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
            <Stack.Screen name="paywall" options={{ headerShown: false, presentation: 'modal' }} />

            {/* Help Desk */}
            <Stack.Screen name="help-desk" options={{ headerShown: false }} />

            {/* Review Changes Screen - Phase 6 */}
            <Stack.Screen name="review-changes" options={{ headerShown: false }} />

            {/* Import Review Screen - Phase 6 Validation Gate */}
            <Stack.Screen name="import-review" options={{ headerShown: false }} />

            {/* OOOI Scanner - Capture ACARS flight times */}
            <Stack.Screen name="oooi-capture" options={{ headerShown: false }} />

            {/* Tools & Calculators */}
            <Stack.Screen name="30-in-7" options={{ headerShown: false }} />
            <Stack.Screen name="late-arrival-pay" options={{ headerShown: false }} />
            <Stack.Screen name="pay-calculator" options={{ headerShown: false }} />
            <Stack.Screen name="per-diem" options={{ headerShown: false }} />
            <Stack.Screen name="projections" options={{ headerShown: false }} />
            <Stack.Screen name="year-summary" options={{ headerShown: false }} />

            {/* Pay Code & Premium Libraries */}
            <Stack.Screen name="pay-code-library" options={{ headerShown: false }} />
            <Stack.Screen name="pay-code-detail" options={{ headerShown: false }} />
            <Stack.Screen name="premium-code-library" options={{ headerShown: false }} />
            <Stack.Screen name="premium-code-detail" options={{ headerShown: false }} />
            <Stack.Screen name="glossary" options={{ headerShown: false }} />

            {/* Pay Management */}
            <Stack.Screen name="pay-events" options={{ headerShown: false }} />
            <Stack.Screen name="evidence-notes" options={{ headerShown: false }} />
            <Stack.Screen name="pay-rules" options={{ headerShown: false }} />
            <Stack.Screen name="pay-summary" options={{ headerShown: false }} />
            <Stack.Screen name="pay-statements" options={{ headerShown: false }} />

            {/* Contract & Search */}
            <Stack.Screen name="search-contract" options={{ headerShown: false }} />

            {/* Log Events */}
            <Stack.Screen name="create-log-event" options={{ headerShown: false }} />

            {/* Sick Tracker */}
            <Stack.Screen name="sick-tracker" options={{ headerShown: false }} />

            {/* Career */}
            <Stack.Screen name="career-benchmarks" options={{ headerShown: false }} />

            {/* Settings & Admin */}
            <Stack.Screen name="notification-settings" options={{ headerShown: false }} />
            <Stack.Screen name="admin" options={{ headerShown: false }} />
            <Stack.Screen name="referrals" options={{ headerShown: false }} />

            {/* Auth */}
            <Stack.Screen name="forgot-password" options={{ headerShown: false }} />

            {/* Diagnostics (for TestFlight debugging) */}
            <Stack.Screen name="diagnostics" options={{ headerShown: false }} />

            {/* Pay Audit — Flight Register & Dayforce comparison */}
            <Stack.Screen name="pay-audit" options={{ headerShown: false }} />
          </Stack>
        </PayConfidenceProvider>
      </AliasProvider>
    </ThemeProvider>
  );
}



export default function RootLayout() {
  const colorScheme = useColorScheme();
  // Block the full app tree until we've run the version check.
  // The native splash screen stays visible during this ~50ms window.
  const [isAppReady, setIsAppReady] = useState(false);

  useEffect(() => {
    clearSessionOnVersionChange()
      .finally(() => {
        setIsAppReady(true);
        SplashScreen.hideAsync(); // ✅ ADD THIS
      });

    initAnalytics();
  }, []);

  // Keep splash screen visible until version check + auth state are resolved
  if (!isAppReady) {
    return <GestureHandlerRootView style={{ flex: 1 }} />;
  }

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <KeyboardProvider>
            <AuthProvider appReady={isAppReady}>
              <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
              <RootLayoutNav colorScheme={colorScheme} />
            </AuthProvider>
          </KeyboardProvider>
        </GestureHandlerRootView>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}