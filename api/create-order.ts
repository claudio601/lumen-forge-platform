// api/create-order.ts
// Vercel Node.js Function — proxy seguro para crear órdenes en Jumpseller
// Usa VercelRequest/VercelResponse (Node.js IncomingMessage) en vez de Web API Request
import type { VercelRequest, VercelResponse } from '@vercel/node';

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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const login = process.env.JUMPSELLER_LOGIN;
  const token = process.env.JUMPSELLER_TOKEN;

  console.log('Handler reached. Method:', req.method, 'ContentType:', req.headers['content-type']);
  console.log('Credentials present — login:', !!login, 'token:', !!token);

  if (!login || !token) {
    console.error('Missing Jumpseller credentials');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  console.log('Body received:', JSON.stringify(req.body));

  const body = req.body as CreateOrderBody;
  const { items } = body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items array is required and must not be empty' });
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
    return res.status(500).json({ error: 'Failed to reach Jumpseller API' });
  }

  clearTimeout(timeoutId);
  console.log('Jumpseller response status:', jumpseller.status);

  if (!jumpseller.ok) {
    const errText = await jumpseller.text();
    console.error('Jumpseller API error:', jumpseller.status, errText);
    return res.status(jumpseller.status >= 400 && jumpseller.status < 500 ? 400 : 500).json({
      error: `Jumpseller API error: ${jumpseller.status}`,
      detail: errText,
    });
  }

  const data = await jumpseller.json();
  console.log('Jumpseller response:', JSON.stringify(data));

  const checkoutUrl: string | undefined =
    data?.order?.checkout_url ?? data?.checkout_url ?? data?.payment_url;

  if (!checkoutUrl) {
    console.error('Missing checkout_url in response:', JSON.stringify(data));
    return res.status(500).json({
      error: 'Jumpseller did not return a checkout URL',
      raw: data,
    });
  }

  return res.status(200).json({
    checkout_url: checkoutUrl,
    order_id: data?.order?.id,
  });
}
