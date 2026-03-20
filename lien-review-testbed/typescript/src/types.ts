/**
 * Shared type definitions for the API service.
 */

export enum UserRole {
  Admin = 'admin',
  Editor = 'editor',
  Viewer = 'viewer',
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrderItem {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
}

export interface Order {
  id: string;
  userId: string;
  items: OrderItem[];
  total: number;
  status: 'pending' | 'confirmed' | 'shipped' | 'delivered' | 'cancelled';
  createdAt: Date;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface ValidationRule {
  field: string;
  required?: boolean;
  type?: 'string' | 'number' | 'boolean' | 'email';
  minLength?: number;
  maxLength?: number;
}

export interface NotificationPayload {
  userId: string;
  type: 'email' | 'sms' | 'push';
  subject: string;
  body: string;
}

export interface Request {
  headers: Record<string, string>;
  params: Record<string, string>;
  body: Record<string, unknown>;
  query: Record<string, string>;
}

export interface TransactionContext {
  query: <T>(sql: string, params: unknown[]) => Promise<T[]>;
  queryOne: <T>(sql: string, params: unknown[]) => Promise<T>;
}
