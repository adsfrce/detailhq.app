export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  // Diese Pfade niemals anfassen
  const p = url.pathname || "/";
  const passthroughPrefixes = ["/app", "/checkout", "/rechtliches", "/assets", "/favicon", "/logo", "/app_icon", "/pfp"];
  for (const pre of passthroughPrefixes) {
    if (p === pre || p.startsWith(pre + "/")) return next();
  }

  // Niemals echte Files rewriten
  if (p.includes(".") || p === "/" || p === "/index" || p === "/index.html") {
    return next();
  }

  // UUID erkennen (Detailer Booking Link: /<uuid>)
  const uuidRe = /^\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRe.test(p)) {
    return next();
  }

  // Intern auf book.html rewriten, URL im Browser bleibt /<uuid>
  const assetUrl = new URL(request.url);
  assetUrl.pathname = "/book.html";

  const assetReq = new Request(assetUrl.toString(), request);
  return env.ASSETS.fetch(assetReq);
}
