import express from 'express';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { UserModel } from '../models/User';

const router = express.Router();

function requireAuth(req: express.Request, res: express.Response): { userId: number } | null {
  const raw = req.headers.authorization || '';
  const token = raw.startsWith('Bearer ') ? raw.slice(7) : '';
  if (!token) {
    res.status(401).json({ success: false, message: 'No token provided' });
    return null;
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret') as any;
    return { userId: decoded.userId };
  } catch {
    res.status(401).json({ success: false, message: 'Invalid token' });
    return null;
  }
}

// Ensure profile-pictures upload dir exists
const profilePicturesDir = path.join(process.cwd(), 'uploads', 'profile-pictures');
if (!fs.existsSync(profilePicturesDir)) {
  fs.mkdirSync(profilePicturesDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, profilePicturesDir);
  },
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `profile-${unique}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /jpeg|jpg|png|gif|webp/.test(file.mimetype.toLowerCase());
    if (ok) return cb(null, true);
    cb(new Error('Only image files are allowed'));
  },
});

// PUT /api/users/me -> update basic profile (currently name)
router.put('/me', async (req, res) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const { name, username } = req.body as any;
    const update: any = {};
    if (typeof name === 'string' && name.trim().length > 0) {
      update.name = name.trim();
    }
    if (typeof username === 'string') {
      const u = username.trim();
      if (u.length < 3 || u.length > 30) {
        return res.status(400).json({ success: false, message: 'Username must be 3-30 characters' });
      }
      // Check uniqueness (case-insensitive)
      const existing = await UserModel.findByUsername(u);
      if (existing && existing.id !== auth.userId) {
        return res.status(400).json({ success: false, message: 'Username already taken' });
      }
      update.username = u;
    }
    if (Object.keys(update).length === 0) {
      return res.status(400).json({ success: false, message: 'No valid fields to update' });
    }
    const user = await UserModel.update(auth.userId, update);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    return res.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        profile_picture: user.profile_picture,
      },
    });
  } catch (e) {
    console.error('Update /users/me error:', e);
    res.status(500).json({ success: false, message: 'Failed to update profile' });
  }
});

// POST /api/users/me/avatar -> upload avatar (field: file)
router.post('/me/avatar', upload.single('file'), async (req, res) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }
    const publicPath = `/uploads/profile-pictures/${req.file.filename}`;
    const updated = await UserModel.update(auth.userId, { profile_picture: publicPath });
    if (!updated) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    return res.json({ success: true, avatar_url: publicPath });
  } catch (e) {
    console.error('Upload avatar error:', e);
    res.status(500).json({ success: false, message: 'Failed to upload avatar' });
  }
});

export default router;






