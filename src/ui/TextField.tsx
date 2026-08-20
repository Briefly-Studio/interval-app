import { useState } from "react";
import { StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";

import { useTranslation } from "../i18n";
import { useLayoutDirection } from "../i18n/direction";
import { IconButton } from "./IconButton";
import { useTheme } from "@/src/theme";

type TextFieldProps = Omit<TextInputProps, "style"> & {
  label?: string;
  error?: string;
  /** Renders a show/hide toggle and manages masking locally; do not also pass secureTextEntry. */
  isPassword?: boolean;
};

export function TextField({ label, error, isPassword, ...inputProps }: TextFieldProps) {
  const { colors, radii, spacing, typography, touchTarget } = useTheme();
  const { t } = useTranslation();
  const { row, text } = useLayoutDirection();
  const [revealed, setRevealed] = useState(false);
  const isMultiline = !!inputProps.multiline;

  return (
    <View style={[styles.container, { gap: spacing.xs }]}>
      {label ? <Text style={[typography.label, text, { color: colors.textSecondary }]}>{label}</Text> : null}
      <View
        style={[
          styles.inputRow,
          row,
          {
            borderColor: error ? colors.danger : colors.inputBorder,
            backgroundColor: colors.inputBackground,
            borderRadius: radii.md,
            paddingStart: spacing.md,
            paddingEnd: isPassword ? spacing.xs : spacing.md,
            minHeight: touchTarget.min,
          },
          isMultiline && { alignItems: "flex-start", minHeight: 96, paddingVertical: spacing.sm },
        ]}
      >
        <TextInput
          {...inputProps}
          secureTextEntry={isPassword ? !revealed : inputProps.secureTextEntry}
          placeholderTextColor={colors.placeholder}
          textAlignVertical={isMultiline ? "top" : inputProps.textAlignVertical}
          style={[
            styles.input,
            text,
            { color: colors.textPrimary, paddingVertical: spacing.sm },
            isMultiline && styles.inputMultiline,
          ]}
        />
        {isPassword && (
          <IconButton
            name={revealed ? "eye-off-outline" : "eye-outline"}
            accessibilityLabel={revealed ? t("common.hidePassword") : t("common.showPassword")}
            onPress={() => setRevealed((value) => !value)}
            variant="ghost"
            size={18}
          />
        )}
      </View>
      {error ? (
        <Text
          style={[typography.caption, text, { color: colors.danger }]}
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {},
  inputRow: { alignItems: "center", borderWidth: 1 },
  input: { flex: 1, fontSize: 16 },
  // Multiline rows use alignItems: "flex-start" (not the default "center"/stretch) so the
  // input starts at the top rather than vertically centering as it grows. Without an explicit
  // height on the TextInput itself, RN sizes it to its own intrinsic (near single-line) content
  // height and leaves the rest of the 96pt row as dead space that LOOKS like part of the field
  // but isn't part of the TextInput's touchable area at all — taps there land on the row's
  // background View, which has no text input to focus, so the keyboard never opens. Giving the
  // TextInput its own minHeight makes its actual (touchable) box span the full visual field.
  inputMultiline: { paddingVertical: 0, minHeight: 80 },
});
