export function getOptimizedImageUrl(imageUrl: string, width: number): string {
  if (!Number.isSafeInteger(width) || width < 1) return imageUrl;

  try {
    const url = new URL(imageUrl);
    if (url.protocol !== "https:" || !url.hostname.endsWith(".imagekit.io")) {
      return imageUrl;
    }
    url.searchParams.set("tr", `w-${width},q-85,f-auto`);
    return url.toString();
  } catch {
    return imageUrl;
  }
}
