import { useState } from "react";
import { StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";

import { IconButton } from "./IconButton";
import { colors, radii, spacing, typography, touchTarget } from "./theme";

type TextFieldProps = Omit<TextInputProps, "style"> & {
  label?: string;
  error?: string;
  /** Renders a show/hide toggle and manages masking locally; do not also pass secureTextEntry. */
  isPassword?: boolean;
};

export function TextField({ label, error, isPassword, ...inputProps }: TextFieldProps) {
  const [revealed, setRevealed] = useState(false);
  const isMultiline = !!inputProps.multiline;

  return (
    <View style={styles.container}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View
        style={[
          styles.inputRow,
          !isPassword && styles.inputRowNoAccessory,
          isMultiline && styles.inputRowMultiline,
          error && styles.inputRowError,
        ]}
      >
        <TextInput
          {...inputProps}
          secureTextEntry={isPassword ? !revealed : inputProps.secureTextEntry}
          placeholderTextColor={colors.textPlaceholder}
          textAlignVertical={isMultiline ? "top" : inputProps.textAlignVertical}
          style={[styles.input, isMultiline && styles.inputMultiline]}
        />
        {isPassword && (
          <IconButton
            name={revealed ? "eye-off-outline" : "eye-outline"}
            accessibilityLabel={revealed ? "Hide password" : "Show password"}
            onPress={() => setRevealed((value) => !value)}
            variant="ghost"
            size={18}
          />
        )}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.xs },
  label: { ...typography.label },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
    minHeight: touchTarget.min,
  },
  inputRowNoAccessory: { paddingRight: spacing.md },
  inputRowMultiline: { alignItems: "flex-start", minHeight: 96, paddingVertical: spacing.sm },
  inputRowError: { borderColor: colors.danger },
  input: {
    flex: 1,
    fontSize: 16,
    color: colors.textPrimary,
    paddingVertical: spacing.sm,
  },
  // Multiline rows use alignItems: "flex-start" (not the default "center"/stretch) so the
  // input starts at the top rather than vertically centering as it grows. Without an explicit
  // height on the TextInput itself, RN sizes it to its own intrinsic (near single-line) content
  // height and leaves the rest of the 96pt row as dead space that LOOKS like part of the field
  // but isn't part of the TextInput's touchable area at all — taps there land on the row's
  // background View, which has no text input to focus, so the keyboard never opens. Giving the
  // TextInput its own minHeight makes its actual (touchable) box span the full visual field.
  inputMultiline: { paddingVertical: 0, minHeight: 80 },
  error: { ...typography.caption, color: colors.danger },
});
