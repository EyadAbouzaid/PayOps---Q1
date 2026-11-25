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

function getStatusPillClass(status) {
  if (status === 'PAID') return 'status-pill status-paid';
  if (status === 'PAYMENT_FAILED') return 'status-pill status-failed';
  return 'status-pill status-pending';
}

function formatOrderStatus(status) {
  return status === 'PAID' ? 'Paid' : status;
}

export default function App() {
  const [page, setPage] = useState('products');
  const [token, setToken] = useState(localStorage.getItem('ecom_token') || '');
  const [user, setUser] = useState(null);

  // Auth form
  const [authMode, setAuthMode] = useState('login');
  const [email, setEmail] = useState('demo@cloudops.com');
  const [password, setPassword] = useState('password123');
  const [fullName, setFullName] = useState('Demo User');

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
  const [banner, setBanner] = useState(null);

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
    setBanner(null);
    const endpoint = authMode === 'register' ? '/api/auth/register' : '/api/auth/login';
    const body = authMode === 'register' ? { email, password, full_name: fullName } : { email, password };
    const res = await fetch(`${AUTH_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      setBanner({ type: 'error', text: data?.error?.message || 'Authentication failed' });
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
      setBanner({ type: 'info', text: 'Please sign in or register before adding items to cart.' });
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
      setBanner({ type: 'success', text: `Added ${product.name} to cart.` });
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
    setBanner(null);
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
        setBanner({ type: 'error', text: data?.error?.message || 'Order creation failed' });
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

  const cartCount = cart.items.reduce((s, i) => s + i.quantity, 0);

  return (
    <div className="app-shell">
      <header className="navbar">
        <div className="navbar-inner">
          <div className="brand" onClick={() => setPage('products')}>
            <span className="brand-mark">C</span>
            <h2 className="brand-title">CloudOps Store</h2>
            <span className="brand-currency">USD</span>
          </div>

          <nav className="nav-links">
            <button
              type="button"
              data-testid="nav-products"
              className={`nav-pill ${page === 'products' ? 'active' : ''}`}
              onClick={() => setPage('products')}
            >
              Products
            </button>
            <button
              type="button"
              data-testid="nav-cart"
              className={`nav-pill ${page === 'cart' || page === 'checkout' ? 'active' : ''}`}
              onClick={() => {
                loadCart();
                setPage('cart');
              }}
            >
              <span>Cart</span>{' '}
              <span className="cart-badge">({cartCount})</span>
            </button>
            <button
              type="button"
              data-testid="nav-orders"
              className={`nav-pill ${page === 'orders' ? 'active' : ''}`}
              onClick={() => {
                loadOrders();
                setPage('orders');
              }}
            >
              Orders
            </button>
            {user ? (
              <button
                type="button"
                className="nav-pill nav-pill-outline"
                onClick={() => {
                  setToken('');
                  setUser(null);
                  localStorage.removeItem('ecom_token');
                }}
              >
                Logout ({user.email})
              </button>
            ) : (
              <button
                type="button"
                data-testid="nav-auth"
                className={`nav-pill ${page === 'auth' ? 'active' : 'nav-pill-primary'}`}
                onClick={() => setPage('auth')}
              >
                Login / Register
              </button>
            )}
          </nav>
        </div>
      </header>

      <main className="main-container">
        {banner && (
          <div className={`alert-banner alert-${banner.type || 'info'}`} role="status">
            <span>{banner.text}</span>
            <button type="button" className="alert-dismiss" aria-label="Dismiss alert" onClick={() => setBanner(null)}>
              ×
            </button>
          </div>
        )}

        {page === 'auth' && (
          <div className="card auth-card">
            <div className="auth-header">
              <h3 className="auth-title">{authMode === 'register' ? 'Create Account' : 'Sign In'}</h3>
              <p className="auth-subtitle">
                {authMode === 'register'
                  ? 'Create a CloudOps Store account to manage your cart and orders.'
                  : 'Sign in with any email to shop and test PayOps checkout.'}
              </p>
            </div>

            <form onSubmit={handleAuth} className="auth-form">
              {authMode === 'register' && (
                <label className="field-label">
                  Full Name
                  <input
                    className="input"
                    data-testid="auth-name"
                    placeholder="Full Name"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    required
                  />
                </label>
              )}
              <label className="field-label">
                Email
                <input
                  className="input"
                  data-testid="auth-email"
                  type="email"
                  placeholder="Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </label>
              <label className="field-label">
                Password
                <input
                  className="input"
                  data-testid="auth-password"
                  type="password"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </label>

              <button data-testid="auth-submit" type="submit" className="btn btn-primary btn-full">
                {authMode === 'register' ? 'Register' : 'Login'}
              </button>

              <button
                type="button"
                className="btn btn-ghost btn-full"
                onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}
              >
                {authMode === 'login' ? 'Need an account? Register' : 'Have an account? Login'}
              </button>
            </form>

            <div className="demo-hint">
              Demo account: <strong>demo@cloudops.com</strong> / <strong>password123</strong>
            </div>
          </div>
        )}

        {page === 'products' && (
          <div>
            <form onSubmit={handleSearch} className="card search-bar">
              <div className="search-input-wrap">
                <input
                  className="input"
                  data-testid="search-input"
                  placeholder="Search products..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <div className="search-select-wrap">
                <select
                  className="select"
                  data-testid="category-select"
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                >
                  <option value="">All Categories</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.slug}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="search-actions">
                <button data-testid="search-btn" type="submit" className="btn btn-primary">
                  Search
                </button>
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => {
                    setSearchQuery('');
                    setSelectedCategory('');
                    loadProducts();
                  }}
                >
                  Reset
                </button>
              </div>
            </form>

            <div className="product-grid">
              {products.map((p) => (
                <div key={p.id} data-testid={`product-card-${p.id}`} className="card product-card">
                  <div>
                    <span className="category-badge">{p.category_name || 'General'}</span>
                    <h4 className="product-title">{p.name}</h4>
                    <p className="product-desc">{p.description}</p>
                  </div>
                  <div className="product-footer">
                    <strong className="product-price">{formatUsd(p.price_cents)}</strong>
                    <button
                      type="button"
                      className="btn btn-primary"
                      data-testid={`add-to-cart-${p.id}`}
                      onClick={() => addToCart(p)}
                    >
                      Add to Cart
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {page === 'cart' && (
          <div>
            <h3 className="section-title">Your Shopping Cart</h3>
            <div className="card cart-card">
              {cart.items.length === 0 ? (
                <p style={{ margin: 0, color: 'var(--text-muted)' }}>Your cart is empty.</p>
              ) : (
                <div>
                  {cart.items.map((item) => (
                    <div key={item.product_id} className="cart-row">
                      <div>
                        <div style={{ fontWeight: 600, color: 'var(--text-main)' }}>{item.product_name}</div>
                        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                          {formatUsd(item.unit_price_cents)} each
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                        <div className="qty-controls">
                          <button
                            type="button"
                            className="qty-btn"
                            onClick={() => updateCartQty(item.product_id, item.quantity - 1)}
                          >
                            -
                          </button>
                          <span className="qty-value">{item.quantity}</span>
                          <button
                            type="button"
                            className="qty-btn"
                            onClick={() => updateCartQty(item.product_id, item.quantity + 1)}
                          >
                            +
                          </button>
                        </div>
                        <strong style={{ minWidth: 80, textAlign: 'right' }}>
                          {formatUsd(item.unit_price_cents * item.quantity)}
                        </strong>
                      </div>
                    </div>
                  ))}
                  <div className="cart-summary">
                    <h4 style={{ margin: 0, fontSize: 18 }}>Total: {formatUsd(cart.total_cents)} USD</h4>
                    <button
                      type="button"
                      className="btn btn-primary"
                      data-testid="proceed-checkout"
                      onClick={() => setPage('checkout')}
                    >
                      Proceed to Checkout
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {page === 'checkout' && (
          <div className="card checkout-card">
            <h3 className="section-title" style={{ marginBottom: 6 }}>
              Checkout — Total: {formatUsd(cart.total_cents)} USD
            </h3>
            <p style={{ margin: '0 0 18px', fontSize: 13.5, color: 'var(--text-muted)' }}>
              Secured via PayOps mock payment gateway.
            </p>

            <form onSubmit={handleCheckout} className="auth-form">
              <label className="field-label">
                Card Number
                <input
                  className="input"
                  data-testid="card-number"
                  value={cardNumber}
                  onChange={(e) => setCardNumber(e.target.value)}
                  required
                />
              </label>

              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>
                  Quick-fill PayOps test cards
                </div>
                <div className="test-card-chips">
                  <button
                    type="button"
                    className="chip-btn"
                    onClick={() => setCardNumber('4242424242424242')}
                  >
                    4242424242424242 (Paid)
                  </button>
                  <button
                    type="button"
                    className="chip-btn"
                    onClick={() => setCardNumber('4000000000000002')}
                  >
                    4000000000000002 (Declined)
                  </button>
                </div>
              </div>

              <div className="card-row-3">
                <label className="field-label">
                  Month
                  <input
                    className="input"
                    data-testid="card-exp-month"
                    placeholder="MM"
                    value={expMonth}
                    onChange={(e) => setExpMonth(e.target.value)}
                    required
                  />
                </label>
                <label className="field-label">
                  Year
                  <input
                    className="input"
                    data-testid="card-exp-year"
                    placeholder="YYYY"
                    value={expYear}
                    onChange={(e) => setExpYear(e.target.value)}
                    required
                  />
                </label>
                <label className="field-label">
                  CVV
                  <input
                    className="input"
                    data-testid="card-cvv"
                    placeholder="CVV"
                    value={cardCvv}
                    onChange={(e) => setCardCvv(e.target.value)}
                    required
                  />
                </label>
              </div>

              <button
                data-testid="submit-payment"
                type="submit"
                className="btn btn-primary btn-full"
                disabled={checkoutBusy}
              >
                {checkoutBusy ? 'Processing via PayOps...' : `Pay ${formatUsd(cart.total_cents)}`}
              </button>
            </form>
          </div>
        )}

        {page === 'orders' && (
          <div>
            <h3 className="section-title">Order Status</h3>
            {activeOrder && (
              <div data-testid="active-order-banner" className="card active-order-card">
                <div className="order-header-row">
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--primary)', textTransform: 'uppercase' }}>
                      Latest Order
                    </div>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{activeOrder.id}</div>
                  </div>
                  <span data-testid="order-status-label" className={getStatusPillClass(activeOrder.status)}>
                    {formatOrderStatus(activeOrder.status)}
                  </span>
                </div>

                <div className="order-meta">
                  <div>
                    <strong>Payment Intent ID:</strong> {activeOrder.payment_intent_id || 'N/A'}
                  </div>
                  <div>
                    <strong>Total:</strong> {formatUsd(activeOrder.total_amount_cents)} {activeOrder.currency}
                  </div>
                </div>

                {activeOrder.failure_reason && (
                  <div style={{ marginTop: 10, fontSize: 13.5, fontWeight: 500, color: '#B91C1C' }}>
                    Reason: {activeOrder.failure_reason}
                  </div>
                )}

                {activeOrder.status === 'PENDING_PAYMENT' && (
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={() => syncOrderPayment(activeOrder.id)}
                    style={{ marginTop: 12 }}
                  >
                    Refresh Payment Status
                  </button>
                )}
              </div>
            )}

            {orders.length === 0 ? (
              <div className="card order-card" style={{ color: 'var(--text-muted)' }}>
                No orders yet.
              </div>
            ) : (
              orders.map((o) => (
                <div key={o.id} className="card order-card">
                  <div className="order-header-row">
                    <div>
                      <strong>Order:</strong> {o.id}
                    </div>
                    <span className={getStatusPillClass(o.status)}>{formatOrderStatus(o.status)}</span>
                  </div>
                  <div className="order-meta">
                    <div>
                      <strong>Amount:</strong> {formatUsd(o.total_amount_cents)} {o.currency}
                    </div>
                    <div>
                      <strong>PayOps Intent:</strong> {o.payment_intent_id || 'Pending'}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </main>
    </div>
  );
}
