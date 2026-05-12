// @env-config-ok: offline-mode peer URL templates
/**
 * Cloud Storage Bridge — User-Owned Cloud Backup for Artifacts
 *
 * DTU metadata stays in IndexedDB (tiny). Binary artifacts (music, images,
 * videos, 3D models) back up to the user's OWN cloud storage.
 *
 * Supported providers:
 *   - Google Drive (OAuth2, scoped to a Concord folder)
 *   - Dropbox (OAuth2, scoped to app folder)
 *
 * The server never stores user artifacts. DTUs hold references:
 *   artifact.externalRef: { provider, fileId, size, mimeType }
 *
 * On access: stream from user's cloud, not the server.
 */

// ── Types ─────────────────────────────────────────────────

export type CloudProvider = 'gdrive' | 'dropbox' | 'none';

export interface CloudConfig {
  provider: CloudProvider;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  folderId?: string;  // Provider-specific folder ID for Concord data
  email?: string;
}

export interface ExternalRef {
  provider: CloudProvider;
  fileId: string;
  fileName: string;
  size: number;
  mimeType: string;
  uploadedAt: string;
}

export interface CloudUploadResult {
  ok: boolean;
  ref?: ExternalRef;
  error?: string;
}

// ── Config Persistence ────────────────────────────────────
const CONFIG_KEY = 'concord_cloud_config';

export function getCloudConfig(): CloudConfig | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveCloudConfig(config: CloudConfig): void {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

export function clearCloudConfig(): void {
  localStorage.removeItem(CONFIG_KEY);
}

export function isCloudConnected(): boolean {
  const config = getCloudConfig();
  return !!config && config.provider !== 'none' && !!config.accessToken;
}

// ── Google Drive ──────────────────────────────────────────

const GDRIVE_API = 'https://www.googleapis.com/upload/drive/v3/files';
const GDRIVE_FILES_API = 'https://www.googleapis.com/drive/v3/files';
const GDRIVE_FOLDER_NAME = 'Concord Artifacts';

/** Get or create the Concord folder in Google Drive */
async function getOrCreateGDriveFolder(token: string): Promise<string> {
  // Search for existing folder
  const searchUrl = `${GDRIVE_FILES_API}?q=name='${GDRIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false&fields=files(id)`;
  const searchRes = await fetch(searchUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (searchRes.ok) {
    const data = await searchRes.json();
    if (data.files?.length > 0) return data.files[0].id;
  }

  // Create folder
  const createRes = await fetch(GDRIVE_FILES_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: GDRIVE_FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
    }),
  });

  if (!createRes.ok) throw new Error('Failed to create Google Drive folder');
  const folder = await createRes.json();
  return folder.id;
}

/** Upload a file to Google Drive */
async function uploadToGDrive(
  token: string,
  folderId: string,
  file: File | Blob,
  fileName: string,
  mimeType: string
): Promise<ExternalRef> {
  const metadata = {
    name: fileName,
    parents: [folderId],
    mimeType,
  };

  // Multipart upload
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', file);

  const res = await fetch(`${GDRIVE_API}?uploadType=multipart&fields=id,name,size,mimeType`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google Drive upload failed: ${err}`);
  }

  const data = await res.json();
  return {
    provider: 'gdrive',
    fileId: data.id,
    fileName: data.name,
    size: Number(data.size) || file.size || 0,
    mimeType: data.mimeType || mimeType,
    uploadedAt: new Date().toISOString(),
  };
}

/** Download a file from Google Drive */
async function downloadFromGDrive(token: string, fileId: string): Promise<Blob> {
  const res = await fetch(`${GDRIVE_FILES_API}/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Google Drive download failed: ${res.status}`);
  return res.blob();
}

/** Delete a file from Google Drive */
async function deleteFromGDrive(token: string, fileId: string): Promise<void> {
  const res = await fetch(`${GDRIVE_FILES_API}/${fileId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 404) throw new Error(`Google Drive delete failed: ${res.status}`);
}

// ── Dropbox ───────────────────────────────────────────────

const DROPBOX_UPLOAD_API = 'https://content.dropboxapi.com/2/files/upload';
const DROPBOX_DOWNLOAD_API = 'https://content.dropboxapi.com/2/files/download';
const DROPBOX_DELETE_API = 'https://api.dropboxapi.com/2/files/delete_v2';
const DROPBOX_FOLDER = '/Concord Artifacts';

/** Upload a file to Dropbox */
async function uploadToDropbox(
  token: string,
  file: File | Blob,
  fileName: string,
  mimeType: string
): Promise<ExternalRef> {
  const path = `${DROPBOX_FOLDER}/${fileName}`;

  const res = await fetch(DROPBOX_UPLOAD_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': JSON.stringify({
        path,
        mode: 'add',
        autorename: true,
        mute: false,
      }),
    },
    body: file,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Dropbox upload failed: ${err}`);
  }

  const data = await res.json();
  return {
    provider: 'dropbox',
    fileId: data.id || data.path_lower || path,
    fileName: data.name || fileName,
    size: data.size || file.size || 0,
    mimeType,
    uploadedAt: new Date().toISOString(),
  };
}

/** Download a file from Dropbox */
async function downloadFromDropbox(token: string, fileId: string): Promise<Blob> {
  // fileId could be a path or an ID
  const arg = fileId.startsWith('/') ? { path: fileId } : { path: `id:${fileId}` };

  const res = await fetch(DROPBOX_DOWNLOAD_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Dropbox-API-Arg': JSON.stringify(arg),
    },
  });
  if (!res.ok) throw new Error(`Dropbox download failed: ${res.status}`);
  return res.blob();
}

/** Delete a file from Dropbox */
async function deleteFromDropbox(token: string, fileId: string): Promise<void> {
  const path = fileId.startsWith('/') ? fileId : `${DROPBOX_FOLDER}/${fileId}`;
  const res = await fetch(DROPBOX_DELETE_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ path }),
  });
  if (!res.ok && res.status !== 409) throw new Error(`Dropbox delete failed: ${res.status}`);
}

// ── Unified Cloud API ─────────────────────────────────────

/** Upload an artifact to the user's connected cloud storage */
export async function uploadArtifact(
  file: File | Blob,
  fileName: string,
  mimeType: string
): Promise<CloudUploadResult> {
  const config = getCloudConfig();
  if (!config || config.provider === 'none') {
    return { ok: false, error: 'No cloud storage connected' };
  }

  try {
    let ref: ExternalRef;

    if (config.provider === 'gdrive') {
      // Ensure folder exists
      if (!config.folderId) {
        config.folderId = await getOrCreateGDriveFolder(config.accessToken);
        saveCloudConfig(config);
      }
      ref = await uploadToGDrive(config.accessToken, config.folderId, file, fileName, mimeType);
    } else if (config.provider === 'dropbox') {
      ref = await uploadToDropbox(config.accessToken, file, fileName, mimeType);
    } else {
      return { ok: false, error: `Unsupported provider: ${config.provider}` };
    }

    return { ok: true, ref };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Upload failed' };
  }
}

/** Download an artifact from the user's cloud storage */
export async function downloadArtifact(ref: ExternalRef): Promise<Blob | null> {
  const config = getCloudConfig();
  if (!config || config.provider !== ref.provider) return null;

  try {
    if (ref.provider === 'gdrive') {
      return await downloadFromGDrive(config.accessToken, ref.fileId);
    } else if (ref.provider === 'dropbox') {
      return await downloadFromDropbox(config.accessToken, ref.fileId);
    }
    return null;
  } catch (err) {
    console.error('[CloudBridge] Download failed:', err);
    return null;
  }
}

/** Delete an artifact from the user's cloud storage */
export async function deleteArtifact(ref: ExternalRef): Promise<boolean> {
  const config = getCloudConfig();
  if (!config || config.provider !== ref.provider) return false;

  try {
    if (ref.provider === 'gdrive') {
      await deleteFromGDrive(config.accessToken, ref.fileId);
    } else if (ref.provider === 'dropbox') {
      await deleteFromDropbox(config.accessToken, ref.fileId);
    }
    return true;
  } catch (err) {
    console.error('[CloudBridge] Delete failed:', err);
    return false;
  }
}

/** Check if a cloud provider token is still valid */
export async function checkCloudConnection(): Promise<{ connected: boolean; email?: string; error?: string }> {
  const config = getCloudConfig();
  if (!config || config.provider === 'none') {
    return { connected: false };
  }

  // Check expiry
  if (config.expiresAt && Date.now() > config.expiresAt) {
    return { connected: false, error: 'Token expired — please reconnect' };
  }

  try {
    if (config.provider === 'gdrive') {
      const res = await fetch('https://www.googleapis.com/drive/v3/about?fields=user', {
        headers: { Authorization: `Bearer ${config.accessToken}` },
      });
      if (!res.ok) return { connected: false, error: 'Invalid token' };
      const data = await res.json();
      return { connected: true, email: data.user?.emailAddress };
    } else if (config.provider === 'dropbox') {
      const res = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.accessToken}` },
      });
      if (!res.ok) return { connected: false, error: 'Invalid token' };
      const data = await res.json();
      return { connected: true, email: data.email };
    }
    return { connected: false };
  } catch {
    return { connected: false, error: 'Network error' };
  }
}

/** Get total cloud storage usage from provider */
export async function getCloudUsage(): Promise<{ used: number; total: number } | null> {
  const config = getCloudConfig();
  if (!config || config.provider === 'none') return null;

  try {
    if (config.provider === 'gdrive') {
      const res = await fetch('https://www.googleapis.com/drive/v3/about?fields=storageQuota', {
        headers: { Authorization: `Bearer ${config.accessToken}` },
      });
      if (!res.ok) return null;
      const data = await res.json();
      return {
        used: Number(data.storageQuota?.usage || 0),
        total: Number(data.storageQuota?.limit || 0),
      };
    } else if (config.provider === 'dropbox') {
      const res = await fetch('https://api.dropboxapi.com/2/users/get_space_usage', {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.accessToken}` },
      });
      if (!res.ok) return null;
      const data = await res.json();
      return {
        used: data.used || 0,
        total: data.allocation?.allocated || 0,
      };
    }
    return null;
  } catch {
    return null;
  }
}
