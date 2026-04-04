/**
 * Airport Database Upload Screen
 * Allows users to upload CSV/JSON files to expand timezone database
 */

import { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, Pressable, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as Haptics from 'expo-haptics';
import {
  Database,
  Upload,
  RefreshCw,
  FileText,
  Check,
  AlertCircle,
  ChevronLeft,
  Globe2,
  MapPin,
} from 'lucide-react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { cn } from '@/lib/cn';
import {
  loadAirportDb,
  saveAirportDb,
  parseAirportDbFromText,
  DEFAULT_AIRPORT_DB,
  type AirportDb,
} from '@/utils/airportDb';

export default function AirportDbUploadScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [status, setStatus] = useState<'loading' | 'ready' | 'importing' | 'success' | 'error'>('loading');
  const [statusMessage, setStatusMessage] = useState('Loading...');
  const [airportDb, setAirportDb] = useState<AirportDb | null>(null);

  // Load current database on mount
  useEffect(() => {
    loadDatabase();
  }, []);

  const loadDatabase = async () => {
    try {
      setStatus('loading');
      setStatusMessage('Loading airport database...');
      const db = await loadAirportDb();
      setAirportDb(db);
      setStatus('ready');
      setStatusMessage('Ready');
    } catch (error) {
      setStatus('error');
      setStatusMessage('Failed to load database');
    }
  };

  const handlePickAndImport = useCallback(async () => {
    try {
      setStatus('importing');
      setStatusMessage('Selecting file...');
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'text/plain',
          'text/csv',
          'application/json',
          'text/comma-separated-values',
        ],
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (result.canceled) {
        setStatus('ready');
        setStatusMessage('Import canceled');
        return;
      }

      const file = result.assets[0];
      setStatusMessage('Reading file...');

      // Fetch file content
      const text = await fetch(file.uri).then((r) => r.text());

      setStatusMessage('Parsing airport data...');
      const db = parseAirportDbFromText(text);

      setStatusMessage(`Saving ${db.records.length} airports...`);
      await saveAirportDb(db);

      setAirportDb(db);
      setStatus('success');
      setStatusMessage(`Successfully imported ${db.records.length} airports`);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      // Reset to ready after a moment
      setTimeout(() => {
        setStatus('ready');
      }, 2000);
    } catch (error: any) {
      console.error('Import error:', error);
      setStatus('error');
      setStatusMessage(`Import failed: ${error?.message || 'Unknown error'}`);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }, []);

  const handleResetToDefault = useCallback(async () => {
    Alert.alert(
      'Reset Database',
      'This will reset the airport database to the default set. Any custom airports will be removed.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            try {
              setStatus('importing');
              setStatusMessage('Resetting database...');
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

              await saveAirportDb(DEFAULT_AIRPORT_DB);
              setAirportDb(DEFAULT_AIRPORT_DB);

              setStatus('success');
              setStatusMessage('Reset to default database');
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

              setTimeout(() => {
                setStatus('ready');
              }, 2000);
            } catch (error: any) {
              setStatus('error');
              setStatusMessage(`Reset failed: ${error?.message || 'Unknown error'}`);
            }
          },
        },
      ]
    );
  }, []);

  const getStatusColor = () => {
    switch (status) {
      case 'success':
        return '#10b981';
      case 'error':
        return '#ef4444';
      case 'importing':
        return '#3b82f6';
      default:
        return '#64748b';
    }
  };

  const getStatusIcon = () => {
    switch (status) {
      case 'success':
        return <Check size={16} color="#10b981" />;
      case 'error':
        return <AlertCircle size={16} color="#ef4444" />;
      case 'importing':
      case 'loading':
        return <RefreshCw size={16} color="#3b82f6" />;
      default:
        return <Database size={16} color="#64748b" />;
    }
  };

  return (
    <View className="flex-1 bg-slate-950">
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Airport Timezones',
          headerStyle: { backgroundColor: '#0f172a' },
          headerTintColor: '#e2e8f0',
          headerLeft: () => (
            <Pressable onPress={() => router.back()} className="p-2">
              <ChevronLeft size={24} color="#e2e8f0" />
            </Pressable>
          ),
        }}
      />

      <LinearGradient
        colors={['#0f172a', '#020617']}
        style={{ flex: 1, paddingTop: 16, paddingHorizontal: 16 }}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        >
          {/* Header Card */}
          <Animated.View entering={FadeIn.duration(300)} className="mb-6">
            <View className="bg-slate-800/80 rounded-2xl p-4 border border-slate-700/50">
              <View className="flex-row items-center mb-3">
                <View className="w-12 h-12 rounded-xl bg-cyan-500/20 items-center justify-center">
                  <Globe2 size={24} color="#06b6d4" />
                </View>
                <View className="ml-3 flex-1">
                  <Text className="text-white text-xl font-bold">Airport Timezone Database</Text>
                  <Text className="text-slate-400 text-sm">
                    Used for Zulu → Local time conversion
                  </Text>
                </View>
              </View>

              {/* Stats */}
              {airportDb && (
                <View className="flex-row items-center justify-between bg-slate-900/60 rounded-xl p-3 mt-2">
                  <View className="items-center flex-1">
                    <Text className="text-white text-2xl font-bold">{airportDb.records.length}</Text>
                    <Text className="text-slate-500 text-xs">Airports</Text>
                  </View>
                  <View className="w-px h-10 bg-slate-700" />
                  <View className="items-center flex-1">
                    <Text className="text-white text-sm font-bold">v{airportDb.version}</Text>
                    <Text className="text-slate-500 text-xs">Version</Text>
                  </View>
                  <View className="w-px h-10 bg-slate-700" />
                  <View className="items-center flex-1">
                    <Text className="text-slate-400 text-xs text-center">
                      {new Date(airportDb.updatedAtISO).toLocaleDateString()}
                    </Text>
                    <Text className="text-slate-500 text-xs">Updated</Text>
                  </View>
                </View>
              )}
            </View>
          </Animated.View>

          {/* Status Indicator */}
          <Animated.View entering={FadeInDown.duration(300).delay(100)} className="mb-4">
            <View
              className="flex-row items-center bg-slate-800/60 rounded-xl p-3 border"
              style={{ borderColor: getStatusColor() + '40' }}
            >
              {getStatusIcon()}
              <Text className="text-slate-300 ml-2 flex-1">{statusMessage}</Text>
            </View>
          </Animated.View>

          {/* Upload Button */}
          <Animated.View entering={FadeInDown.duration(300).delay(150)} className="mb-3">
            <Pressable
              onPress={handlePickAndImport}
              disabled={status === 'importing' || status === 'loading'}
              className={cn(
                'rounded-2xl p-4 flex-row items-center border-2 border-dashed',
                status === 'importing' || status === 'loading'
                  ? 'bg-slate-800/40 border-slate-700'
                  : 'bg-amber-500/10 border-amber-500/40 active:opacity-80'
              )}
            >
              <View className="w-12 h-12 rounded-xl bg-amber-500/20 items-center justify-center">
                <Upload size={24} color="#f59e0b" />
              </View>
              <View className="ml-3 flex-1">
                <Text className="text-amber-400 font-bold text-lg">
                  Upload Airport Codes File
                </Text>
                <Text className="text-slate-400 text-sm">
                  CSV or JSON format
                </Text>
              </View>
            </Pressable>
          </Animated.View>

          {/* Reset Button */}
          <Animated.View entering={FadeInDown.duration(300).delay(200)} className="mb-6">
            <Pressable
              onPress={handleResetToDefault}
              disabled={status === 'importing' || status === 'loading'}
              className="bg-slate-800 border border-slate-700 rounded-xl p-4 flex-row items-center active:opacity-80"
            >
              <RefreshCw size={20} color="#64748b" />
              <Text className="text-slate-400 font-semibold ml-3">Reset to Default</Text>
            </Pressable>
          </Animated.View>

          {/* Format Guide */}
          <Animated.View entering={FadeInDown.duration(300).delay(250)}>
            <View className="bg-slate-800/60 rounded-2xl p-4 border border-slate-700/50">
              <View className="flex-row items-center mb-3">
                <FileText size={16} color="#64748b" />
                <Text className="text-slate-400 font-bold ml-2">File Format Guide</Text>
              </View>

              <Text className="text-slate-300 font-bold mb-2">CSV Format:</Text>
              <View className="bg-slate-900/60 rounded-lg p-3 mb-4">
                <Text className="text-slate-400 font-mono text-xs">
                  iata,icao,tz,name,city,country{'\n'}
                  SDF,KSDF,America/New_York,Louisville,Louisville,USA{'\n'}
                  LHR,EGLL,Europe/London,Heathrow,London,UK
                </Text>
              </View>

              <Text className="text-slate-300 font-bold mb-2">JSON Format:</Text>
              <View className="bg-slate-900/60 rounded-lg p-3">
                <Text className="text-slate-400 font-mono text-xs">
                  {'[\n'}
                  {'  { "iata": "SDF", "icao": "KSDF",\n'}
                  {'    "tz": "America/New_York" },\n'}
                  {'  { "iata": "LHR", "icao": "EGLL",\n'}
                  {'    "tz": "Europe/London" }\n'}
                  {']'}
                </Text>
              </View>

              <View className="mt-4 bg-blue-500/10 rounded-lg p-3">
                <View className="flex-row items-start">
                  <MapPin size={14} color="#3b82f6" style={{ marginTop: 2 }} />
                  <Text className="text-blue-400 text-xs ml-2 flex-1">
                    Required fields: tz (timezone), and either iata or icao code.
                    Timezone must be a valid IANA timezone like "America/New_York".
                  </Text>
                </View>
              </View>
            </View>
          </Animated.View>

          {/* Sample Airports */}
          {airportDb && airportDb.records.length > 0 && (
            <Animated.View entering={FadeInDown.duration(300).delay(300)} className="mt-6">
              <Text className="text-slate-400 font-bold text-sm uppercase mb-3">
                Sample Airports ({Math.min(10, airportDb.records.length)} of {airportDb.records.length})
              </Text>
              <View className="bg-slate-800/60 rounded-2xl overflow-hidden border border-slate-700/50">
                {airportDb.records.slice(0, 10).map((airport, i) => (
                  <View
                    key={`${airport.iata || airport.icao}-${i}`}
                    className={cn(
                      'flex-row items-center p-3',
                      i > 0 && 'border-t border-slate-700/50'
                    )}
                  >
                    <View className="w-12">
                      <Text className="text-white font-bold">{airport.iata || airport.icao}</Text>
                    </View>
                    <View className="flex-1">
                      <Text className="text-slate-300 text-sm" numberOfLines={1}>
                        {airport.name || airport.city || 'Unknown'}
                      </Text>
                    </View>
                    <Text className="text-slate-500 text-xs">
                      {airport.tz.split('/').pop()?.replace(/_/g, ' ')}
                    </Text>
                  </View>
                ))}
              </View>
            </Animated.View>
          )}
        </ScrollView>
      </LinearGradient>
    </View>
  );
}
