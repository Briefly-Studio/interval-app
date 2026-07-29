// English is the baseline resource — every other locale is validated against this shape and
// falls back to it for any missing leaf (see src/i18n/index.ts).
const en = {
  settings: {
    title: "Settings",
    sections: {
      profile: "Profile",
      account: "Account",
      data: "Data",
      about: "About",
    },
    editProfile: "Edit profile",
    changePassword: "Change password",
    comingSoon: "Coming soon",
    signOut: "Sign out",
    sync: "Sync",
    syncExplanation: "Your decks sync automatically while signed in.",
    recentlyDeleted: "Recently Deleted",
    importDeck: "Import deck",
    aboutDescription:
      "An offline-first flashcard app for focused, spaced study — with optional cloud sync when you're signed in.",
    version: "Version {{version}}",
    language: "Language",
    notSignedInTitle: "You're not signed in",
    notSignedInDescription: "Sign in to view and manage your account.",
    signIn: "Sign in",
    languageOptions: {
      system: "System default",
      english: "English",
    },
  },
  profile: {
    firstName: "First name",
    lastName: "Last name",
    nicknameOptional: "Nickname (optional)",
    nicknameHelper: "Interval will use this name in greetings.",
    nicknameHint: "Interval will use this name in greetings, instead of your first name.",
    save: "Save",
    enterFirstName: "Enter your first name.",
    enterLastName: "Enter your last name.",
    nameFormatError: "Letters, spaces, apostrophes, and hyphens only (max 50 characters).",
  },
  home: {
    greeting: {
      morning: "Good morning, {{name}}.",
      morningNeutral: "Good morning.",
      afternoon: "Good afternoon, {{name}}.",
      afternoonNeutral: "Good afternoon.",
      evening: "Good evening, {{name}}.",
      eveningNeutral: "Good evening.",
    },
    readyForNextSession: "Ready for your next session?",
    synced: "Synced",
    guestHeadline: "Ready to learn?",
    guestSupporting: "Your offline workspace",
  },
  auth: {
    welcomeBack: "Welcome back, {{name}}.",
    workspaceReady: "Your workspace is ready.",
    restoringWorkspace: "Restoring your workspace…",
  },
  // Pluralization foundation example (see src/i18n/index.ts's plural()). Not wired into a
  // screen yet — demonstrated via tests only, per this batch's scope.
  history: {
    sessionsCount: {
      one: "{{count}} session",
      other: "{{count}} sessions",
    },
  },
} as const;

export default en;
