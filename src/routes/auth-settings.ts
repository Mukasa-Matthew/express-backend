import express from 'express';
import { AuthSettingsModel } from '../models/AuthSettings';
import { PasswordValidator } from '../utils/passwordValidator';
import { TwoFactorAuth } from '../utils/twoFactorAuth';
import bcrypt from 'bcryptjs';

const router = express.Router();

// Get all authentication settings
router.get('/settings', async (req, res) => {
  try {
    const settings = await AuthSettingsModel.getAllSettings();
    res.json({
      success: true,
      data: settings
    });
  } catch (error) {
    console.error('Get auth settings error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// Update authentication setting
router.put('/settings/:key', async (req, res) => {
  try {
    const { key } = req.params;
    const { value, type } = req.body;
    
    await AuthSettingsModel.setSetting(key, value, type);
    
    res.json({
      success: true,
      message: 'Setting updated successfully'
    });
  } catch (error) {
    console.error('Update auth setting error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// Get password rules
router.get('/password-rules', async (req, res) => {
  try {
    const rules = await AuthSettingsModel.getPasswordRules();
    res.json({
      success: true,
      data: rules
    });
  } catch (error) {
    console.error('Get password rules error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// Update password rules
router.put('/password-rules/:ruleName', async (req, res) => {
  try {
    const { ruleName } = req.params;
    const rules = req.body;
    
    const updatedRule = await AuthSettingsModel.updatePasswordRule(ruleName, rules);
    
    if (!updatedRule) {
      return res.status(404).json({
        success: false,
        message: 'Password rule not found'
      });
    }

    res.json({
      success: true,
      data: updatedRule,
      message: 'Password rules updated successfully'
    });
  } catch (error) {
    console.error('Update password rules error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// Validate password
router.post('/validate-password', async (req, res) => {
  try {
    const { password, userInfo, ruleName } = req.body;
    
    const validation = await PasswordValidator.validatePassword(password, userInfo, ruleName);
    
    res.json({
      success: true,
      data: validation
    });
  } catch (error) {
    console.error('Validate password error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// Generate password
router.post('/generate-password', async (req, res) => {
  try {
    const { length = 12, includeSpecial = true } = req.body;
    
    const password = PasswordValidator.generatePassword(length, includeSpecial);
    
    res.json({
      success: true,
      data: { password }
    });
  } catch (error) {
    console.error('Generate password error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// Get 2FA settings
router.get('/2fa/settings', async (req, res) => {
  try {
    const settings = await AuthSettingsModel.getTwoFactorSettings();
    res.json({
      success: true,
      data: settings
    });
  } catch (error) {
    console.error('Get 2FA settings error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// Update 2FA settings
router.put('/2fa/settings', async (req, res) => {
  try {
    const settings = req.body;
    
    const updatedSettings = await AuthSettingsModel.updateTwoFactorSettings(settings);
    
    res.json({
      success: true,
      data: updatedSettings,
      message: '2FA settings updated successfully'
    });
  } catch (error) {
    console.error('Update 2FA settings error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// Setup 2FA for user
router.post('/2fa/setup/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { email } = req.body;
    
    const setup = await TwoFactorAuth.setupTwoFactor(email);
    
    // Store the secret and backup codes in database
    await AuthSettingsModel.createUserTwoFactor(
      parseInt(userId), 
      setup.secret, 
      setup.backupCodes
    );
    
    res.json({
      success: true,
      data: {
        qrCodeUrl: setup.qrCodeUrl,
        manualEntryKey: setup.manualEntryKey,
        backupCodes: setup.backupCodes
      }
    });
  } catch (error) {
    console.error('Setup 2FA error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// Verify 2FA token
router.post('/2fa/verify/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { token } = req.body;
    
    const user2FA = await AuthSettingsModel.getUserTwoFactor(parseInt(userId));
    
    if (!user2FA || !user2FA.secret_key) {
      return res.status(400).json({
        success: false,
        message: '2FA not set up for this user'
      });
    }
    
    const verification = TwoFactorAuth.verifyTwoFactor(
      user2FA.secret_key,
      token,
      user2FA.backup_codes || []
    );
    
    if (verification.isValid) {
      // Update last used timestamp
      await AuthSettingsModel.getUserTwoFactor(parseInt(userId));
      
      res.json({
        success: true,
        data: { verified: true, backupCodeUsed: verification.backupCodeUsed }
      });
    } else {
      res.json({
        success: false,
        message: 'Invalid token'
      });
    }
  } catch (error) {
    console.error('Verify 2FA error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// Enable 2FA for user
router.post('/2fa/enable/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    await AuthSettingsModel.enableUserTwoFactor(parseInt(userId));
    
    res.json({
      success: true,
      message: '2FA enabled successfully'
    });
  } catch (error) {
    console.error('Enable 2FA error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// Disable 2FA for user
router.post('/2fa/disable/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    await AuthSettingsModel.disableUserTwoFactor(parseInt(userId));
    
    res.json({
      success: true,
      message: '2FA disabled successfully'
    });
  } catch (error) {
    console.error('Disable 2FA error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// Get SSO providers
router.get('/sso/providers', async (req, res) => {
  try {
    const providers = await AuthSettingsModel.getSSOProviders();
    res.json({
      success: true,
      data: providers
    });
  } catch (error) {
    console.error('Get SSO providers error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// Create SSO provider
router.post('/sso/providers', async (req, res) => {
  try {
    const provider = req.body;
    
    const newProvider = await AuthSettingsModel.createSSOProvider(provider);
    
    res.json({
      success: true,
      data: newProvider,
      message: 'SSO provider created successfully'
    });
  } catch (error) {
    console.error('Create SSO provider error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// Update SSO provider
router.put('/sso/providers/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const provider = req.body;
    
    const updatedProvider = await AuthSettingsModel.updateSSOProvider(parseInt(id), provider);
    
    if (!updatedProvider) {
      return res.status(404).json({
        success: false,
        message: 'SSO provider not found'
      });
    }

    res.json({
      success: true,
      data: updatedProvider,
      message: 'SSO provider updated successfully'
    });
  } catch (error) {
    console.error('Update SSO provider error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// Delete SSO provider
router.delete('/sso/providers/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const deleted = await AuthSettingsModel.deleteSSOProvider(parseInt(id));
    
    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: 'SSO provider not found'
      });
    }

    res.json({
      success: true,
      message: 'SSO provider deleted successfully'
    });
  } catch (error) {
    console.error('Delete SSO provider error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

export default router;
