// frontend/js/api.js - Cliente API
class ApiClient {
  constructor() {
    this.baseURL = 'http://localhost:3000/api'; // Cambiar en producción
    this.token = localStorage.getItem('authToken');
  }

  // Helper para hacer requests
  async request(endpoint, options = {}) {
    const url = `${this.baseURL}${endpoint}`;
    const config = {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      },
      ...options
    };

    if (this.token) {
      config.headers.Authorization = `Bearer ${this.token}`;
    }

    try {
      const response = await fetch(url, config);
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.message || 'Error en la petición');
      }
      
      return data;
    } catch (error) {
      console.error('API Error:', error);
      throw error;
    }
  }

  // Métodos de autenticación
  async login(email, password) {
    const response = await this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
    
    if (response.success) {
      this.token = response.data.token;
      localStorage.setItem('authToken', this.token);
      localStorage.setItem('currentUser', JSON.stringify(response.data.user));
    }
    
    return response;
  }

  async register(userData) {
    const response = await this.request('/auth/register', {
      method: 'POST',
      body: JSON.stringify(userData)
    });
    
    if (response.success) {
      this.token = response.data.token;
      localStorage.setItem('authToken', this.token);
      localStorage.setItem('currentUser', JSON.stringify(response.data.user));
    }
    
    return response;
  }

  async logout() {
    await this.request('/auth/logout', { method: 'POST' });
    this.token = null;
    localStorage.removeItem('authToken');
    localStorage.removeItem('currentUser');
  }

  // Métodos de productos
  async getProducts(filters = {}) {
    const params = new URLSearchParams(filters);
    return await this.request(`/products?${params}`);
  }

  async getProduct(id) {
    return await this.request(`/products/${id}`);
  }

  async createProduct(productData) {
    return await this.request('/products', {
      method: 'POST',
      body: JSON.stringify(productData)
    });
  }

  async updateProduct(id, productData) {
    return await this.request(`/products/${id}`, {
      method: 'PUT',
      body: JSON.stringify(productData)
    });
  }

  async deleteProduct(id) {
    return await this.request(`/products/${id}`, {
      method: 'DELETE'
    });
  }

  // Métodos de órdenes
  async createOrder(orderData) {
    return await this.request('/orders', {
      method: 'POST',
      body: JSON.stringify(orderData)
    });
  }

  async getOrders() {
    return await this.request('/orders');
  }

  async getOrder(id) {
    return await this.request(`/orders/${id}`);
  }

  // Métodos de carrito
  async getCart() {
    return await this.request('/cart');
  }

  async addToCart(productId, quantity = 1) {
    return await this.request('/cart/add', {
      method: 'POST',
      body: JSON.stringify({ product_id: productId, quantity })
    });
  }

  async updateCartItem(productId, quantity) {
    return await this.request('/cart/update', {
      method: 'PUT',
      body: JSON.stringify({ product_id: productId, quantity })
    });
  }

  async removeFromCart(productId) {
    return await this.request(`/cart/remove/${productId}`, {
      method: 'DELETE'
    });
  }

  async clearCart() {
    return await this.request('/cart/clear', {
      method: 'DELETE'
    });
  }

  // Métodos de pagos
  async createPaymentPreference(orderId) {
    return await this.request('/payments/preference', {
      method: 'POST',
      body: JSON.stringify({ order_id: orderId })
    });
  }

  async getPaymentMethods() {
    return await this.request('/payments/methods');
  }

  async checkPaymentStatus(orderId) {
    return await this.request(`/payments/status/${orderId}`);
  }

  // Upload de archivos
  async uploadProductImage(file) {
    const formData = new FormData();
    formData.append('image', file);
    
    return await this.request('/products/upload-image', {
      method: 'POST',
      headers: {}, // No establecer Content-Type para FormData
      body: formData
    });
  }
}

// Instancia global del cliente API
const api = new ApiClient();

// Actualizar el JavaScript principal para usar la API
class SlinkHardApp {
  constructor() {
    this.cart = [];
    this.currentUser = null;
    this.products = [];
    this.init();
  }

  async init() {
    this.loadUserFromStorage();
    await this.loadProducts();
    this.updateCartCount();
    this.setupEventListeners();
  }

  loadUserFromStorage() {
    const savedUser = localStorage.getItem('currentUser');
    if (savedUser) {
      this.currentUser = JSON.parse(savedUser);
      this.updateUserInterface();
    }
  }

  async loadProducts() {
    try {
      const response = await api.getProducts();
      if (response.success) {
        this.products = response.data.products;
        this.displayProducts();
      }
    } catch (error) {
      console.error('Error cargando productos:', error);
      this.showNotification('Error cargando productos', 'error');
    }
  }

  displayProducts() {
    this.displayProductsInContainer(this.products, 'featuredProducts');
    this.displayProductsInContainer(
      this.products.filter(p => p.product_type === 'oferta'), 
      'offersProducts'
    );
    this.displayProductsInContainer(
      this.products.filter(p => p.product_type === 'usado'), 
      'usedProducts'
    );
  }

  displayProductsInContainer(productList, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = productList.map(product => `
      <div class="product-card">
        ${product.product_type !== 'normal' ? 
          `<div class="product-badge badge-${product.product_type}">
            ${this.getBadgeText(product.product_type)}
          </div>` : ''}
        <img src="${product.image_url || 'https://via.placeholder.com/300x250?text=Sin+Imagen'}" 
             alt="${product.name}" 
             class="product-image"
             onerror="this.src='https://via.placeholder.com/300x250?text=Imagen+No+Disponible'">
        <div class="product-info">
          <div class="product-title">${product.name}</div>
          <div class="product-price">$${parseFloat(product.price).toLocaleString()}</div>
          <div class="product-status">
            ${product.status === 'disponible' ? 'Disponible' : 'Agotado'}
            ${product.stock > 0 ? ` (${product.stock} unidades)` : ''}
          </div>
          <button class="add-to-cart" 
                  onclick="app.addToCart('${product.id}')" 
                  ${product.status !== 'disponible' ? 'disabled' : ''}>
            ${product.status === 'disponible' ? 'Agregar al Carrito' : 'No Disponible'}
          </button>
        </div>
      </div>
    `).join('');
  }

  getBadgeText(type) {
    const badges = {
      'oferta': 'OFERTA',
      'nuevo': 'NUEVO',
      'usado': 'USADO',
      'unico': 'ÚNICO'
    };
    return badges[type] || '';
  }

  async addToCart(productId) {
    try {
      if (!this.currentUser) {
        this.showNotification('Debes iniciar sesión para agregar productos al carrito', 'warning');
        this.showLogin();
        return;
      }

      const response = await api.addToCart(productId);
      if (response.success) {
        await this.loadCart();
        this.showNotification('Producto agregado al carrito', 'success');
      }
    } catch (error) {
      console.error('Error agregando al carrito:', error);
      this.showNotification('Error agregando producto al carrito', 'error');
    }
  }

  async loadCart() {
    try {
      if (!this.currentUser) return;
      
      const response = await api.getCart();
      if (response.success) {
        this.cart = response.data;
        this.updateCartCount();
      }
    } catch (error) {
      console.error('Error cargando carrito:', error);
    }
  }

  updateCartCount() {
    const totalItems = this.cart.reduce((sum, item) => sum + item.quantity, 0);
    document.getElementById('cartCount').textContent = totalItems;
  }

  async login() {
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;

    if (!email || !password) {
      this.showNotification('Por favor completa todos los campos', 'warning');
      return;
    }

    try {
      const response = await api.login(email, password);
      if (response.success) {
        this.currentUser = response.data.user;
        this.updateUserInterface();
        this.closeModal('loginModal');
        await this.loadCart();
        this.showNotification('¡Bienvenido a SlinkHard!', 'success');
      }
    } catch (error) {
      this.showNotification(error.message || 'Error al iniciar sesión', 'error');
    }
  }

  async register() {
    const name = document.getElementById('registerName').value;
    const email = document.getElementById('registerEmail').value;
    const password = document.getElementById('registerPassword').value;

    if (!name || !email || !password) {
      this.showNotification('Por favor completa todos los campos', 'warning');
      return;
    }

    try {
      const response = await api.register({ name, email, password });
      if (response.success) {
        this.currentUser = response.data.user;
        this.updateUserInterface();
        this.closeModal('registerModal');
        await this.loadCart();
        this.showNotification('¡Cuenta creada exitosamente!', 'success');
      }
    } catch (error) {
      this.showNotification(error.message || 'Error al crear cuenta', 'error');
    }
  }

  async logout() {
    try {
      await api.logout();
      this.currentUser = null;
      this.cart = [];
      this.updateUserInterface();
      this.updateCartCount();
      this.showHome();
      this.showNotification('Sesión cerrada correctamente', 'success');
    } catch (error) {
      console.error('Error al cerrar sesión:', error);
    }
  }

  async checkout() {
    if (!this.currentUser) {
      this.showNotification('Debes iniciar sesión para realizar una compra', 'warning');
      this.showLogin();
      return;
    }

    if (this.cart.length === 0) {
      this.showNotification('Tu carrito está vacío', 'warning');
      return;
    }

    this.closeModal('cartModal');
    this.showModal('checkoutModal');
  }

  async finalizeOrder() {
    const address = document.getElementById('shippingAddress').value;
    const paymentMethod = document.getElementById('paymentMethod').value;

    if (!address) {
      this.showNotification('Por favor ingresa tu dirección de envío', 'warning');
      return;
    }

    try {
      // Crear orden
      const orderResponse = await api.createOrder({
        items: this.cart,
        shipping_address: address,
        payment_method: paymentMethod
      });

      if (orderResponse.success) {
        const orderId = orderResponse.data.id;

        if (paymentMethod === 'mercadopago') {
          // Crear preferencia de pago
          const preferenceResponse = await api.createPaymentPreference(orderId);
          if (preferenceResponse.success) {
            window.open(preferenceResponse.data.init_point, '_blank');
          }
        }

        this.closeModal('checkoutModal');
        await this.loadCart();
        this.showNotification(`¡Pedido confirmado! ID: #${orderId}`, 'success');
      }
    } catch (error) {
      console.error('Error finalizando orden:', error);
      this.showNotification('Error procesando la orden', 'error');
    }
  }

  updateUserInterface() {
    if (this.currentUser) {
      document.getElementById('loginBtn').style.display = 'none';
      document.getElementById('registerBtn').style.display = 'none';
      document.getElementById('accountBtn').style.display = 'inline-block';
      document.getElementById('logoutBtn').style.display = 'inline-block';
      
      if (this.currentUser.role === 'admin') {
        document.getElementById('adminBtn').style.display = 'inline-block';
      }
    } else {
      document.getElementById('loginBtn').style.display = 'inline-block';
      document.getElementById('registerBtn').style.display = 'inline-block';
      document.getElementById('accountBtn').style.display = 'none';
      document.getElementById('logoutBtn').style.display = 'none';
      document.getElementById('adminBtn').style.display = 'none';
    }
  }

  showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.textContent = message;
    notification.className = `notification notification-${type}`;
    notification.style.cssText = `
      position: fixed;
      top: 100px;
      right: 20px;
      background: ${type === 'error' ? '#e74c3c' : type === 'warning' ? '#f39c12' : '#27ae60'};
      color: white;
      padding: 1rem;
      border-radius: 8px;
      z-index: 3000;
      animation: slideIn 0.3s ease;
      max-width: 300px;
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
      notification.remove();
    }, 5000);
  }

  setupEventListeners() {
    // Enter key en search
    document.getElementById('searchInput').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.searchProducts();
      }
    });

    // Close modals on outside click
    window.onclick = (event) => {
      const modals = document.querySelectorAll('.modal');
      modals.forEach(modal => {
        if (event.target === modal) {
          modal.style.display = 'none';
        }
      });
    };
  }

  // Métodos para mostrar/cerrar modales
  showModal(modalId) {
    document.getElementById(modalId).style.display = 'block';
  }

  closeModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
  }

  showLogin() {
    this.showModal('loginModal');
  }

  showRegister() {
    this.showModal('registerModal');
  }

  showCart() {
    this.displayCart();
    this.showModal('cartModal');
  }

  showHome() {
    document.getElementById('homeContent').style.display = 'block';
    document.getElementById('userAccount').style.display = 'none';
    document.getElementById('adminPanel').style.display = 'none';
    this.loadProducts();
  }

  async displayCart() {
    const container = document.getElementById('cartItems');
    
    if (this.cart.length === 0) {
      container.innerHTML = '<p style="text-align: center; color: #666;">Tu carrito está vacío</p>';
      document.getElementById('cartTotal').textContent = 'Total: $0';
      return;
    }

    container.innerHTML = this.cart.map(item => `
      <div class="cart-item">
        <img src="${item.image_url || 'https://via.placeholder.com/60x60?text=No+Img'}" 
             alt="${item.name}">
        <div class="cart-item-info">
          <div><strong>${item.name}</strong></div>
          <div>$${parseFloat(item.unit_price).toLocaleString()}</div>
        </div>
        <div class="cart-item-controls">
          <button class="quantity-btn" onclick="app.updateCartQuantity('${item.product_id}', ${item.quantity - 1})">-</button>
          <span style="margin: 0 1rem;">${item.quantity}</span>
          <button class="quantity-btn" onclick="app.updateCartQuantity('${item.product_id}', ${item.quantity + 1})">+</button>
          <button onclick="app.removeFromCart('${item.product_id}')" 
                  style="background: #e74c3c; color: white; border: none; padding: 0.5rem; margin-left: 1rem; border-radius: 5px; cursor: pointer;">
            Eliminar
          </button>
        </div>
      </div>
    `).join('');

    const total = this.cart.reduce((sum, item) => sum + (item.unit_price * item.quantity), 0);
    document.getElementById('cartTotal').textContent = `Total: $${total.toLocaleString()}`;
  }

  async updateCartQuantity(productId, newQuantity) {
    if (newQuantity <= 0) {
      await this.removeFromCart(productId);
      return;
    }

    try {
      const response = await api.updateCartItem(productId, newQuantity);
      if (response.success) {
        await this.loadCart();
        this.displayCart();
      }
    } catch (error) {
      console.error('Error actualizando carrito:', error);
      this.showNotification('Error actualizando carrito', 'error');
    }
  }

  async removeFromCart(productId) {
    try {
      const response = await api.removeFromCart(productId);
      if (response.success) {
        await this.loadCart();
        this.displayCart();
        this.showNotification('Producto eliminado del carrito', 'success');
      }
    } catch (error) {
      console.error('Error eliminando del carrito:', error);
      this.showNotification('Error eliminando producto', 'error');
    }
  }

  async searchProducts() {
    const query = document.getElementById('searchInput').value;
    try {
      const response = await api.getProducts({ search: query });
      if (response.success) {
        this.displaySearchResults(response.data.products, query);
      }
    } catch (error) {
      console.error('Error buscando productos:', error);
      this.showNotification('Error en la búsqueda', 'error');
    }
  }

  displaySearchResults(products, query) {
    document.getElementById('homeContent').innerHTML = `
      <section class="section">
        <h2 class="section-title">Resultados de búsqueda para: "${query}"</h2>
        <div class="products-grid" id="searchResults"></div>
      </section>
    `;
    this.displayProductsInContainer(products, 'searchResults');
  }
}

// Inicializar la aplicación
const app = new SlinkHardApp();