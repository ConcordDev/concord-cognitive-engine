/**
 * Unity WebGL index.html post-process for the world-lens iframe.
 * Keep in sync with applyUnityWebEmbed in
 * concord-frontend/app/unity-client/index.html/route.ts (that copy also
 * runs at request time so an older committed index still full-bleeds).
 */
export function applyUnityWebEmbed(html) {
  let out = html;
  if (!out.includes('id="concord-unity-fullbleed"')) {
    const style =
      '<style id="concord-unity-fullbleed">' +
      "html,body,#unity-container,#unity-canvas{width:100%!important;height:100%!important;margin:0;padding:0;overflow:hidden;background:#000}" +
      "#unity-container.unity-desktop{left:0;top:0;transform:none;width:100%;height:100%}" +
      "#unity-footer{display:none!important}" +
      "</style>";
    out = /<\/head>/i.test(out) ? out.replace(/<\/head>/i, `${style}</head>`) : style + out;
  }
  if (!/\bdecompressionFallback\s*:/.test(out)) {
    out = out.replace(
      /showBanner:\s*unityShowBanner,/,
      "showBanner: unityShowBanner,\n        decompressionFallback: true,",
    );
  }
  out = out.replace(/canvas\.style\.width = "960px";/, 'canvas.style.width = "100%";');
  out = out.replace(/canvas\.style\.height = "600px";/, 'canvas.style.height = "100%";');
  return out;
}
