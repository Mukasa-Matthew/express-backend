import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import pool from '../config/database';
import { verifyTokenAndGetUser } from './hostels';

const router = express.Router();

// Configure multer for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(process.cwd(), 'uploads', 'hostel-images');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `hostel-${req.params.id}-${uniqueSuffix}${path.extname(file.originalname)}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (extname && mimetype) {
      cb(null, true);
    } else {
      cb(new Error('Only image files (jpeg, jpg, png, webp) are allowed'));
    }
  }
});

// Upload hostel image (super_admin only)
router.post('/:id/images', upload.single('image'), async (req, res) => {
  const client = await pool.connect();
  try {
    // Verify super admin
    const authResult = await verifyTokenAndGetUser(req);
    if (!authResult || authResult.role !== 'super_admin') {
      if (req.file) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Only super admin can upload images'
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No image file provided'
      });
    }

    const hostelId = parseInt(req.params.id, 10);
    const { caption, is_primary, display_order } = req.body;

    // Verify hostel exists
    const hostelCheck = await client.query(
      'SELECT id FROM hostels WHERE id = $1',
      [hostelId]
    );

    if (hostelCheck.rows.length === 0) {
      fs.unlinkSync(req.file.path);
      return res.status(404).json({
        success: false,
        message: 'Hostel not found'
      });
    }

    await client.query('BEGIN');

    // If this is set as primary, unset other primary images
    if (is_primary === 'true' || is_primary === true) {
      await client.query(
        'UPDATE hostel_images SET is_primary = FALSE WHERE hostel_id = $1',
        [hostelId]
      );
    }

    // Get max display_order if not provided
    let order = display_order ? parseInt(display_order, 10) : 0;
    if (!display_order) {
      const maxOrderResult = await client.query(
        'SELECT COALESCE(MAX(display_order), 0) as max_order FROM hostel_images WHERE hostel_id = $1',
        [hostelId]
      );
      order = (maxOrderResult.rows[0]?.max_order || 0) + 1;
    }

    // Insert image record
    const imageUrl = `/uploads/hostel-images/${req.file.filename}`;
    const result = await client.query(
      `INSERT INTO hostel_images (hostel_id, image_url, caption, is_primary, display_order)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, image_url, caption, is_primary, display_order, created_at`,
      [
        hostelId,
        imageUrl,
        caption || null,
        is_primary === 'true' || is_primary === true,
        order
      ]
    );

    await client.query('COMMIT');

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    await client.query('ROLLBACK');
    if (req.file) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (e) {
        console.error('Failed to delete uploaded file:', e);
      }
    }
    console.error('Error uploading hostel image:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload image'
    });
  } finally {
    client.release();
  }
});

// Delete hostel image (super_admin only)
router.delete('/:id/images/:imageId', async (req, res) => {
  const client = await pool.connect();
  try {
    // Verify super admin
    const authResult = await verifyTokenAndGetUser(req);
    if (!authResult || authResult.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Only super admin can delete images'
      });
    }

    const hostelId = parseInt(req.params.id, 10);
    const imageId = parseInt(req.params.imageId, 10);

    // Get image info
    const imageResult = await client.query(
      'SELECT image_url FROM hostel_images WHERE id = $1 AND hostel_id = $2',
      [imageId, hostelId]
    );

    if (imageResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Image not found'
      });
    }

    const imageUrl = imageResult.rows[0].image_url;
    const filePath = path.join(process.cwd(), imageUrl);

    await client.query('BEGIN');

    // Delete from database
    await client.query(
      'DELETE FROM hostel_images WHERE id = $1 AND hostel_id = $2',
      [imageId, hostelId]
    );

    await client.query('COMMIT');

    // Delete file
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (error) {
      console.error('Failed to delete image file:', error);
    }

    res.json({
      success: true,
      message: 'Image deleted successfully'
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error deleting hostel image:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete image'
    });
  } finally {
    client.release();
  }
});

// Update hostel image (super_admin only) - reorder, set primary, update caption
router.put('/:id/images/:imageId', async (req, res) => {
  const client = await pool.connect();
  try {
    // Verify super admin
    const authResult = await verifyTokenAndGetUser(req);
    if (!authResult || authResult.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Only super admin can update images'
      });
    }

    const hostelId = parseInt(req.params.id, 10);
    const imageId = parseInt(req.params.imageId, 10);
    const { caption, is_primary, display_order } = req.body;

    // Verify image exists
    const imageCheck = await client.query(
      'SELECT id FROM hostel_images WHERE id = $1 AND hostel_id = $2',
      [imageId, hostelId]
    );

    if (imageCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Image not found'
      });
    }

    await client.query('BEGIN');

    // If setting as primary, unset other primary images
    if (is_primary === true || is_primary === 'true') {
      await client.query(
        'UPDATE hostel_images SET is_primary = FALSE WHERE hostel_id = $1 AND id != $2',
        [hostelId, imageId]
      );
    }

    // Build update query
    const updates: string[] = [];
    const params: any[] = [];
    let paramCount = 0;

    if (caption !== undefined) {
      paramCount++;
      updates.push(`caption = $${paramCount}`);
      params.push(caption);
    }

    if (is_primary !== undefined) {
      paramCount++;
      updates.push(`is_primary = $${paramCount}`);
      params.push(is_primary === true || is_primary === 'true');
    }

    if (display_order !== undefined) {
      paramCount++;
      updates.push(`display_order = $${paramCount}`);
      params.push(parseInt(display_order, 10));
    }

    if (updates.length === 0) {
      await client.query('COMMIT');
      return res.status(400).json({
        success: false,
        message: 'No fields to update'
      });
    }

    paramCount++;
    params.push(imageId);
    paramCount++;
    params.push(hostelId);

    const updateQuery = `
      UPDATE hostel_images
      SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE id = $${paramCount - 1} AND hostel_id = $${paramCount}
      RETURNING id, image_url, caption, is_primary, display_order, updated_at
    `;

    const result = await client.query(updateQuery, params);

    await client.query('COMMIT');

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error updating hostel image:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update image'
    });
  } finally {
    client.release();
  }
});

// Update hostel publish status and coordinates (super_admin only)
router.put('/:id/publish', async (req, res) => {
  try {
    // Verify super admin
    const authResult = await verifyTokenAndGetUser(req);
    if (!authResult || authResult.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Only super admin can publish hostels'
      });
    }

    const hostelId = parseInt(req.params.id, 10);
    const { is_published, latitude, longitude } = req.body;

    // Verify hostel exists
    const hostelCheck = await pool.query(
      'SELECT id FROM hostels WHERE id = $1',
      [hostelId]
    );

    if (hostelCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Hostel not found'
      });
    }

    // Build update query
    const updates: string[] = [];
    const params: any[] = [];
    let paramCount = 0;

    if (is_published !== undefined) {
      paramCount++;
      updates.push(`is_published = $${paramCount}`);
      params.push(is_published === true || is_published === 'true');
    }

    if (latitude !== undefined) {
      paramCount++;
      updates.push(`latitude = $${paramCount}`);
      params.push(parseFloat(latitude));
    }

    if (longitude !== undefined) {
      paramCount++;
      updates.push(`longitude = $${paramCount}`);
      params.push(parseFloat(longitude));
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No fields to update'
      });
    }

    paramCount++;
    params.push(hostelId);

    const updateQuery = `
      UPDATE hostels
      SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE id = $${paramCount}
      RETURNING id, name, is_published, latitude, longitude
    `;

    const result = await pool.query(updateQuery, params);

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating hostel publish status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update hostel'
    });
  }
});

// Get hostel images (admin endpoint - doesn't require published status)
router.get('/:id/images', async (req, res) => {
  try {
    // Verify super admin
    const authResult = await verifyTokenAndGetUser(req);
    if (!authResult || authResult.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Only super admin can view images'
      });
    }

    const hostelId = parseInt(req.params.id, 10);

    // Verify hostel exists
    const hostelCheck = await pool.query(
      'SELECT id FROM hostels WHERE id = $1',
      [hostelId]
    );

    if (hostelCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Hostel not found'
      });
    }

    const query = `
      SELECT 
        id,
        image_url,
        caption,
        is_primary,
        display_order,
        created_at
      FROM hostel_images
      WHERE hostel_id = $1
      ORDER BY is_primary DESC, display_order ASC, created_at ASC
    `;

    const result = await pool.query(query, [hostelId]);

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Error fetching hostel images:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch hostel images'
    });
  }
});

export default router;

