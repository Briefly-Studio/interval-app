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

  return (
    <View style={styles.container}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View
        style={[
          styles.inputRow,
          !isPassword && styles.inputRowNoAccessory,
          error && styles.inputRowError,
        ]}
      >
        <TextInput
          {...inputProps}
          secureTextEntry={isPassword ? !revealed : inputProps.secureTextEntry}
          placeholderTextColor={colors.textPlaceholder}
          style={styles.input}
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
  inputRowError: { borderColor: colors.danger },
  input: {
    flex: 1,
    fontSize: 16,
    color: colors.textPrimary,
    paddingVertical: spacing.sm,
  },
  error: { ...typography.caption, color: colors.danger },
});
