// api/create-order.ts
// Vercel Serverless Function — proxy seguro para crear órdenes en Jumpseller
// Las credenciales JUMPSELLER_LOGIN y JUMPSELLER_TOKEN viven solo en el servidor

interface OrderItem {
  jumpseller_id: number;
  quantity: number;
  price: number;
}

interface CreateOrderBody {
  items: OrderItem[];
}

const CORS_ORIGIN = 'https://nuevo.elights.cl';

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  // Manejo de preflight CORS
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
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': CORS_ORIGIN,
      },
    });
  }

  // Validar variables de entorno
  const login = process.env.JUMPSELLER_LOGIN;
  const token = process.env.JUMPSELLER_TOKEN;

  if (!login || !token) {
    console.error('Missing Jumpseller credentials');
    return new Response(JSON.stringify({ error: 'Server configuration error' }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': CORS_ORIGIN,
      },
    });
  }

  // Parsear body
  let body: CreateOrderBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': CORS_ORIGIN,
      },
    });
  }

  const { items } = body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return new Response(JSON.stringify({ error: 'items array is required and must not be empty' }), {
      status: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': CORS_ORIGIN,
      },
    });
  }

  // Construir payload para Jumpseller Orders API
  // https://jumpseller.com/support/api/#tag/Orders/operation/postOrders
  const orderPayload = {
    order: {
      status: 'Pending',
      products: items.map((item) => ({
        id: item.jumpseller_id,
        quantity: item.quantity,  // fix: era "qty", debe ser "quantity"
        price: item.price,
      })),
    },
  };

  // Autenticación Basic (login:token en Base64)
  const credentials = btoa(`${login}:${token}`);

  // Log de depuracion antes del fetch
  console.log('Calling Jumpseller API with', items.length, 'items');

  // Llamada a Jumpseller API
  let jumpseller: Response;
  try {
    jumpseller = await fetch('https://api.jumpseller.com/v1/orders.json', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${credentials}`,
      },
      body: JSON.stringify(orderPayload),
      signal: AbortSignal.timeout(15000), // fix: timeout de 15 segundos
    });
  } catch (err) {
    console.error('Network error calling Jumpseller API:', err);
    return new Response(JSON.stringify({ error: 'Failed to reach Jumpseller API' }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': CORS_ORIGIN,
      },
    });
  }

  // Log de depuracion del status de respuesta
  console.log('Jumpseller response status:', jumpseller.status);

  if (!jumpseller.ok) {
    const errText = await jumpseller.text();
    console.error('Jumpseller API error:', jumpseller.status, errText);
    return new Response(
      JSON.stringify({ error: `Jumpseller API error: ${jumpseller.status}`, detail: errText }),
      {
        status: jumpseller.status >= 400 && jumpseller.status < 500 ? 400 : 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': CORS_ORIGIN,
        },
      }
    );
  }

  const data = await jumpseller.json();

  // Jumpseller retorna la orden creada; extraemos el checkout_url
  const checkoutUrl: string | undefined =
    data?.order?.checkout_url ??
    data?.checkout_url ??
    data?.payment_url;

  if (!checkoutUrl) {
    console.error('Jumpseller response missing checkout_url:', JSON.stringify(data));
    return new Response(
      JSON.stringify({ error: 'Jumpseller did not return a checkout URL', raw: data }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': CORS_ORIGIN,
        },
      }
    );
  }

  return new Response(JSON.stringify({ checkout_url: checkoutUrl }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': CORS_ORIGIN,
    },
  });
}
