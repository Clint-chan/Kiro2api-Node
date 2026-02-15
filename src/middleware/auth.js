/**
 * Authentication Middleware
 * Handles user and admin authentication
 */

import { logger } from '../logger.js';

/**
 * User authentication middleware
 * Validates API key and attaches user to request
 */
export function userAuthMiddleware(db) {
  return (req, res, next) => {
    try {
      // Extract API key from header
      let apiKey = req.headers['x-api-key'];

      // Also check Authorization header (Bearer token)
      if (!apiKey && req.headers.authorization) {
        const authHeader = req.headers.authorization;
        if (authHeader.startsWith('Bearer ')) {
          apiKey = authHeader.substring(7);
        }
      }

      if (!apiKey) {
        return res.status(401).json({
          error: {
            type: 'authentication_error',
            message: 'API key is required. Provide it via x-api-key header or Authorization: Bearer header.'
          }
        });
      }

      // Get user from database
      const user = db.getUserByApiKey(apiKey, 'active');

      if (!user) {
        return res.status(401).json({
          error: {
            type: 'authentication_error',
            message: 'Invalid API key or user is not active.'
          }
        });
      }

      // Attach user to request
      req.user = user;
      next();
    } catch (error) {
      logger.error('User authentication failed', { error });
      return res.status(500).json({
        error: {
          type: 'internal_error',
          message: 'Authentication failed.'
        }
      });
    }
  };
}

/**
 * Admin authentication middleware
 * Validates admin credentials
 */
export function adminAuthMiddleware(db) {
  return (req, res, next) => {
    try {
       // Extract credentials from header
      let credential = req.headers['x-admin-key'] || req.headers['x-api-key'];

      // Also check Authorization header
      if (!credential && req.headers.authorization) {
        const authHeader = req.headers.authorization;
        if (authHeader.startsWith('Bearer ')) {
          credential = authHeader.substring(7);
        }
      }

      if (!credential) {
        return res.status(401).json({
          error: {
            type: 'authentication_error',
            message: 'Admin credentials required.'
          }
        });
      }

      // Check if it's the system admin key
      const systemAdminKey = db.getSetting('admin_key');
      if (credential === systemAdminKey) {
        // System admin
        req.admin = {
          id: 'system',
          username: 'system_admin',
          role: 'admin',
          isSystemAdmin: true
        };
        return next();
      }

      // Check if it's an admin user's API key
      const user = db.getUserByApiKey(credential, 'active');
      if (user && user.role === 'admin') {
        req.admin = {
          id: user.id,
          username: user.username,
          role: user.role,
          isSystemAdmin: false
        };
        return next();
      }

      return res.status(403).json({
        error: {
          type: 'permission_error',
          message: 'Admin access required.'
        }
      });
    } catch (error) {
      logger.error('Admin authentication failed', { error });
      return res.status(500).json({
        error: {
          type: 'internal_error',
          message: 'Authentication failed.'
        }
      });
    }
  };
}

/**
 * Dual authentication middleware (for login)
 * Accepts both user API keys and admin credentials
 */
export function dualAuthMiddleware(db) {
  return (req, res, next) => {
    try {
      // Extract credential from body or header
      const credential = req.body.credential ||
                        req.headers['x-api-key'] ||
                        req.headers.authorization?.replace('Bearer ', '');

      if (!credential) {
        return res.status(401).json({
          error: {
            type: 'authentication_error',
            message: 'Credential required.'
          }
        });
      }

      // Check if it's the system admin key
      const systemAdminKey = db.getSetting('admin_key');
      if (credential === systemAdminKey) {
        const adminPath = db.getSetting('admin_path') || '/admin.html';
        req.authUser = {
          id: 'system',
          username: 'system_admin',
          role: 'admin',
          balance: 0,
          isSystemAdmin: true,
          adminPath: adminPath
        };
        return next();
      }

      // Check if it's a user API key
      const user = db.getUserByApiKey(credential, 'active');
      if (user) {
        req.authUser = {
          id: user.id,
          username: user.username,
          role: user.role,
          api_key: user.api_key,
          balance: user.balance,
          isSystemAdmin: false
        };
        return next();
      }

      return res.status(401).json({
        error: {
          type: 'authentication_error',
          message: 'Invalid credentials.'
        }
      });
    } catch (error) {
      logger.error('Dual authentication failed', { error });
      return res.status(500).json({
        error: {
          type: 'internal_error',
          message: 'Authentication failed.'
        }
      });
    }
  };
}

/**
 * Optional authentication middleware
 * Attaches user if valid API key is provided, but doesn't require it
 */
export function optionalAuthMiddleware(db) {
  return (req, res, next) => {
    try {
      let apiKey = req.headers['x-api-key'];

      if (!apiKey && req.headers.authorization) {
        const authHeader = req.headers.authorization;
        if (authHeader.startsWith('Bearer ')) {
          apiKey = authHeader.substring(7);
        }
      }

      if (apiKey) {
        const user = db.getUserByApiKey(apiKey, 'active');
        if (user) {
          req.user = user;
        }
      }

      next();
    } catch (error) {
      logger.error('Optional authentication failed', { error });
      next();
    }
  };
}
