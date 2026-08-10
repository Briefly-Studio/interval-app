# Library Cross-Device Behavior: Diagnosis

## Founder-observed behavior

Device A, signed into an account, has Library sources and collections. Device B, signed into the
**same** account, shows an empty Library.

## Verdict: expected, by construction — code-confirmed, not assumed

This is not a bug in workspace scoping, not a sign-in/sign-out transition bug, and not an
AsyncStorage race. **Library metadata has never been wired to any transport mechanism.** Every
device's Library is, and has only ever been, a fully independent local dataset. Verified directly
against the current source in this repository (not repeated from a prior report without checking):

### 1. Library storage is `AsyncStorage`-only

```
$ grep -niE "fetch\(|http\.|sync|aws|cognito" src/storage/librarySources.ts src/storage/sourceCollections.ts
(no matches)
```

Both files import only `AsyncStorage` and the local model/key modules. No network call, no AWS
SDK, no Cognito reference anywhere in either file — matching what
`docs/library-ui-foundation.md`'s "Confirmation: no real source content is stored" section already
states, now specifically re-verified for the storage layer's transport behavior (not just binary
content) as part of this diagnosis.

### 2. The sync engine has zero awareness Library exists

```
$ grep -niE "library|source" src/cloud/sync/SyncService.ts src/cloud/sync/types.ts src/cloud/sync/validateChange.ts
(no matches)
```

`SyncService.ts` — the entire push/pull/apply engine — only ever reads/writes `decks`, `cards`,
and `sessions` (see `collectDirty`, `applyChanges`, `markClean`). There is no code path, anywhere,
that reads a `LibrarySourceRecord` or `SourceCollectionRecord` and sends it to
`/sync/push`, and no code path that could receive one from `/sync/pull` even if the backend sent
one (the backend never does either — Library never appears in `backend/lambdas/sync-*`).

### 3. Workspace scoping is not the cause — and doesn't need to be

`src/storage/libraryKeys.ts`'s `librarySourcesKey(scope)` produces the **identical key string**
on every device for the same signed-in account (`scopedKey` is a pure function of `WorkspaceScope`,
and `scope.sub` — the Cognito subject — is the same value regardless of which device asks for it).
That's not the problem. The problem is one level below: `AsyncStorage` is a per-device, on-disk
key-value store with no built-in replication. Two devices computing the same key string are still
reading and writing two entirely separate physical databases. Identical keys, disjoint storage.

### 4. Account sign-in/sign-out transitions are not the cause either

The existing guest-vs-`user:<sub>` isolation (`scopedKey`) correctly prevents one account's local
Library data from blending with another's on the *same* device across sign-out/sign-in — that
isolation guarantee holds and was not found to be violated. It simply has nothing to do with
*cross-device* visibility, which was never implemented for this feature.

## Conclusion

**Confirmed, not assumed:** Library metadata is local-only, full stop, even for an authenticated,
signed-in workspace. This matches the architectural expectation
`docs/library-and-source-architecture.md` and `docs/library-ui-foundation.md` already documented
("no cloud Library record... in this batch"), now traced to the exact absence (no code path in
either `src/storage/librarySources.ts`/`sourceCollections.ts` or
`src/cloud/sync/SyncService.ts`) rather than restated as a general claim.

**What would need to change for this to work:** a real cloud Library sync implementation — see
`docs/library-cloud-sync-contract.md` for the full specification of what that must look like once
Development AWS infrastructure exists to build it against. Nothing in this diagnosis is resolved
by this mission; it is documented, not fixed, per this mission's explicit scope (no Library cloud
backend implementation).
