// api/create-order.ts
// Vercel Node.js Function — proxy seguro para crear órdenes en Jumpseller
// Flujo simple: recibe items → un solo POST a Jumpseller → retorna checkout_url

export const config = { runtime: 'nodejs' };

interface OrderItem {
  jumpseller_id: number;
  jumpseller_variant_id?: number;
  quantity: number;
  price: number;
}

interface CreateOrderBody {
  items: OrderItem[];
  customer_email?: string;
}

const CORS_ORIGIN = 'https://nuevo.elights.cl';

const corsHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': CORS_ORIGIN,
};

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': CORS_ORIGIN,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: corsHeaders,
    });
  }

  const login = process.env.JUMPSELLER_LOGIN;
  const token = process.env.JUMPSELLER_TOKEN;

  if (!login || !token) {
    console.error('Missing Jumpseller credentials');
    return new Response(JSON.stringify({ error: 'Server configuration error' }), {
      status: 500,
      headers: corsHeaders,
    });
  }

  let body: CreateOrderBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  const { items } = body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return new Response(
      JSON.stringify({ error: 'items array is required and must not be empty' }),
      { status: 400, headers: corsHeaders }
    );
  }

  // Payload de orden — una sola llamada a Jumpseller
  const orderPayload = {
    order: {
      customer: { email: 'guest@elights.cl' },
      products: items.map((item) => ({
        id: item.jumpseller_id,
        variant_id: item.jumpseller_variant_id,
        quantity: item.quantity,
      })),
    },
  };

  const apiUrl = `https://api.jumpseller.com/v1/orders.json?login=${login}&authtoken=${token}`;
  console.log('Calling Jumpseller API with', items.length, 'items');

  // AbortController con 25s de timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 25000);

  let jumpseller: Response;
  try {
    jumpseller = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(orderPayload),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    console.error('Network error calling Jumpseller API:', err);
    return new Response(JSON.stringify({ error: 'Failed to reach Jumpseller API' }), {
      status: 500,
      headers: corsHeaders,
    });
  }

  clearTimeout(timeoutId);
  console.log('Jumpseller response status:', jumpseller.status);

  if (!jumpseller.ok) {
    const errText = await jumpseller.text();
    console.error('Jumpseller API error:', jumpseller.status, errText);
    return new Response(
      JSON.stringify({ error: `Jumpseller API error: ${jumpseller.status}`, detail: errText }),
      {
        status: jumpseller.status >= 400 && jumpseller.status < 500 ? 400 : 500,
        headers: corsHeaders,
      }
    );
  }

  const data = await jumpseller.json();
  console.log('Jumpseller response:', JSON.stringify(data));

  const checkoutUrl: string | undefined =
    data?.order?.checkout_url ?? data?.checkout_url ?? data?.payment_url;

  if (!checkoutUrl) {
    console.error('Missing checkout_url in response:', JSON.stringify(data));
    return new Response(
      JSON.stringify({ error: 'Jumpseller did not return a checkout URL', raw: data }),
      { status: 500, headers: corsHeaders }
    );
  }

  return new Response(
    JSON.stringify({ checkout_url: checkoutUrl, order_id: data?.order?.id }),
    { status: 200, headers: corsHeaders }
  );
}
