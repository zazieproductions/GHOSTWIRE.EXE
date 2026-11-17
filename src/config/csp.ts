/**
 * Content Security Policy strings and the HTML injection transform (AUDIT F11).
 *
 * This module is deliberately free of Vite/plugin imports so the policy can be
 * unit-tested in the jsdom environment without loading the build toolchain.
 * Both production and development policies forbid framing and object embeds;
 * the production policy also forbids all outbound connections.
 */
export function contentSecurityPolicy(isBuild: boolean): string {
  return isBuild
    ? "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'none'; media-src 'self' mediastream: blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none';"
    : "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' ws: wss:; media-src 'self' mediastream: blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none';";
}

export function injectCspMeta(html: string, isBuild: boolean): string {
  return html.replace(
    '<!-- GHOSTWIRE_CSP -->',
    `<meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy(isBuild)}" />`
  );
}
