import * as Clipboard from "expo-clipboard";
import * as Linking from "expo-linking";

// The official Interval beta support address, approved by the founder. Never point this at a
// personal/developer email address — this is the one and only place the address is configured.
const SUPPORT_EMAIL = "intervalsupport@briefly-studios.com";

export type SupportContactRequest = { subject: string; body: string };

async function copyRequestToClipboard(request: SupportContactRequest): Promise<"copied" | "failed"> {
  try {
    // Readable plain text, not a raw object dump — this is what a user would paste into an email
    // client or issue tracker themselves.
    const text = `${request.subject}\n\n${request.body}`;
    await Clipboard.setStringAsync(text);
    return "copied";
  } catch {
    return "failed";
  }
}

/**
 * Attempts to hand the request off to the device's mail composer via a mailto: link. Falls back
 * to copying the subject/body to the clipboard when no support address is configured yet, or when
 * opening the mail composer fails for any reason (no mail app installed, OS rejects the URL,
 * etc.). Never throws — always resolves to one of "opened" | "copied" | "failed".
 *
 * Fully offline-capable: both the mailto composition and the clipboard copy are local OS
 * operations with no network dependency, so this must never be gated on connectivity.
 */
export async function contactSupport(request: SupportContactRequest): Promise<"opened" | "copied" | "failed"> {
  if (SUPPORT_EMAIL) {
    try {
      const url = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(request.subject)}&body=${encodeURIComponent(request.body)}`;
      await Linking.openURL(url);
      return "opened";
    } catch {
      return copyRequestToClipboard(request);
    }
  }
  return copyRequestToClipboard(request);
}
