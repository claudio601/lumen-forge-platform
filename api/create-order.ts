// api/create-order.ts
// Vercel Edge Function — proxy seguro para crear órdenes en Jumpseller
// Flujo: recibe email del cliente → busca/crea customer en Jumpseller → crea orden → retorna checkout_url

interface OrderItem {
  jumpseller_id: number;
  jumpseller_variant_id?: number;
  quantity: number;
  price: number;
}

interface CreateOrderBody {
  items: OrderItem[];
  customer_email: string;
  customer_name?: string;
}

const CORS_ORIGIN = 'https://nuevo.elights.cl';

export const config = { runtime: 'edge' };

async function getOrCreateCustomer(
  login: string,
  token: string,
  email: string,
  name: string
): Promise<number> {
  const base = `https://api.jumpseller.com/v1`;
  const auth = `login=${login}&authtoken=${token}`;

  // 1. Buscar customer por email
  const searchResp = await fetch(
    `${base}/customers.json?${auth}&email=${encodeURIComponent(email)}&limit=1`,
    { signal: AbortSignal.timeout(10000) }
  );
  if (searchResp.ok) {
    const list = await searchResp.json();
    if (Array.isArray(list) && list.length > 0) {
      const id = list[0]?.customer?.id;
      if (id) {
        console.log('Customer found:', id);
        return id;
      }
    }
  }

  // 2. No existe — crear customer
  const createResp = await fetch(`${base}/customers.json?${auth}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ customer: { email, name } }),
    signal: AbortSignal.timeout(10000),
  });
  if (!createResp.ok) {
    const err = await createResp.text();
    throw new Error(`Failed to create customer: ${createResp.status} ${err}`);
  }
  const created = await createResp.json();
  const newId = created?.customer?.id;
  if (!newId) throw new Error('Customer created but ID missing');
  console.log('Customer created:', newId);
  return newId;
}

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
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': CORS_ORIGIN },
    });
  }

  const login = process.env.JUMPSELLER_LOGIN;
  const token = process.env.JUMPSELLER_TOKEN;
  if (!login || !token) {
    return new Response(JSON.stringify({ error: 'Server configuration error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': CORS_ORIGIN },
    });
  }

  let body: CreateOrderBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': CORS_ORIGIN },
    });
  }

  const { items, customer_email, customer_name } = body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return new Response(JSON.stringify({ error: 'items array is required and must not be empty' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': CORS_ORIGIN },
    });
  }

  if (!customer_email || !customer_email.includes('@')) {
    return new Response(JSON.stringify({ error: 'customer_email is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': CORS_ORIGIN },
    });
  }

  // Obtener o crear customer
  let customerId: number;
  try {
    customerId = await getOrCreateCustomer(
      login, token,
      customer_email,
      customer_name ?? customer_email.split('@')[0]
    );
  } catch (err) {
    console.error('Customer error:', err);
    return new Response(JSON.stringify({ error: 'Failed to resolve customer' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': CORS_ORIGIN },
    });
  }

  const orderPayload = {
    order: {
      products: items.map((item) => ({
        id: item.jumpseller_variant_id ?? item.jumpseller_id,
        quantity: item.quantity,
      })),
      customer: { id: customerId },
    },
  };

  const apiUrl = `https://api.jumpseller.com/v1/orders.json?login=${login}&authtoken=${token}`;
  console.log('Creating order for customer', customerId, 'with', items.length, 'items');

  let jumpseller: Response;
  try {
    jumpseller = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(orderPayload),
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    console.error('Network error:', err);
    return new Response(JSON.stringify({ error: 'Failed to reach Jumpseller API' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': CORS_ORIGIN },
    });
  }

  if (!jumpseller.ok) {
    const errText = await jumpseller.text();
    console.error('Jumpseller order error:', jumpseller.status, errText);
    return new Response(
      JSON.stringify({ error: `Jumpseller API error: ${jumpseller.status}`, detail: errText }),
      {
        status: jumpseller.status >= 400 && jumpseller.status < 500 ? 400 : 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': CORS_ORIGIN },
      }
    );
  }

  const data = await jumpseller.json();
  const checkoutUrl: string | undefined =
    data?.order?.checkout_url ?? data?.checkout_url ?? data?.payment_url;

  if (!checkoutUrl) {
    console.error('Missing checkout_url in response:', JSON.stringify(data));
    return new Response(
      JSON.stringify({ error: 'Jumpseller did not return a checkout URL', raw: data }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': CORS_ORIGIN },
      }
    );
  }

  return new Response(
    JSON.stringify({ checkout_url: checkoutUrl, order_id: data?.order?.id }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': CORS_ORIGIN },
    }
  );
}
