// Pages Functions 反代：/api/* → 后端（Oracle VPS 等），同域免 CORS。
// 后端地址由 Pages secret BACKEND_ORIGIN 提供，例如 https://api.example.com 或 http://1.2.3.4:8010
interface Env {
  BACKEND_ORIGIN?: string;
}

export async function onRequest(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;
  const origin = env.BACKEND_ORIGIN;
  if (!origin) {
    return new Response(JSON.stringify({ code: 1, message: 'backend_not_configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const url = new URL(request.url);
  const target = `${origin}${url.pathname}${url.search}`;
  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.delete('content-length');
  headers.delete('transfer-encoding');
  // Cloudflare 保留头不可转发
  for (const name of ['cf-connecting-ip', 'cf-ray', 'cf-visitor', 'x-forwarded-for', 'x-forwarded-proto', 'x-real-ip']) {
    headers.delete(name);
  }
  const method = request.method;
  const body = method === 'GET' || method === 'HEAD' ? undefined : request.body;
  const resp = await fetch(target, { method, headers, body, redirect: 'manual' });
  const respHeaders = new Headers(resp.headers);
  respHeaders.delete('content-encoding');
  return new Response(resp.body, { status: resp.status, headers: respHeaders });
}
