/**
 * SearchBar - Search input for audit trail
 */

import { View, TextInput, Pressable } from "react-native";
import { Search, X } from "lucide-react-native";
import * as Haptics from "expo-haptics";

interface SearchBarProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
}

export function SearchBar({ value, onChangeText, placeholder = "Search trips, events, codes, airports..." }: SearchBarProps) {
  const handleClear = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onChangeText("");
  };

  return (
    <View className="mx-5 flex-row items-center bg-slate-800/60 rounded-2xl px-4 py-3 border border-slate-700/50">
      <Search size={18} color="#64748b" />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#64748b"
        className="flex-1 text-white text-base ml-3"
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
      />
      {value.length > 0 && (
        <Pressable onPress={handleClear} className="p-1 active:opacity-50">
          <X size={18} color="#64748b" />
        </Pressable>
      )}
    </View>
  );
}
