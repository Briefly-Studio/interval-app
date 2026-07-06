import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AuthService } from "../src/auth/AuthService";

const APP_BG = "#2FA4A3";

export default function ConfirmSignUpScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string }>();
  const [email, setEmail] = useState(params.email ?? "");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);

  async function onConfirm() {
    const trimmedEmail = email.trim();
    const trimmedCode = code.trim();
    if (!trimmedEmail || !trimmedCode) {
      Alert.alert("Missing details", "Enter your email and confirmation code.");
      return;
    }

    setLoading(true);
    try {
      await AuthService.confirmSignUp(trimmedEmail, trimmedCode);
      router.replace({
        pathname: "/sign-in",
        params: { email: trimmedEmail },
      });
    } catch (error) {
      Alert.alert(
        "Confirmation failed",
        error instanceof Error ? error.message : "Unable to confirm sign up."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: APP_BG }}>
      <View style={{ flex: 1, paddingHorizontal: 20, paddingTop: 12, gap: 16 }}>
        <Text style={{ fontSize: 24, fontWeight: "700", color: "white" }}>
          Confirm sign up
        </Text>

        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder="Email"
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          editable={!loading}
          placeholderTextColor="rgba(255,255,255,0.7)"
          style={inputStyle}
        />

        <TextInput
          value={code}
          onChangeText={setCode}
          placeholder="Confirmation code"
          autoCapitalize="none"
          keyboardType="number-pad"
          editable={!loading}
          placeholderTextColor="rgba(255,255,255,0.7)"
          style={inputStyle}
        />

        <View style={{ flexDirection: "row", gap: 12, flexWrap: "wrap" }}>
          <Pressable
            onPress={() => router.replace("/sign-in")}
            disabled={loading}
            style={secondaryButtonStyle}
          >
            <Text style={{ color: "white", fontWeight: "600" }}>Sign in</Text>
          </Pressable>

          <Pressable
            onPress={onConfirm}
            disabled={loading}
            style={primaryButtonStyle}
          >
            {loading ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text style={{ color: "white", fontWeight: "700" }}>Confirm</Text>
            )}
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const inputStyle = {
  borderWidth: 1,
  borderColor: "rgba(255,255,255,0.35)",
  backgroundColor: "rgba(255,255,255,0.16)",
  padding: 14,
  borderRadius: 12,
  fontSize: 16,
  color: "white",
};

const primaryButtonStyle = {
  paddingVertical: 12,
  paddingHorizontal: 14,
  borderRadius: 12,
  borderWidth: 1,
  borderColor: "rgba(255,255,255,0.35)",
  backgroundColor: "rgba(255,255,255,0.2)",
  minWidth: 96,
  alignItems: "center" as const,
};

const secondaryButtonStyle = {
  paddingVertical: 12,
  paddingHorizontal: 14,
  borderRadius: 12,
  borderWidth: 1,
  borderColor: "rgba(255,255,255,0.35)",
  backgroundColor: "rgba(255,255,255,0.12)",
};
