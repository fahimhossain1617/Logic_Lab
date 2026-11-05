# Logic Lab — Firestore Security Specification

## 1. Data Invariants
1. **User Isolation (`users/{uid}/**`)**: A user can only read, create, update, or delete documents under `/users/{uid}` and its subcollections (`snippets`, `history`, `progress`) when `request.auth != null`, `request.auth.token.email_verified == true`, and `request.auth.uid == uid`.
2. **Relational Parent Gate**: Every subcollection document under `/users/{uid}/**` must exist under a valid parent `/users/{uid}` profile owned by `uid`, and its `ownerUid` field must strictly match `request.auth.uid`.
3. **Public Share Links (`/shares/{shareId}`)**: Readable via `get` by anyone holding the valid `shareId`. Writable (`create`, `delete`) only by an authenticated verified owner where `incoming().ownerUid == request.auth.uid`. Immutable once created.
4. **Read-Only Reference Collections (`/problems/{problemId}`, `/traceCache/{hash}`)**: `/problems/{problemId}` is read-only from the client (`allow read: if true; allow write: if false;`), and `/traceCache/{hash}` is strictly server-only (`allow read, write: if false;`).
5. **Strict Timestamps & Volumetric Bounds**: All `createdAt`/`updatedAt` timestamps must match `request.time`, all IDs must match `^[a-zA-Z0-9_\-]+$` (`<= 128` chars), and `code` strings must be `<= 6000` chars.

## 2. Dirty Dozen Adversarial Payloads
1. Unauthenticated write to `/users/u1/snippets/s1` -> `PERMISSION_DENIED`
2. Cross-user read on `/users/u2` by `u1` -> `PERMISSION_DENIED`
3. Spoofed `ownerUid: "u2"` when `u1` writes `/users/u1/snippets/s1` -> `PERMISSION_DENIED`
4. Shadow field injection (`isAdmin: true`) on `/users/u1` -> `PERMISSION_DENIED`
5. Oversized code (`7000` chars) on `/users/u1/snippets/s1` -> `PERMISSION_DENIED`
6. Forged client `createdAt` timestamp (`2020-01-01`) -> `PERMISSION_DENIED`
7. Mutating immutable `createdAt` or `ownerUid` on update -> `PERMISSION_DENIED`
8. Unverified email user (`email_verified: false`) attempting write -> `PERMISSION_DENIED`
9. Non-owner attempting to delete `/shares/sh1` -> `PERMISSION_DENIED`
10. Client attempting to write to `/problems/swap_correct` -> `PERMISSION_DENIED`
11. Client attempting to read or write `/traceCache/abc123` -> `PERMISSION_DENIED`
12. Invalid path ID containing spaces or >128 characters -> `PERMISSION_DENIED`
