import { describe, it, expect } from 'vitest';
import { getUser, createUser, updateUser, deleteUser, listUsers } from '../user-service.js';

describe('User Service', () => {
  describe('getUser', () => {
    it('should return a user by ID', async () => {
      const user = await getUser('usr_test_001');
      expect(user).toBeDefined();
      expect(user.id).toBe('usr_test_001');
    });

    it('should throw for empty ID', async () => {
      await expect(getUser('')).rejects.toThrow('User ID cannot be empty');
    });

    it('should throw for non-existent user', async () => {
      await expect(getUser('usr_nonexistent')).rejects.toThrow();
    });
  });

  describe('createUser', () => {
    it('should create a user with valid email and name', async () => {
      const user = await createUser('test@example.com', 'Test User');
      expect(user.email).toBe('test@example.com');
      expect(user.name).toBe('Test User');
    });

    it('should reject invalid email', async () => {
      await expect(createUser('not-an-email', 'Test')).rejects.toThrow('Invalid email');
    });

    it('should reject empty name', async () => {
      await expect(createUser('test@example.com', '')).rejects.toThrow();
    });
  });

  describe('updateUser', () => {
    it('should update user name', async () => {
      const updated = await updateUser('usr_test_001', { name: 'Updated Name' });
      expect(updated.name).toBe('Updated Name');
    });

    it('should update user email', async () => {
      const updated = await updateUser('usr_test_001', { email: 'new@example.com' });
      expect(updated.email).toBe('new@example.com');
    });
  });

  describe('listUsers', () => {
    it('should return paginated results', async () => {
      const users = await listUsers(1, 10);
      expect(Array.isArray(users)).toBe(true);
      expect(users.length).toBeLessThanOrEqual(10);
    });
  });

  describe('deleteUser', () => {
    it('should soft-delete a user', async () => {
      await expect(deleteUser('usr_test_001')).resolves.not.toThrow();
    });
  });
});
