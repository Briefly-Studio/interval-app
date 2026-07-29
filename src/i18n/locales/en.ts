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
  recentlyDeleted: {
    title: "Recently Deleted",
    showingAllNotice: "Showing everything, including items older than 30 days.",
    hiddenExpiredNotice: "Items older than 30 days are hidden here unless you choose to show them.",
    showExpired: "Show Expired",
    hideExpired: "Hide Expired",
    cancel: "Cancel",
    decksSectionTitle: "Decks",
    cardsSectionTitle: "Cards",
    decksEmptyTitle: "No deleted decks",
    decksEmptyDescription: "Decks you delete will appear here.",
    cardsEmptyTitle: "No deleted cards",
    cardsEmptyDescription: "Cards you delete on their own will appear here.",
    restore: "Restore",
    restoring: "Restoring…",
    restored: "Restored",
    restoreFailedTitle: "Restore failed",
    restoreFailedGeneric: "Please try again.",
    restoreDeckLabel: "Restore deck {{title}}",
    restoringDeckLabel: "Restoring deck {{title}}",
    restoreCardLabel: "Restore card {{title}}",
    restoringCardLabel: "Restoring card {{title}}",
    untitledCard: "Untitled card",
    deckNoLongerAvailable: "Deck no longer available",
    cardInDeck: "In: {{deckTitle}}",
    cardInDeletedDeck: "In: {{deckTitle}} (deleted)",
    deletedUnknown: "Deleted —",
    deletedMetaDays: {
      one: "Deleted {{date}} • {{count}} day ago",
      other: "Deleted {{date}} • {{count}} days ago",
    },
  },
  recovery: {
    deletedDeckAlertTitle: "Deck is in Recently Deleted",
    deletedDeckAlertBody: '"{{deckTitle}}" is currently deleted. Restore the deck first — this card will come back with it.',
    restoreDeckFirst: "Restore deck first",
    missingDeckAlertTitle: "Original deck not found",
    missingDeckAlertBody:
      'This card\'s original deck no longer exists. You can restore it into a new "Recovered Cards" deck instead.',
    restoreIntoRecovered: "Restore into Recovered Cards",
    corruptedAlertTitle: "Can't restore this card",
    corruptedAlertBody: "This card's original deck reference looks corrupted, so it can't be safely restored.",
  },
  sync: {
    status: {
      unknown: "Not synced yet",
      syncing: "Syncing changes…",
      synced: "Up to date",
      offline: "Offline — changes will sync later",
      needsAttention: "Sync needs attention",
    },
    screenTitle: "Sync status",
    retry: "Retry sync",
    detail: {
      lastSynced: "Last synced {{time}}",
      neverSynced: "Hasn't synced yet on this device",
      noPendingChanges: "No changes waiting to sync",
      pendingCount: {
        one: "{{count}} change waiting to sync",
        other: "{{count}} changes waiting to sync",
      },
    },
  },
} as const;

export default en;
