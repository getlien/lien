import { describe, it, expect } from 'vitest';
import { extractSymbols } from './symbol-extractor.js';

describe('Symbol Extractor', () => {
  describe('TypeScript/JavaScript', () => {
    it('should extract regular functions', () => {
      const content = `
        function getUserById(id) {
          return users.find(u => u.id === id);
        }
        
        async function fetchData() {
          return await fetch('/api/data');
        }
      `;

      const symbols = extractSymbols(content, 'typescript');
      expect(symbols.functions).toContain('getUserById');
      expect(symbols.functions).toContain('fetchData');
    });

    it('should extract arrow functions', () => {
      const content = `
        const handleClick = () => {
          console.log('clicked');
        };
        
        const processData = async (data) => {
          return data.map(d => d.value);
        };
      `;

      const symbols = extractSymbols(content, 'typescript');
      expect(symbols.functions).toContain('handleClick');
      expect(symbols.functions).toContain('processData');
    });

    it('should extract classes', () => {
      const content = `
        class UserService {
          constructor(db) {
            this.db = db;
          }
        }
        
        export class DataManager extends BaseManager {
          getData() {}
        }
      `;

      const symbols = extractSymbols(content, 'typescript');
      expect(symbols.classes).toContain('UserService');
      expect(symbols.classes).toContain('DataManager');
    });

    it('should extract interfaces and types', () => {
      const content = `
        interface User {
          id: number;
          name: string;
        }
        
        export interface Config {
          apiKey: string;
        }
        
        type Status = 'pending' | 'completed';
        export type Result = { data: any };
      `;

      const symbols = extractSymbols(content, 'typescript');
      expect(symbols.interfaces).toContain('User');
      expect(symbols.interfaces).toContain('Config');
      expect(symbols.interfaces).toContain('Status');
      expect(symbols.interfaces).toContain('Result');
    });
  });

  describe('Python', () => {
    it('should extract functions', () => {
      const content = `
        def get_user_by_id(id):
            return users.get(id)
        
        async def fetch_data():
            return await api.get('/data')
      `;

      const symbols = extractSymbols(content, 'python');
      expect(symbols.functions).toContain('get_user_by_id');
      expect(symbols.functions).toContain('fetch_data');
    });

    it('should extract classes', () => {
      const content = `
        class UserService:
            def __init__(self, db):
                self.db = db
        
        class DataManager(BaseManager):
            pass
      `;

      const symbols = extractSymbols(content, 'python');
      expect(symbols.classes).toContain('UserService');
      expect(symbols.classes).toContain('DataManager');
    });
  });

  describe('PHP', () => {
    it('should extract functions', () => {
      const content = `
        function getUserById($id) {
          return $users->find($id);
        }
        
        public function processData($data) {
          return array_map('strtolower', $data);
        }
      `;

      const symbols = extractSymbols(content, 'php');
      expect(symbols.functions).toContain('getUserById');
      expect(symbols.functions).toContain('processData');
    });

    it('should extract classes', () => {
      const content = `
        class UserService {
          public function __construct($db) {
            $this->db = $db;
          }
        }
        
        abstract class BaseController {
          abstract public function handle();
        }
      `;

      const symbols = extractSymbols(content, 'php');
      expect(symbols.classes).toContain('UserService');
      expect(symbols.classes).toContain('BaseController');
    });

    it('should extract interfaces and traits', () => {
      const content = `
        interface Cacheable {
          public function getCacheKey();
        }
        
        trait Loggable {
          public function log($message) {}
        }
      `;

      const symbols = extractSymbols(content, 'php');
      expect(symbols.interfaces).toContain('Cacheable');
      expect(symbols.interfaces).toContain('Loggable');
    });
  });

  describe('Go', () => {
    it('should extract functions', () => {
      const content = `
        func GetUserById(id int) *User {
          return db.Find(id)
        }
        
        func (s *UserService) FetchData() ([]byte, error) {
          return http.Get("/api/data")
        }
      `;

      const symbols = extractSymbols(content, 'go');
      expect(symbols.functions).toContain('GetUserById');
      expect(symbols.functions).toContain('FetchData');
    });

    it('should extract interfaces and structs', () => {
      const content = `
        type User interface {
          GetID() int
          GetName() string
        }
        
        type UserService struct {
          db *Database
        }
      `;

      const symbols = extractSymbols(content, 'go');
      expect(symbols.interfaces).toContain('User');
      expect(symbols.interfaces).toContain('UserService');
    });
  });

  describe('Java', () => {
    it('should extract methods', () => {
      const content = `
        public static void main(String[] args) {
          System.out.println("Hello");
        }
        
        private String getUserName(int id) {
          return users.get(id).getName();
        }
      `;

      const symbols = extractSymbols(content, 'java');
      expect(symbols.functions).toContain('main');
      expect(symbols.functions).toContain('getUserName');
    });

    it('should extract classes and interfaces', () => {
      const content = `
        public class UserService {
          private Database db;
        }
        
        public interface Cacheable {
          String getCacheKey();
        }
      `;

      const symbols = extractSymbols(content, 'java');
      expect(symbols.classes).toContain('UserService');
      expect(symbols.interfaces).toContain('Cacheable');
    });
  });

  describe('C#', () => {
    it('should extract methods', () => {
      const content = `
        public static async Task Main(string[] args) {
          await Run();
        }
        
        private string GetUserName(int id) {
          return users[id].Name;
        }
      `;

      const symbols = extractSymbols(content, 'csharp');
      expect(symbols.functions).toContain('Main');
      expect(symbols.functions).toContain('GetUserName');
    });

    it('should extract classes and interfaces', () => {
      const content = `
        public class UserService {
          private Database _db;
        }
        
        internal interface ICacheable {
          string GetCacheKey();
        }
      `;

      const symbols = extractSymbols(content, 'csharp');
      expect(symbols.classes).toContain('UserService');
      expect(symbols.interfaces).toContain('ICacheable');
    });
  });

  describe('Ruby', () => {
    it('should extract methods', () => {
      const content = `
        def get_user_by_id(id)
          users.find(id)
        end
        
        def self.fetch_data
          HTTP.get('/api/data')
        end
      `;

      const symbols = extractSymbols(content, 'ruby');
      expect(symbols.functions).toContain('get_user_by_id');
      expect(symbols.functions).toContain('fetch_data');
    });

    it('should extract classes and modules', () => {
      const content = `
        class UserService
          def initialize(db)
            @db = db
          end
        end
        
        module Cacheable
          def cache_key
            "#{self.class.name}:#{id}"
          end
        end
      `;

      const symbols = extractSymbols(content, 'ruby');
      expect(symbols.classes).toContain('UserService');
      expect(symbols.classes).toContain('Cacheable');
    });
  });

  describe('Rust', () => {
    it('should extract functions and structs', () => {
      const content = `
        pub fn get_user_by_id(id: i32) -> Option<User> {
          db.find(id)
        }
        
        pub struct UserService {
          db: Database,
        }
        
        pub trait Cacheable {
          fn cache_key(&self) -> String;
        }
      `;

      const symbols = extractSymbols(content, 'rust');
      expect(symbols.functions).toContain('get_user_by_id');
      expect(symbols.functions).toContain('UserService');
      expect(symbols.functions).toContain('Cacheable');
    });
  });

  describe('Edge cases', () => {
    it('should handle empty content', () => {
      const symbols = extractSymbols('', 'typescript');
      expect(symbols.functions).toHaveLength(0);
      expect(symbols.classes).toHaveLength(0);
      expect(symbols.interfaces).toHaveLength(0);
    });

    it('should handle unknown language', () => {
      const content = 'some code here';
      const symbols = extractSymbols(content, 'unknown');
      expect(symbols.functions).toHaveLength(0);
      expect(symbols.classes).toHaveLength(0);
      expect(symbols.interfaces).toHaveLength(0);
    });

    it('should deduplicate symbols', () => {
      const content = `
        function test() {}
        function test() {}
        class User {}
        class User {}
      `;

      const symbols = extractSymbols(content, 'javascript');
      expect(symbols.functions).toHaveLength(1);
      expect(symbols.classes).toHaveLength(1);
    });
  });
});
