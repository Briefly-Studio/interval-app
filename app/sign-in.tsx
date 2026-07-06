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

export default function SignInScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string }>();
  const [email, setEmail] = useState(params.email ?? "");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSignIn() {
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      Alert.alert("Missing details", "Enter your email and password.");
      return;
    }

    setLoading(true);
    try {
      await AuthService.signIn(trimmedEmail, password);
      router.replace("/");
    } catch (error) {
      Alert.alert(
        "Sign in failed",
        error instanceof Error ? error.message : "Unable to sign in."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: APP_BG }}>
      <View style={{ flex: 1, paddingHorizontal: 20, paddingTop: 12, gap: 16 }}>
        <Text style={{ fontSize: 24, fontWeight: "700", color: "white" }}>
          Sign in
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
          value={password}
          onChangeText={setPassword}
          placeholder="Password"
          autoCapitalize="none"
          autoComplete="password"
          secureTextEntry
          editable={!loading}
          placeholderTextColor="rgba(255,255,255,0.7)"
          style={inputStyle}
        />

        <View style={{ flexDirection: "row", gap: 12, flexWrap: "wrap" }}>
          <Pressable
            onPress={() => router.replace("/")}
            disabled={loading}
            style={secondaryButtonStyle}
          >
            <Text style={{ color: "white", fontWeight: "600" }}>Cancel</Text>
          </Pressable>

          <Pressable
            onPress={onSignIn}
            disabled={loading}
            style={primaryButtonStyle}
          >
            {loading ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text style={{ color: "white", fontWeight: "700" }}>Sign in</Text>
            )}
          </Pressable>

          <Pressable
            onPress={() => router.replace("/sign-up")}
            disabled={loading}
            style={secondaryButtonStyle}
          >
            <Text style={{ color: "white", fontWeight: "600" }}>
              Create account
            </Text>
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
