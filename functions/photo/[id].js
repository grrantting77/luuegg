// Serves photos from the R2 bucket (binding: PHOTOS)
export async function onRequestGet({ env, params }) {
  const id = String(params.id || '');
  if (!/^[A-Za-z0-9]{8,64}$/.test(id) || !env.PHOTOS) return new Response('Not found', { status: 404 });
  const obj = await env.PHOTOS.get(id);
  if (!obj) return new Response('Not found', { status: 404 });
  return new Response(obj.body, {
    headers: {
      'content-type': obj.httpMetadata?.contentType || 'image/jpeg',
      'cache-control': 'public, max-age=31536000, immutable',
      etag: obj.httpEtag,
    },
  });
}
