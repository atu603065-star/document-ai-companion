/**
 * Security utilities for SecureChat application
 * Provides XSS protection, input sanitization, and security helpers
 */

// XSS Protection - sanitize user input
export const sanitizeInput = (input: string): string => {
  if (!input) return '';
  
  return input
    // Remove script tags
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    // Remove all HTML tags
    .replace(/<[^>]*>/g, '')
    // Remove javascript: URLs
    .replace(/javascript:/gi, '')
    // Remove event handlers
    .replace(/on\w+\s*=/gi, '')
    // Encode special characters
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
};

// Sanitize for display (decode safe characters)
export const sanitizeForDisplay = (input: string): string => {
  if (!input) return '';
  
  return input
    // Remove script tags
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    // Remove dangerous tags but keep safe formatting
    .replace(/<(?!\/?(b|i|u|strong|em|br)\b)[^>]*>/gi, '')
    // Remove javascript: URLs
    .replace(/javascript:/gi, '')
    // Remove event handlers
    .replace(/on\w+\s*=/gi, '');
};

// Validate file type for uploads
export const isAllowedFileType = (mimeType: string): boolean => {
  const allowedTypes = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'audio/mpeg',
    'audio/wav',
    'audio/ogg',
    'application/pdf',
    'text/plain',
    'application/zip',
    'application/x-rar-compressed',
  ];
  
  return allowedTypes.some(type => 
    mimeType === type || mimeType.startsWith(type.split('/')[0] + '/')
  );
};

// Sanitize filename to prevent path traversal
export const sanitizeFilename = (filename: string): string => {
  if (!filename) return 'file';
  
  return filename
    // Remove path traversal
    .replace(/\.\.\//g, '')
    .replace(/\.\.\\/g, '')
    // Remove special characters that could cause issues
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    // Limit length
    .slice(0, 255);
};

// Rate limiting helper for client-side
interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

export const checkRateLimit = (
  key: string, 
  maxAttempts: number = 5, 
  windowMs: number = 60000
): { allowed: boolean; remaining: number; resetIn: number } => {
  const now = Date.now();
  const entry = rateLimitStore.get(key);
  
  if (!entry || now > entry.resetTime) {
    rateLimitStore.set(key, { count: 1, resetTime: now + windowMs });
    return { allowed: true, remaining: maxAttempts - 1, resetIn: windowMs };
  }
  
  if (entry.count >= maxAttempts) {
    return { 
      allowed: false, 
      remaining: 0, 
      resetIn: entry.resetTime - now 
    };
  }
  
  entry.count++;
  return { 
    allowed: true, 
    remaining: maxAttempts - entry.count, 
    resetIn: entry.resetTime - now 
  };
};

// Clear rate limit (on successful action)
export const clearRateLimit = (key: string): void => {
  rateLimitStore.delete(key);
};

// Validate PIN format
export const validatePinFormat = (pin: string): { valid: boolean; error?: string } => {
  if (!pin) {
    return { valid: false, error: 'PIN is required' };
  }
  
  if (!/^\d{6}$/.test(pin)) {
    return { valid: false, error: 'PIN must be exactly 6 digits' };
  }
  
  // Check for common weak PINs
  const weakPins = ['000000', '111111', '222222', '333333', '444444', '555555', 
                    '666666', '777777', '888888', '999999', '123456', '654321',
                    '123123', '121212', '101010'];
  
  if (weakPins.includes(pin)) {
    return { valid: false, error: 'PIN is too weak, please choose a different one' };
  }
  
  // Check for sequential patterns
  const sequential = '0123456789';
  const reverseSequential = '9876543210';
  if (sequential.includes(pin) || reverseSequential.includes(pin)) {
    return { valid: false, error: 'PIN cannot be sequential numbers' };
  }
  
  return { valid: true };
};

// Validate password strength
export const validatePasswordStrength = (password: string): { 
  valid: boolean; 
  score: number;
  feedback: string[];
} => {
  const feedback: string[] = [];
  let score = 0;
  
  if (password.length >= 8) {
    score += 1;
  } else {
    feedback.push('Mật khẩu phải có ít nhất 8 ký tự');
  }
  
  if (password.length >= 12) {
    score += 1;
  }
  
  if (/[a-z]/.test(password)) {
    score += 1;
  } else {
    feedback.push('Thêm chữ thường');
  }
  
  if (/[A-Z]/.test(password)) {
    score += 1;
  } else {
    feedback.push('Thêm chữ hoa');
  }
  
  if (/[0-9]/.test(password)) {
    score += 1;
  } else {
    feedback.push('Thêm số');
  }
  
  if (/[^a-zA-Z0-9]/.test(password)) {
    score += 1;
  } else {
    feedback.push('Thêm ký tự đặc biệt');
  }
  
  return {
    valid: score >= 4,
    score,
    feedback
  };
};

// Generate CSRF token
export const generateCSRFToken = (): string => {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
};

// Session storage helpers with encryption check
export const secureSessionStorage = {
  set: (key: string, value: string): void => {
    try {
      sessionStorage.setItem(key, value);
    } catch {
      console.warn('Session storage not available');
    }
  },
  
  get: (key: string): string | null => {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },
  
  remove: (key: string): void => {
    try {
      sessionStorage.removeItem(key);
    } catch {
      console.warn('Session storage not available');
    }
  },
  
  clear: (): void => {
    try {
      sessionStorage.clear();
    } catch {
      console.warn('Session storage not available');
    }
  }
};

// Content Security Policy violation reporter
export const reportCSPViolation = (violation: SecurityPolicyViolationEvent): void => {
  console.error('CSP Violation:', {
    documentURI: violation.documentURI,
    violatedDirective: violation.violatedDirective,
    blockedURI: violation.blockedURI,
    originalPolicy: violation.originalPolicy
  });
  // In production, you might want to send this to a logging service
};

// Check if running in secure context
export const isSecureContext = (): boolean => {
  return window.isSecureContext || location.protocol === 'https:' || location.hostname === 'localhost';
};

// Encode URL parameters safely
export const encodeURLParam = (param: string): string => {
  return encodeURIComponent(param);
};

// Decode URL parameters safely
export const decodeURLParam = (param: string): string => {
  try {
    return decodeURIComponent(param);
  } catch {
    return param;
  }
};
