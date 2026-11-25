import React, { useState, useEffect } from 'react';

const env = window.__ENV__ || {};
const AUTH_URL = env.AUTH_API_URL || import.meta.env.VITE_AUTH_API_URL || 'http://localhost:4004';
const PRODUCT_URL = env.PRODUCT_API_URL || import.meta.env.VITE_PRODUCT_API_URL || 'http://localhost:4002';
const SEARCH_URL = env.SEARCH_API_URL || import.meta.env.VITE_SEARCH_API_URL || 'http://localhost:4005';
const CART_URL = env.CART_API_URL || import.meta.env.VITE_CART_API_URL || 'http://localhost:4003';
const ORDER_URL = env.ORDER_API_URL || import.meta.env.VITE_ORDER_API_URL || 'http://localhost:4001';

// Rule 11: Display dollars by dividing integer cents by 100 for display only
function formatUsd(cents) {
  return `$${(Number(cents || 0) / 100).toFixed(2)}`;
}

export default function App() {
  const [page, setPage] = useState('products');
  const [token, setToken] = useState(localStorage.getItem('ecom_token') || '');
  const [user, setUser] = useState(null);

  // Auth form
  const [authMode, setAuthMode] = useState('login');
  const [email, setEmail] = useState('demo@store.io');
  const [password, setPassword] = useState('password123');
  const [fullName, setFullName] = useState('Demo Buyer');

  // Products & Search
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');

  // Cart
  const [cart, setCart] = useState({ items: [], total_cents: 0 });

  // Checkout
  const [cardNumber, setCardNumber] = useState('4242424242424242');
  const [cardCvv, setCardCvv] = useState('424');
  const [expMonth, setExpMonth] = useState('12');
  const [expYear, setExpYear] = useState('2029');
  const [checkoutBusy, setCheckoutBusy] = useState(false);

  // Orders
  const [orders, setOrders] = useState([]);
  const [activeOrder, setActiveOrder] = useState(null);
  const [banner, setBanner] = useState('');

  useEffect(() => {
    loadProducts();
    loadCategories();
  }, []);

  useEffect(() => {
    if (token) {
      fetch(`${AUTH_URL}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d?.user) {
            setUser(d.user);
            loadCart(token);
            loadOrders(token);
          } else {
            setToken('');
            localStorage.removeItem('ecom_token');
          }
        })
        .catch(() => {});
    }
  }, [token]);

  async function loadProducts() {
    const res = await fetch(`${PRODUCT_URL}/api/products`);
    const data = await res.json();
    setProducts(data.products || []);
  }

  async function loadCategories() {
    const res = await fetch(`${PRODUCT_URL}/api/categories`);
    const data = await res.json();
    setCategories(data.categories || []);
  }

  async function handleSearch(e) {
    e?.preventDefault();
    const params = new URLSearchParams();
    if (searchQuery) params.set('q', searchQuery);
    if (selectedCategory) params.set('category', selectedCategory);
    const res = await fetch(`${SEARCH_URL}/api/search?${params.toString()}`);
    const data = await res.json();
    setProducts(data.results || []);
  }

  async function loadCart(tok = token) {
    if (!tok) return;
    const res = await fetch(`${CART_URL}/api/cart`, { headers: { Authorization: `Bearer ${tok}` } });
    if (res.ok) setCart(await res.json());
  }

  async function loadOrders(tok = token) {
    if (!tok) return;
    const res = await fetch(`${ORDER_URL}/api/orders`, { headers: { Authorization: `Bearer ${tok}` } });
    if (res.ok) {
      const data = await res.json();
      setOrders(data.orders || []);
    }
  }

  async function handleAuth(e) {
    e.preventDefault();
    setBanner('');
    const endpoint = authMode === 'register' ? '/api/auth/register' : '/api/auth/login';
    const body = authMode === 'register' ? { email, password, full_name: fullName } : { email, password };
    const res = await fetch(`${AUTH_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      setBanner(data?.error?.message || 'Authentication failed');
      return;
    }
    localStorage.setItem('ecom_token', data.token);
    setToken(data.token);
    setUser(data.user);
    setPage('products');
  }

  async function addToCart(product) {
    if (!token) {
      setPage('auth');
      setBanner('Please sign in or register before adding items to cart.');
      return;
    }
    const res = await fetch(`${CART_URL}/api/cart/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        product_id: product.id,
        product_name: product.name,
        unit_price_cents: product.price_cents,
        quantity: 1,
      }),
    });
    if (res.ok) {
      setCart(await res.json());
      setBanner(`Added ${product.name} to cart.`);
    }
  }

  async function updateCartQty(productId, quantity) {
    const res = await fetch(`${CART_URL}/api/cart/items/${productId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ quantity }),
    });
    if (res.ok) setCart(await res.json());
  }

  async function handleCheckout(e) {
    e.preventDefault();
    if (!token || cart.items.length === 0) return;
    setCheckoutBusy(true);
    setBanner('');
    try {
      const res = await fetch(`${ORDER_URL}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          items: cart.items,
          customer_email: user?.email,
          card: {
            number: cardNumber.replace(/\s+/g, ''),
            cvv: cardCvv,
            exp_month: expMonth,
            exp_year: expYear,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setBanner(data?.error?.message || 'Order creation failed');
        return;
      }
      setActiveOrder(data.order);
      await fetch(`${CART_URL}/api/cart`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      await loadCart();
      await loadOrders();
      setPage('orders');
    } finally {
      setCheckoutBusy(false);
    }
  }

  async function syncOrderPayment(orderId) {
    const res = await fetch(`${ORDER_URL}/api/orders/${orderId}/sync-payment`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      setActiveOrder(data.order);
      await loadOrders();
    }
  }

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 1040, margin: '0 auto', padding: 20 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #ddd', paddingBottom: 12, marginBottom: 20 }}>
        <h2 style={{ margin: 0 }}>CloudOps Store (USD)</h2>
        <nav style={{ display: 'flex', gap: 10 }}>
          <button data-testid="nav-products" onClick={() => setPage('products')}>Products</button>
          <button data-testid="nav-cart" onClick={() => { loadCart(); setPage('cart'); }}>
            Cart ({cart.items.reduce((s, i) => s + i.quantity, 0)})
          </button>
          <button data-testid="nav-orders" onClick={() => { loadOrders(); setPage('orders'); }}>Orders</button>
          {user ? (
            <button onClick={() => { setToken(''); setUser(null); localStorage.removeItem('ecom_token'); }}>
              Logout ({user.email})
            </button>
          ) : (
            <button data-testid="nav-auth" onClick={() => setPage('auth')}>Login / Register</button>
          )}
        </nav>
      </header>

      {banner && (
        <div style={{ background: '#eef6ff', border: '1px solid #99c2ff', padding: 10, borderRadius: 6, marginBottom: 16 }}>
          {banner}
        </div>
      )}

      {page === 'auth' && (
        <form onSubmit={handleAuth} style={{ maxWidth: 400, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h3>{authMode === 'register' ? 'Create Account' : 'Sign In'}</h3>
          {authMode === 'register' && (
            <input data-testid="auth-name" placeholder="Full Name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
          )}
          <input data-testid="auth-email" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <input data-testid="auth-password" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <button data-testid="auth-submit" type="submit">{authMode === 'register' ? 'Register' : 'Login'}</button>
          <button type="button" onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}>
            {authMode === 'login' ? 'Need an account? Register' : 'Have an account? Login'}
          </button>
        </form>
      )}

      {page === 'products' && (
        <div>
          <form onSubmit={handleSearch} style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
            <input
              data-testid="search-input"
              placeholder="Search products..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ flex: 1, padding: 8 }}
            />
            <select data-testid="category-select" value={selectedCategory} onChange={(e) => setSelectedCategory(e.target.value)}>
              <option value="">All Categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.slug}>{c.name}</option>
              ))}
            </select>
            <button data-testid="search-btn" type="submit">Search</button>
            <button type="button" onClick={() => { setSearchQuery(''); setSelectedCategory(''); loadProducts(); }}>Reset</button>
          </form>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
            {products.map((p) => (
              <div key={p.id} data-testid={`product-card-${p.id}`} style={{ border: '1px solid #ddd', borderRadius: 8, padding: 14 }}>
                <div style={{ fontSize: 12, color: '#666' }}>{p.category_name || 'General'}</div>
                <h4 style={{ margin: '6px 0' }}>{p.name}</h4>
                <p style={{ fontSize: 14, color: '#444' }}>{p.description}</p>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
                  <strong>{formatUsd(p.price_cents)}</strong>
                  <button data-testid={`add-to-cart-${p.id}`} onClick={() => addToCart(p)}>Add to Cart</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {page === 'cart' && (
        <div>
          <h3>Your Shopping Cart</h3>
          {cart.items.length === 0 ? (
            <p>Your cart is empty.</p>
          ) : (
            <div>
              {cart.items.map((item) => (
                <div key={item.product_id} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #eee' }}>
                  <div>
                    <strong>{item.product_name}</strong> — {formatUsd(item.unit_price_cents)} each
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button onClick={() => updateCartQty(item.product_id, item.quantity - 1)}>-</button>
                    <span>{item.quantity}</span>
                    <button onClick={() => updateCartQty(item.product_id, item.quantity + 1)}>+</button>
                  </div>
                </div>
              ))}
              <h4>Total: {formatUsd(cart.total_cents)} USD</h4>
              <button data-testid="proceed-checkout" onClick={() => setPage('checkout')}>Proceed to Checkout</button>
            </div>
          )}
        </div>
      )}

      {page === 'checkout' && (
        <form onSubmit={handleCheckout} style={{ maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h3>Checkout — Total: {formatUsd(cart.total_cents)} USD</h3>
          <label>
            Card Number
            <input data-testid="card-number" value={cardNumber} onChange={(e) => setCardNumber(e.target.value)} required style={{ width: '100%', padding: 8 }} />
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input data-testid="card-exp-month" placeholder="MM" value={expMonth} onChange={(e) => setExpMonth(e.target.value)} required />
            <input data-testid="card-exp-year" placeholder="YYYY" value={expYear} onChange={(e) => setExpYear(e.target.value)} required />
            <input data-testid="card-cvv" placeholder="CVV" value={cardCvv} onChange={(e) => setCardCvv(e.target.value)} required />
          </div>
          <button data-testid="submit-payment" type="submit" disabled={checkoutBusy}>
            {checkoutBusy ? 'Processing via PayOps...' : `Pay ${formatUsd(cart.total_cents)}`}
          </button>
        </form>
      )}

      {page === 'orders' && (
        <div>
          <h3>Order Status</h3>
          {activeOrder && (
            <div data-testid="active-order-banner" style={{ border: '2px solid #333', borderRadius: 8, padding: 14, marginBottom: 20 }}>
              <div><strong>Latest Order ID:</strong> {activeOrder.id}</div>
              <div><strong>Payment Intent ID:</strong> {activeOrder.payment_intent_id || 'N/A'}</div>
              <div><strong>Total:</strong> {formatUsd(activeOrder.total_amount_cents)} {activeOrder.currency}</div>
              <div>
                <strong>Status:</strong>{' '}
                <span data-testid="order-status-label">
                  {activeOrder.status === 'PAID' ? 'Paid' : activeOrder.status}
                </span>
              </div>
              {activeOrder.failure_reason && <div style={{ color: 'crimson' }}>Reason: {activeOrder.failure_reason}</div>}
              {activeOrder.status === 'PENDING_PAYMENT' && (
                <button onClick={() => syncOrderPayment(activeOrder.id)} style={{ marginTop: 8 }}>Refresh Payment Status</button>
              )}
            </div>
          )}

          {orders.map((o) => (
            <div key={o.id} style={{ border: '1px solid #ddd', borderRadius: 6, padding: 12, marginBottom: 10 }}>
              <div><strong>Order:</strong> {o.id}</div>
              <div><strong>Amount:</strong> {formatUsd(o.total_amount_cents)} {o.currency}</div>
              <div><strong>Status:</strong> {o.status === 'PAID' ? 'Paid' : o.status}</div>
              <div><strong>PayOps Intent:</strong> {o.payment_intent_id || 'Pending'}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
