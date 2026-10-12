const SUPPORT_EMAIL = "contact@intelliforge.tech";

export function SupportEmailLink() {
  return <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>;
}
