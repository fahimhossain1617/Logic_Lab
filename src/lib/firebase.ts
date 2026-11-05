/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  getDocs,
  query,
  where,
  limit,
  serverTimestamp,
  getDocFromServer,
} from 'firebase/firestore';
import appletFirebaseConfig from '../../firebase-applet-config.json';

// Support both Vercel/GitHub environment variables (VITE_FIREBASE_*) and AI Studio firebase-applet-config.json fallback
const env = (import.meta as any).env || {};

const rawApiKey = env.VITE_FIREBASE_API_KEY || (appletFirebaseConfig as any)?.apiKey;
const rawProjectId = env.VITE_FIREBASE_PROJECT_ID || (appletFirebaseConfig as any)?.projectId;

export const isFirebaseConfigured = Boolean(
  rawApiKey &&
    !rawApiKey.startsWith('YOUR_') &&
    rawApiKey !== 'demo-api-key' &&
    rawProjectId &&
    !rawProjectId.startsWith('YOUR_')
);

const resolvedFirebaseConfig = {
  apiKey: isFirebaseConfigured ? rawApiKey : 'demo-key-placeholder',
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || (appletFirebaseConfig as any)?.authDomain || 'demo.firebaseapp.com',
  projectId: isFirebaseConfigured ? rawProjectId : 'demo-project-placeholder',
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || (appletFirebaseConfig as any)?.storageBucket || '',
  messagingSenderId:
    env.VITE_FIREBASE_MESSAGING_SENDER_ID || (appletFirebaseConfig as any)?.messagingSenderId || '',
  appId: env.VITE_FIREBASE_APP_ID || (appletFirebaseConfig as any)?.appId || '1:12345:web:abcdef',
};

const resolvedDatabaseId =
  env.VITE_FIREBASE_FIRESTORE_DATABASE_ID || (appletFirebaseConfig as any)?.firestoreDatabaseId;

// Initialize Firebase SDK using resolved config
const app = initializeApp(resolvedFirebaseConfig);
export const db = resolvedDatabaseId && resolvedDatabaseId !== '(default)'
  ? getFirestore(app, resolvedDatabaseId)
  : getFirestore(app);
export const auth = getAuth(app);

// Validate connection to Firestore on startup as required by guidelines
async function testFirestoreConnection() {
  if (!isFirebaseConfigured) return;
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('Firebase configuration notice: The client is offline or database is not reachable.');
    }
  }
}
void testFirestoreConnection();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData.map((provider) => ({
          providerId: provider.providerId,
          displayName: provider.displayName,
          email: provider.email,
          photoUrl: provider.photoURL,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export interface AppUserProfile {
  uid: string;
  displayName: string;
  email: string;
  photoURL: string;
  isDemo?: boolean;
}

function sanitizeId(rawId: string, fallbackPrefix = 'item'): string {
  const cleaned = rawId.replace(/[^a-zA-Z0-9_\-]/g, '-').slice(0, 120);
  return cleaned || `${fallbackPrefix}-${Date.now()}`;
}

function sanitizeLanguage(lang: string): 'javascript' | 'python' | 'cpp' | 'java' {
  if (lang === 'python' || lang === 'cpp' || lang === 'java') return lang;
  return 'javascript';
}

function sanitizeVerdictStatus(
  status: string
): 'ok' | 'logic_error' | 'runtime_error' | 'infinite_loop' | 'compile_error' {
  if (
    status === 'logic_error' ||
    status === 'runtime_error' ||
    status === 'infinite_loop' ||
    status === 'compile_error'
  ) {
    return status;
  }
  return 'ok';
}

export async function signInWithGooglePopup(): Promise<AppUserProfile> {
  if (!isFirebaseConfigured) {
    alert(
      'Firebase কনফিগারেশন পাওয়া যায়নি। ক্লাউড সিঙ্ক ব্যবহার করতে Vercel-এ VITE_FIREBASE_* এনভায়রনমেন্ট ভেরিয়েবলগুলো যুক্ত করুন।'
    );
    throw new Error('Firebase configuration missing');
  }
  const provider = new GoogleAuthProvider();
  const result = await signInWithPopup(auth, provider);
  const user = result.user;
  const profile: AppUserProfile = {
    uid: user.uid,
    displayName: user.displayName || 'Logic Lab Student',
    email: user.email || '',
    photoURL: user.photoURL || '',
  };
  await syncUserProfileToFirestore(user);
  return profile;
}

export async function signOutFirebase(): Promise<void> {
  if (auth.currentUser) {
    await firebaseSignOut(auth);
  }
}

export function subscribeToAuthChanges(callback: (user: User | null) => void) {
  return onAuthStateChanged(auth, callback);
}

/**
 * Syncs `/users/{uid}` strictly adhering to `isValidUserProfile` in `firestore.rules`:
 * Required keys: ['uid', 'displayName', 'createdAt', 'settings']
 * Allowed keys: ['uid', 'displayName', 'photoURL', 'createdAt', 'updatedAt', 'settings']
 */
export async function syncUserProfileToFirestore(
  user: User,
  settings?: {
    theme?: string;
    explainLanguage?: string;
    detailLevel?: string;
    defaultCodeLanguage?: string;
    defaultSpeed?: number;
  }
) {
  if (!isFirebaseConfigured || !user?.uid) return;
  const path = `users/${user.uid}`;
  const displayName = (user.displayName || user.email?.split('@')[0] || 'Student').slice(0, 120);
  const photoURL = (user.photoURL || '').slice(0, 500);
  const safeSettings = {
    theme: settings?.theme || 'dark',
    explainLanguage: settings?.explainLanguage || 'bn',
    detailLevel: settings?.detailLevel || 'detailed',
    defaultCodeLanguage: settings?.defaultCodeLanguage || 'javascript',
    defaultSpeed: settings?.defaultSpeed || 1,
  };

  try {
    const ref = doc(db, 'users', user.uid);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        uid: user.uid,
        displayName: displayName || 'Student',
        photoURL,
        settings: safeSettings,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else if (settings) {
      const existing = snap.data();
      const mergedSettings = {
        ...(typeof existing.settings === 'object' && existing.settings ? existing.settings : {}),
        ...safeSettings,
      };
      await updateDoc(ref, {
        displayName: displayName || existing.displayName || 'Student',
        photoURL,
        settings: mergedSettings,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

/**
 * Ensures the parent `/users/{uid}` document exists before writing to subcollections
 * so `parentUserExists(uid)` in `firestore.rules` always succeeds.
 */
async function ensureParentUserExists(uid: string): Promise<void> {
  if (!auth.currentUser || auth.currentUser.uid !== uid) return;
  const ref = doc(db, 'users', uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await syncUserProfileToFirestore(auth.currentUser);
  }
}

/**
 * Saves `/users/{uid}/snippets/{snippetId}` strictly matching `isValidSnippet` in `firestore.rules`:
 * Required keys: ['ownerUid', 'title', 'language', 'code', 'favorite', 'createdAt', 'updatedAt']
 * Allowed keys: ['ownerUid', 'title', 'language', 'code', 'favorite', 'problemId', 'createdAt', 'updatedAt']
 */
export async function saveSnippetToFirestore(
  uid: string,
  snippet: {
    id: string;
    title: string;
    language: string;
    code: string;
    stdin?: string;
    isFavorite: boolean;
    problemId?: string;
  }
) {
  if (!isFirebaseConfigured || !auth.currentUser || auth.currentUser.uid !== uid) return;
  const cleanCode = snippet.code.slice(0, 6000);
  if (!cleanCode.trim()) return;

  const docId = sanitizeId(snippet.id, 'snip');
  const path = `users/${uid}/snippets/${docId}`;
  const cleanTitle = (snippet.title || 'main.js').trim().slice(0, 140) || 'main.js';
  const cleanLang = sanitizeLanguage(snippet.language);

  try {
    await ensureParentUserExists(uid);
    const ref = doc(db, 'users', uid, 'snippets', docId);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      const payload: Record<string, any> = {
        ownerUid: uid,
        title: cleanTitle,
        language: cleanLang,
        code: cleanCode,
        favorite: Boolean(snippet.isFavorite),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (snippet.problemId) {
        payload.problemId = String(snippet.problemId).slice(0, 100);
      }
      await setDoc(ref, payload);
    } else {
      await updateDoc(ref, {
        title: cleanTitle,
        language: cleanLang,
        code: cleanCode,
        favorite: Boolean(snippet.isFavorite),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function deleteSnippetFromFirestore(uid: string, snippetId: string) {
  if (!auth.currentUser || auth.currentUser.uid !== uid) return;
  const docId = sanitizeId(snippetId, 'snip');
  const path = `users/${uid}/snippets/${docId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'snippets', docId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

/**
 * Saves `/users/{uid}/history/{historyId}` strictly matching `isValidHistoryEntry` in `firestore.rules`:
 * Required keys: ['ownerUid', 'title_bn', 'title_en', 'language', 'code', 'analogyType', 'verdictStatus', 'favorite', 'createdAt']
 */
export async function saveHistoryToFirestore(
  uid: string,
  entry: {
    id: string;
    title: string;
    title_bn?: string;
    language: string;
    code: string;
    stdin?: string;
    renderer: string;
    verdictStatus?: string;
    hasFault?: boolean;
    stepsCount?: number;
  }
) {
  if (!isFirebaseConfigured || !auth.currentUser || auth.currentUser.uid !== uid) return;
  const docId = sanitizeId(entry.id, 'run');
  const path = `users/${uid}/history/${docId}`;
  const cleanTitleEn = (entry.title || 'Code Run').slice(0, 200);
  const cleanTitleBn = (entry.title_bn || entry.title || 'কোড রান').slice(0, 200);
  const cleanLang = sanitizeLanguage(entry.language);
  const cleanCode = (entry.code || '').slice(0, 6000);
  const cleanAnalogy = (entry.renderer || 'generic_memory').slice(0, 64);
  const cleanVerdict = sanitizeVerdictStatus(
    entry.verdictStatus || (entry.hasFault ? 'logic_error' : 'ok')
  );

  try {
    await ensureParentUserExists(uid);
    const ref = doc(db, 'users', uid, 'history', docId);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        ownerUid: uid,
        title_bn: cleanTitleBn,
        title_en: cleanTitleEn,
        language: cleanLang,
        code: cleanCode,
        analogyType: cleanAnalogy,
        verdictStatus: cleanVerdict,
        favorite: false,
        createdAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

/**
 * Syncs `/users/{uid}/progress/main` strictly matching `isValidUserProgress` in `firestore.rules`:
 * Required/Allowed keys: ['ownerUid', 'streak', 'lastActiveDate', 'completedProblemIds', 'badges', 'topicsCovered', 'updatedAt']
 */
export async function syncProgressToFirestore(
  uid: string,
  progress: {
    streak: number;
    lastActiveDate: string;
    completedProblemIds: string[];
    badges: string[];
    topicsCovered: string[];
  }
) {
  if (!isFirebaseConfigured || !auth.currentUser || auth.currentUser.uid !== uid) return;
  const path = `users/${uid}/progress/main`;
  const safePayload = {
    ownerUid: uid,
    streak: Math.max(0, Math.min(10000, Math.floor(Number(progress.streak) || 0))),
    lastActiveDate: String(progress.lastActiveDate || '').slice(0, 32),
    completedProblemIds: (progress.completedProblemIds || []).slice(0, 50).map(String),
    badges: (progress.badges || []).slice(0, 30).map(String),
    topicsCovered: (progress.topicsCovered || []).slice(0, 30).map(String),
    updatedAt: serverTimestamp(),
  };

  try {
    await ensureParentUserExists(uid);
    const ref = doc(db, 'users', uid, 'progress', 'main');
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, safePayload);
    } else {
      await updateDoc(ref, {
        streak: safePayload.streak,
        lastActiveDate: safePayload.lastActiveDate,
        completedProblemIds: safePayload.completedProblemIds,
        badges: safePayload.badges,
        topicsCovered: safePayload.topicsCovered,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

/**
 * Creates a public share document `/shares/{shareId}` strictly matching `isValidSharedRun` in `firestore.rules`:
 * Required/Allowed keys: ['ownerUid', 'title_bn', 'title_en', 'language', 'code', 'createdAt']
 */
export async function createShareInFirestore(shareData: {
  shareId: string;
  title: string;
  title_bn?: string;
  language: string;
  code: string;
  stdin?: string;
  traceJson?: string;
}) {
  if (!isFirebaseConfigured || !auth.currentUser) return;
  const cleanCode = (shareData.code || '').slice(0, 6000);
  if (!cleanCode.trim()) return;

  const docId = sanitizeId(shareData.shareId, 'share');
  const path = `shares/${docId}`;
  try {
    await ensureParentUserExists(auth.currentUser.uid);
    const ref = doc(db, 'shares', docId);
    await setDoc(ref, {
      ownerUid: auth.currentUser.uid,
      title_bn: (shareData.title_bn || shareData.title || 'শেয়ার করা কোড').slice(0, 200),
      title_en: (shareData.title || 'Shared Visualization').slice(0, 200),
      language: sanitizeLanguage(shareData.language),
      code: cleanCode,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

/**
 * Reads a public shared run `/shares/{shareId}` from Firestore (works without sign-in).
 */
export async function getShareFromFirestore(shareId: string): Promise<{
  shareId: string;
  ownerUid: string;
  title_bn: string;
  title_en: string;
  language: 'javascript' | 'python' | 'cpp' | 'java';
  code: string;
} | null> {
  if (!isFirebaseConfigured) return null;
  const docId = sanitizeId(shareId, 'share');
  try {
    const ref = doc(db, 'shares', docId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    const data = snap.data();
    return {
      shareId: docId,
      ownerUid: String(data.ownerUid || ''),
      title_bn: String(data.title_bn || 'শেয়ার করা কোড'),
      title_en: String(data.title_en || 'Shared Visualization'),
      language: sanitizeLanguage(String(data.language || 'javascript')),
      code: String(data.code || ''),
    };
  } catch {
    return null;
  }
}

export async function fetchUserCloudData(uid: string) {
  if (!isFirebaseConfigured || !auth.currentUser || auth.currentUser.uid !== uid) return null;
  try {
    await ensureParentUserExists(uid);
    const snippetsSnap = await getDocs(
      query(
        collection(db, 'users', uid, 'snippets'),
        where('ownerUid', '==', uid),
        limit(50)
      )
    );
    const historySnap = await getDocs(
      query(
        collection(db, 'users', uid, 'history'),
        where('ownerUid', '==', uid),
        limit(30)
      )
    );
    const progressSnap = await getDoc(doc(db, 'users', uid, 'progress', 'main'));

    return {
      snippets: snippetsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      history: historySnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      progress: progressSnap.exists() ? progressSnap.data() : null,
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `users/${uid}`);
  }
}
