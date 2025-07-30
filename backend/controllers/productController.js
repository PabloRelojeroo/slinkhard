// controllers/productController.js
const { query, transaction } = require('../config/database');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;

// Configuración de multer para subida de imágenes
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/products/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'product-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB max
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten archivos de imagen'), false);
    }
  }
});

class ProductController {
  // Obtener todos los productos con filtros
  static async getProducts(req, res) {
    try {
      const {
        category,
        type,
        status = 'disponible',
        featured,
        search,
        page = 1,
        limit = 12,
        sortBy = 'created_at',
        sortOrder = 'DESC'
      } = req.query;

      let whereConditions = ['p.status = $1'];
      let queryParams = [status];
      let paramCount = 1;

      // Filtrar por categoría
      if (category) {
        paramCount++;
        whereConditions.push(`c.slug = $${paramCount}`);
        queryParams.push(category);
      }

      // Filtrar por tipo de producto
      if (type) {
        paramCount++;
        whereConditions.push(`p.product_type = $${paramCount}`);
        queryParams.push(type);
      }

      // Filtrar productos destacados
      if (featured) {
        paramCount++;
        whereConditions.push(`p.is_featured = $${paramCount}`);
        queryParams.push(featured === 'true');
      }

      // Búsqueda por texto
      if (search) {
        paramCount++;
        whereConditions.push(`(p.name ILIKE $${paramCount} OR p.description ILIKE $${paramCount})`);
        queryParams.push(`%${search}%`);
      }

      // Calcular offset para paginación
      const offset = (page - 1) * limit;
      paramCount++;
      queryParams.push(limit);
      paramCount++;
      queryParams.push(offset);

      const sql = `
        SELECT 
          p.id, p.name, p.description, p.price, p.image_url,
          p.status, p.product_type, p.stock, p.sku, p.is_featured,
          p.created_at, p.updated_at,
          c.name as category_name, c.slug as category_slug
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE ${whereConditions.join(' AND ')}
        ORDER BY p.${sortBy} ${sortOrder}
        LIMIT $${paramCount - 1} OFFSET $${paramCount}
      `;

      const result = await query(sql, queryParams);

      // Obtener el total de productos para paginación
      const countSql = `
        SELECT COUNT(*) as total
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE ${whereConditions.slice(0, -2).join(' AND ')}
      `;
      
      const countResult = await query(countSql, queryParams.slice(0, -2));
      const total = parseInt(countResult.rows[0].total);

      res.json({
        success: true,
        data: {
          products: result.rows,
          pagination: {
            currentPage: parseInt(page),
            totalPages: Math.ceil(total / limit),
            totalProducts: total,
            hasNext: (page * limit) < total,
            hasPrev: page > 1
          }
        }
      });
    } catch (error) {
      console.error('Error obteniendo productos:', error);
      res.status(500).json({
        success: false,
        message: 'Error interno del servidor'
      });
    }
  }

  // Obtener un producto por ID
  static async getProductById(req, res) {
    try {
      const { id } = req.params;

      const sql = `
        SELECT 
          p.*, 
          c.name as category_name, 
          c.slug as category_slug
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE p.id = $1
      `;

      const result = await query(sql, [id]);

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Producto no encontrado'
        });
      }

      res.json({
        success: true,
        data: result.rows[0]
      });
    } catch (error) {
      console.error('Error obteniendo producto:', error);
      res.status(500).json({
        success: false,
        message: 'Error interno del servidor'
      });
    }
  }

  // Crear nuevo producto (solo admin)
  static async createProduct(req, res) {
    try {
      const {
        name,
        description,
        price,
        category_id,
        status = 'disponible',
        product_type = 'normal',
        stock = 0,
        sku,
        weight,
        dimensions,
        is_featured = false
      } = req.body;

      // Validaciones básicas
      if (!name || !price) {
        return res.status(400).json({
          success: false,
          message: 'Nombre y precio son requeridos'
        });
      }

      if (price < 0) {
        return res.status(400).json({
          success: false,
          message: 'El precio no puede ser negativo'
        });
      }

      let image_url = null;
      if (req.file) {
        image_url = `/uploads/products/${req.file.filename}`;
      }

      const sql = `
        INSERT INTO products (
          name, description, price, category_id, image_url,
          status, product_type, stock, sku, weight, dimensions, is_featured
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING *
      `;

      const values = [
        name, description, parseFloat(price), category_id, image_url,
        status, product_type, parseInt(stock), sku, 
        weight ? parseFloat(weight) : null,
        dimensions ? JSON.stringify(dimensions) : null,
        is_featured
      ];

      const result = await query(sql, values);

      res.status(201).json({
        success: true,
        message: 'Producto creado exitosamente',
        data: result.rows[0]
      });
    } catch (error) {
      console.error('Error creando producto:', error);
      
      // Manejar error de SKU duplicado
      if (error.code === '23505' && error.constraint === 'products_sku_key') {
        return res.status(400).json({
          success: false,
          message: 'El SKU ya existe'
        });
      }

      res.status(500).json({
        success: false,
        message: 'Error interno del servidor'
      });
    }
  }

  // Actualizar producto (solo admin)
  static async updateProduct(req, res) {
    try {
      const { id } = req.params;
      const updates = req.body;

      // Construir query dinámicamente
      const fields = [];
      const values = [];
      let paramCount = 1;

      Object.keys(updates).forEach(key => {
        if (updates[key] !== undefined && key !== 'id') {
          fields.push(`${key} = $${paramCount}`);
          
          // Convertir tipos específicos
          if (key === 'price' || key === 'weight') {
            values.push(parseFloat(updates[key]));
          } else if (key === 'stock') {
            values.push(parseInt(updates[key]));
          } else if (key === 'dimensions') {
            values.push(JSON.stringify(updates[key]));
          } else {
            values.push(updates[key]);
          }
          
          paramCount++;
        }
      });

      if (fields.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No hay campos para actualizar'
        });
      }

      // Agregar imagen si se subió una nueva
      if (req.file) {
        fields.push(`image_url = $${paramCount}`);
        values.push(`/uploads/products/${req.file.filename}`);
        paramCount++;
      }

      fields.push(`updated_at = $${paramCount}`);
      values.push(new Date());
      paramCount++;

      values.push(id); // ID para WHERE

      const sql = `
        UPDATE products 
        SET ${fields.join(', ')}
        WHERE id = $${paramCount}
        RETURNING *
      `;

      const result = await query(sql, values);

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Producto no encontrado'
        });
      }

      res.json({
        success: true,
        message: 'Producto actualizado exitosamente',
        data: result.rows[0]
      });
    } catch (error) {
      console.error('Error actualizando producto:', error);
      res.status(500).json({
        success: false,
        message: 'Error interno del servidor'
      });
    }
  }

  // Eliminar producto (solo admin)
  static async deleteProduct(req, res) {
    try {
      const { id } = req.params;

      const result = await query(
        'DELETE FROM products WHERE id = $1 RETURNING image_url',
        [id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Producto no encontrado'
        });
      }

      // Eliminar imagen del servidor si existe
      if (result.rows[0].image_url) {
        try {
          await fs.unlink(path.join(__dirname, '..', result.rows[0].image_url));
        } catch (unlinkError) {
          console.error('Error eliminando imagen:', unlinkError);
        }
      }

      res.json({
        success: true,
        message: 'Producto eliminado exitosamente'
      });
    } catch (error) {
      console.error('Error eliminando producto:', error);
      res.status(500).json({
        success: false,
        message: 'Error interno del servidor'
      });
    }
  }

  // Obtener categorías
  static async getCategories(req, res) {
    try {
      const result = await query(
        'SELECT * FROM categories ORDER BY name ASC'
      );

      res.json({
        success: true,
        data: result.rows
      });
    } catch (error) {
      console.error('Error obteniendo categorías:', error);
      res.status(500).json({
        success: false,
        message: 'Error interno del servidor'
      });
    }
  }
}

module.exports = { ProductController, upload };