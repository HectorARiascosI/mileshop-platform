const IMAGEKIT_API_URL = "https://api.imagekit.io/v1/files";

export function getImageKitFileUrl(fileId: string): string {
  return `${IMAGEKIT_API_URL}/${encodeURIComponent(fileId)}`;
}

export function getImageKitFileDetailsUrl(fileId: string): string {
  return `${getImageKitFileUrl(fileId)}/details`;
}
