// config/mercadopago.js
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');

// Configurar MercadoPago
const client = new MercadoPagoConfig({
  accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN,
  options: {
    timeout: 5000,
    idempotencyKey: 'abc'
  }
});

const preference = new Preference(client);
const payment = new Payment(client);

class MercadoPagoService {
  // Crear preferencia de pago
  static async createPreference(orderData) {
    try {
      const preferenceData = {
        items: orderData.items.map(item => ({
          id: item.product_id,
          title: item.name,
          quantity: item.quantity,
          unit_price: parseFloat(item.unit_price),
          currency_id: 'ARS',
          picture_url: item.image_url ? `${process.env.FRONTEND_URL}${item.image_url}` : null
        })),
        payer: {
          name: orderData.user.name,
          email: orderData.user.email,
          phone: {
            area_code: '11',
            number: orderData.user.phone || '1234567890'
          },
          address: {
            street_name: orderData.shipping_address,
            zip_code: '1000'
          }
        },
        payment_methods: {
          excluded_payment_methods: [],
          excluded_payment_types: [],
          installments: 12
        },
        shipments: {
          cost: 0,
          mode: 'not_specified'
        },
        back_urls: {
          success: `${process.env.FRONTEND_URL}/payment/success`,
          failure: `${process.env.FRONTEND_URL}/payment/failure`,
          pending: `${process.env.FRONTEND_URL}/payment/pending`
        },
        auto_return: 'approved',
        external_reference: orderData.order_id,
        notification_url: `${process.env.BACKEND_URL}/api/payments/webhook`,
        statement_descriptor: 'SLINKHARD',
        expires: true,
        expiration_date_from: new Date().toISOString(),
        expiration_date_to: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24 horas
      };

      const result = await preference.create({ body: preferenceData });
      
      return {
        success: true,
        preference_id: result.id,
        init_point: result.init_point,
        sandbox_init_point: result.sandbox_init_point
      };
    } catch (error) {
      console.error('Error creando preferencia de MercadoPago:', error);
      throw new Error('Error procesando el pago');
    }
  }

  // Obtener información de un pago
  static async getPayment(paymentId) {
    try {
      const result = await payment.get({ id: paymentId });
      return result;
    } catch (error) {
      console.error('Error obteniendo pago de MercadoPago:', error);
      throw error;
    }
  }

  // Procesar webhook de notificación
  static async processWebhook(notificationData) {
    try {
      const { type, data } = notificationData;

      if (type === 'payment') {
        const paymentInfo = await this.getPayment(data.id);
        
        return {
          payment_id: paymentInfo.id,
          status: paymentInfo.status,
          status_detail: paymentInfo.status_detail,
          external_reference: paymentInfo.external_reference,
          transaction_amount: paymentInfo.transaction_amount,
          currency_id: paymentInfo.currency_id,
          payment_method: {
            id: paymentInfo.payment_method_id,
            type: paymentInfo.payment_type_id
          },
          payer: paymentInfo.payer,
          date_created: paymentInfo.date_created,
          date_approved: paymentInfo.date_approved
        };
      }

      return null;
    } catch (error) {
      console.error('Error procesando webhook de MercadoPago:', error);
      throw error;
    }
  }

  // Validar estado del pago
  static isPaymentApproved(status) {
    return status === 'approved';
  }

  static isPaymentRejected(status) {
    return ['rejected', 'cancelled'].includes(status);
  }

  static isPaymentPending(status) {
    return ['pending', 'in_process', 'in_mediation'].includes(status);
  }
}

module.exports = MercadoPagoService;