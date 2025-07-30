// controllers/paymentController.js
const { query, transaction } = require('../config/database');
const MercadoPagoService = require('../config/mercadopago');

class PaymentController {
  // Crear una preferencia de pago
  static async createPaymentPreference(req, res) {
    try {
      const { order_id } = req.body;
      const userId = req.user.id;

      // Obtener datos de la orden
      const orderResult = await query(`
        SELECT 
          o.*,
          json_agg(
            json_build_object(
              'product_id', oi.product_id,
              'name', p.name,
              'quantity', oi.quantity,
              'unit_price', oi.unit_price,
              'image_url', p.image_url
            )
          ) as items
        FROM orders o
        LEFT JOIN order_items oi ON o.id = oi.order_id
        LEFT JOIN products p ON oi.product_id = p.id
        WHERE o.id = $1 AND o.user_id = $2
        GROUP BY o.id
      `, [order_id, userId]);

      if (orderResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Orden no encontrada'
        });
      }

      const order = orderResult.rows[0];

      // Verificar que la orden esté en estado pendiente
      if (order.status !== 'pendiente') {
        return res.status(400).json({
          success: false,
          message: 'La orden no está en estado válido para pago'
        });
      }

      // Obtener datos del usuario
      const userResult = await query(
        'SELECT name, email, phone FROM users WHERE id = $1',
        [userId]
      );

      const orderData = {
        order_id: order.id,
        items: order.items,
        user: userResult.rows[0],
        shipping_address: order.shipping_address
      };

      // Crear preferencia en MercadoPago
      const preference = await MercadoPagoService.createPreference(orderData);

      // Guardar referencia del pago
      await query(`
        INSERT INTO payments (order_id, payment_method, amount, currency, status, external_id)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [order_id, 'mercadopago', order.total, 'ARS', 'pending', preference.preference_id]);

      res.json({
        success: true,
        data: {
          preference_id: preference.preference_id,
          init_point: preference.init_point,
          sandbox_init_point: preference.sandbox_init_point
        }
      });
    } catch (error) {
      console.error('Error creando preferencia de pago:', error);
      res.status(500).json({
        success: false,
        message: 'Error procesando la solicitud de pago'
      });
    }
  }

  // Webhook de MercadoPago
  static async handleWebhook(req, res) {
    try {
      const notification = req.body;
      
      console.log('Webhook recibido de MercadoPago:', notification);

      const paymentData = await MercadoPagoService.processWebhook(notification);
      
      if (!paymentData) {
        return res.status(200).send('OK');
      }

      // Actualizar estado del pago en la base de datos
      await transaction(async (client) => {
        // Actualizar pago
        await client.query(`
          UPDATE payments 
          SET 
            status = $1,
            gateway_response = $2,
            updated_at = CURRENT_TIMESTAMP
          WHERE external_id = $3 OR order_id = $4
        `, [
          paymentData.status,
          JSON.stringify(paymentData),
          paymentData.payment_id,
          paymentData.external_reference
        ]);

        // Actualizar estado de la orden según el estado del pago
        let orderStatus = 'pendiente';
        
        if (MercadoPagoService.isPaymentApproved(paymentData.status)) {
          orderStatus = 'pagado';
          
          // Reducir stock de productos
          const orderItems = await client.query(`
            SELECT oi.product_id, oi.quantity, p.stock, p.product_type
            FROM order_items oi
            JOIN products p ON oi.product_id = p.id
            WHERE oi.order_id = $1
          `, [paymentData.external_reference]);

          for (const item of orderItems.rows) {
            if (item.product_type === 'unico') {
              // Productos únicos se marcan como agotados
              await client.query(
                'UPDATE products SET status = $1, stock = 0 WHERE id = $2',
                ['agotado', item.product_id]
              );
            } else {
              // Reducir stock de productos normales
              const newStock = Math.max(0, item.stock - item.quantity);
              const newStatus = newStock === 0 ? 'agotado' : 'disponible';
              
              await client.query(
                'UPDATE products SET stock = $1, status = $2 WHERE id = $3',
                [newStock, newStatus, item.product_id]
              );
            }
          }
        } else if (MercadoPagoService.isPaymentRejected(paymentData.status)) {
          orderStatus = 'cancelado';
        }

        await client.query(`
          UPDATE orders 
          SET 
            status = $1,
            payment_id = $2,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = $3
        `, [orderStatus, paymentData.payment_id, paymentData.external_reference]);
      });

      console.log(`Pago procesado: ${paymentData.payment_id} - Estado: ${paymentData.status}`);
      
      res.status(200).send('OK');
    } catch (error) {
      console.error('Error procesando webhook:', error);
      res.status(500).send('Error');
    }
  }

  // Verificar estado de pago
  static async checkPaymentStatus(req, res) {
    try {
      const { order_id } = req.params;
      const userId = req.user.id;

      const result = await query(`
        SELECT 
          p.*,
          o.status as order_status
        FROM payments p
        JOIN orders o ON p.order_id = o.id
        WHERE p.order_id = $1 AND o.user_id = $2
        ORDER BY p.created_at DESC
        LIMIT 1
      `, [order_id, userId]);

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Pago no encontrado'
        });
      }

      const payment = result.rows[0];

      res.json({
        success: true,
        data: {
          payment_id: payment.id,
          status: payment.status,
          amount: payment.amount,
          currency: payment.currency,
          order_status: payment.order_status,
          created_at: payment.created_at,
          updated_at: payment.updated_at
        }
      });
    } catch (error) {
      console.error('Error verificando estado de pago:', error);
      res.status(500).json({
        success: false,
        message: 'Error verificando el pago'
      });
    }
  }

  // Obtener métodos de pago disponibles
  static async getPaymentMethods(req, res) {
    try {
      const methods = [
        {
          id: 'mercadopago',
          name: 'MercadoPago',
          description: 'Tarjetas de crédito, débito, efectivo y más',
          enabled: true,
          fees: 0 // Sin comisiones adicionales para el cliente
        },
        {
          id: 'transferencia',
          name: 'Transferencia Bancaria',
          description: 'Transferencia directa a cuenta bancaria',
          enabled: true,
          fees: 0,
          bank_info: {
            bank: 'Banco Nación',
            account_number: '1234567890',
            cbu: '0110599520000012345678',
            alias: 'SLINKHARD.TIENDA'
          }
        },
        {
          id: 'efectivo',
          name: 'Efectivo',
          description: 'Pago en efectivo al retirar en local',
          enabled: true,
          fees: 0
        }
      ];

      res.json({
        success: true,
        data: methods
      });
    } catch (error) {
      console.error('Error obteniendo métodos de pago:', error);
      res.status(500).json({
        success: false,
        message: 'Error obteniendo métodos de pago'
      });
    }
  }

  // Procesar pago manual (transferencia/efectivo)
  static async processManualPayment(req, res) {
    try {
      const { order_id, payment_method, payment_proof } = req.body;
      const userId = req.user.id;

      // Validar que la orden pertenezca al usuario
      const orderResult = await query(
        'SELECT * FROM orders WHERE id = $1 AND user_id = $2 AND status = $3',
        [order_id, userId, 'pendiente']
      );

      if (orderResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Orden no encontrada o no válida'
        });
      }

      const order = orderResult.rows[0];

      // Crear registro de pago manual
      const paymentResult = await query(`
        INSERT INTO payments (order_id, payment_method, amount, currency, status, gateway_response)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `, [
        order_id,
        payment_method,
        order.total,
        'ARS',
        'pending',
        JSON.stringify({ 
          type: 'manual', 
          proof: payment_proof,
          submitted_at: new Date().toISOString()
        })
      ]);

      res.json({
        success: true,
        message: 'Comprobante de pago enviado. Será verificado en las próximas 24 horas.',
        data: {
          payment_id: paymentResult.rows[0].id,
          status: 'pending'
        }
      });
    } catch (error) {
      console.error('Error procesando pago manual:', error);
      res.status(500).json({
        success: false,
        message: 'Error procesando el pago'
      });
    }
  }
}

module.exports = PaymentController;