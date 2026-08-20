# Arabic RTL Foundation

Arabic (`ar`) is Interval's first right-to-left UI locale. The app keeps language switching live:
choosing Arabic immediately updates translated strings and applies `rtl` presentation through
`src/i18n/direction.ts`; choosing an LTR language immediately returns those helpers to `ltr`.

React Native's global `I18nManager.forceRTL` is intentionally not toggled from the language
picker. Global RTL layout state is native-root-level behavior and is not safe to present as a
fully live change without a reload. Interval instead applies direction at the screen/shared-control
layer so English -> Arabic, Arabic -> English, Arabic -> Japanese, and Arabic -> Russian do not
leave stale mirrored chrome during the current session. On cold start, the persisted language
preference is resolved again and the same direction helpers apply before normal screens render.

Presentation-only bidi handling is deliberate. Source titles, filenames, URLs, email addresses,
file extensions, and document preview contents are never mutated or decorated with persisted bidi
control characters. UI chrome follows the active locale direction; user/source content remains the
content the user stored.
