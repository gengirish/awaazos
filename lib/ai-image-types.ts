/**
 * Client-safe half of AI images (server side: lib/ai-image.ts): what a seller
 * sees when a generation fails, and turning a preview back into a file.
 *
 * Off until NEXT_PUBLIC_AI_IMAGES_ENABLED=true, so the controls can ship dark.
 */
export const AI_IMAGES_ENABLED = process.env.NEXT_PUBLIC_AI_IMAGES_ENABLED === "true";

const MESSAGES: Record<string, string> = {
  ai_images_unavailable: "AI images aren't available right now. Please try again later.",
  ai_image_rate_limited: "That's a lot of images in a minute. Wait a moment and try again.",
  ai_image_cap_reached: "No AI images left on your plan this month.",
  ai_image_unsafe: "That description couldn't be used. Try describing something else.",
  ai_image_failed: "Couldn't make the image. Please try again.",
  billing_locked: "Your free trial has ended. Subscribe to make AI images.",
};

export function aiImageErrorMessage(code: string | undefined, status: number): string {
  if (code && MESSAGES[code]) return MESSAGES[code];
  if (status === 403) return "Only a manager or owner can make AI images.";
  if (status === 400) return "Describe the picture in a few words (300 characters at most).";
  return MESSAGES.ai_image_failed;
}

/** Decoded by hand: the CSP's connect-src does not allow fetch("data:…"). */
export function dataUriToFile(dataUri: string, fileName: string): File {
  const [head, base64] = dataUri.split(",", 2);
  const type = /^data:([^;]+);base64$/.exec(head)?.[1] ?? "image/jpeg";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], fileName, { type });
}
